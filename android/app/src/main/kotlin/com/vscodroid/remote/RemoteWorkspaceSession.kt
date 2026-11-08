package com.vscodroid.remote

import com.jcraft.jsch.AndroidSshAgent
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import com.vscodroid.util.ServerLog
import java.io.Closeable
import java.io.File
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Owns the SSH connection, the remote editor process and its loopback-only forward. */
class RemoteWorkspaceSession(private val knownHosts: File) : Closeable {
    @Volatile private var session: Session? = null
    @Volatile private var channel: ChannelExec? = null
    private val heartbeat = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var closed = false
    private var control: java.io.OutputStream? = null
    private val events = ServerLog(File(knownHosts.parentFile, "session.log"))

    private fun record(event: String) {
        // Fixed event names and transport state only: no passwords, tokens or command output.
        events.append("${java.time.Instant.now()} SSH $event connected=${session?.isConnected} channelClosed=${channel?.isClosed} exit=${channel?.exitStatus}")
    }

    data class Connection(val port: Int, val token: String, val folder: String, val authority: String, val label: String, val resourceRoots: List<String>, val setupWarnings: List<String> = emptyList())

    fun connect(
        host: String, port: Int, user: String, password: String, folder: String,
        bootstrap: String, compatibility: ByteArray, confirmHost: (String) -> Boolean, progress: (String) -> Unit, options: org.json.JSONObject = org.json.JSONObject(), home: File? = null
    ): Connection {
        require(host.isNotBlank() && !host.any { it.isWhitespace() }) { "Enter an SSH hostname or IP address." }
        require(port in 1..65535 && user.isNotBlank()) { "Enter a valid port and username." }
        require(folder.startsWith('/') && !folder.contains('\u0000')) { "The remote folder must be an absolute path." }
        check(!closed) { "Connection cancelled." }
        knownHosts.parentFile?.mkdirs()
        if (!knownHosts.exists()) knownHosts.createNewFile()
        val jsch = JSch().apply { setKnownHosts(knownHosts.path) }
        val setupWarnings = mutableListOf<String>()
        var forwardAgent = false
        if (options.optString("ForwardAgent").equals("yes", true)) {
            val configured = options.optString("IdentityAgent", "SSH_AUTH_SOCK")
            val path = when {
                configured == "none" -> null
                configured == "SSH_AUTH_SOCK" -> System.getenv("SSH_AUTH_SOCK")
                configured.startsWith("~/") -> home?.resolve(configured.substring(2))?.path
                else -> configured
            }
            val agent = path?.let { AndroidSshAgent(it) }
            if (agent?.isAvailable == true) {
                jsch.setIdentityRepository(com.jcraft.jsch.AgentIdentityRepository(agent))
                forwardAgent = true
            } else setupWarnings.add("ForwardAgent is enabled, but no tablet SSH agent is available. Existing PC agent settings are preserved.")
        }
        val ssh = jsch.getSession(user, host, port)
        session = ssh
        ssh.setPassword(password.toByteArray())
        ssh.setConfig("StrictHostKeyChecking", "ask")
        ssh.setConfig("PreferredAuthentications", "password")
        ssh.setConfig("FingerprintHash", "sha256")
        ssh.userInfo = object : UserInfo {
            override fun getPassword(): String = password
            override fun getPassphrase(): String? = null
            override fun promptPassword(message: String): Boolean = true
            override fun promptPassphrase(message: String): Boolean = false
            override fun promptYesNo(message: String): Boolean =
                !closed && !message.contains("CHANGED", ignoreCase = true) && confirmHost(message)
            override fun showMessage(message: String) { progress(message) }
        }
        if (options.optString("Compression").equals("yes", true)) {
            ssh.setConfig("compression.s2c", "zlib@openssh.com,zlib,none")
            ssh.setConfig("compression.c2s", "zlib@openssh.com,zlib,none")
        }
        ssh.setServerAliveInterval(options.optInt("ServerAliveInterval", 15) * 1000)
        ssh.setServerAliveCountMax(options.optInt("ServerAliveCountMax", 3))
        progress("Connecting to $host:$port…")
        ssh.connect(options.optInt("ConnectTimeout", 20) * 1000)
        check(!closed) { "Connection cancelled." }
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val exec = ssh.openChannel("exec") as ChannelExec
        channel = exec
        exec.setAgentForwarding(forwardAgent)
        exec.setCommand("sh -c " + shellQuote(bootstrap))
        val input = exec.inputStream
        control = exec.outputStream
        // Bootstrap diagnostics are deliberately bounded and contain no credentials.
        val errors = object : java.io.OutputStream() {
            private val text = StringBuilder()
            override fun write(b: Int) { if (text.length < 4096) text.append(b.toChar()) }
            override fun toString(): String = text.toString()
        }
        exec.setErrStream(errors)
        exec.connect(20_000)
        control!!.write((token + "\n").toByteArray())
        val compatibilityHash = java.security.MessageDigest.getInstance("SHA-256")
            .digest(compatibility).joinToString("") { "%02x".format(it) }
        control!!.write((compatibilityHash + "\n" + Base64.getEncoder().encodeToString(compatibility) + "\n").toByteArray())
        control!!.flush()
        val deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(20)
        val line = StringBuilder()
        var remotePort: Int? = null
        val resourceRoots = mutableListOf<String>()
        while (!closed && System.nanoTime() < deadline && remotePort == null) {
            while (input.available() > 0) {
                val b = input.read()
                if (b == -1) break
                if (b == 10) {
                    val value = line.toString().trim()
                    line.setLength(0)
                    if (value.startsWith("VSCODROID_READY=")) remotePort = value.substringAfter('=').toIntOrNull()
                    else if (value.startsWith("VSCODROID_AGENT=") || value.startsWith("VSCODROID_EXTENSIONS=")) {
                        value.substringAfter('=').takeIf { it.startsWith('/') }?.let { resourceRoots.add(it) }
                    }
                    else if (value.startsWith("VSCODROID_STATUS=")) progress(value.substringAfter('='))
                    else if (value.startsWith("VSCODROID_WARNING=") && setupWarnings.size < 8) setupWarnings.add(value.substringAfter('='))
                } else if (line.length < 4096) line.append(b.toChar())
            }
            if (remotePort != null) break
            check(!exec.isClosed) { "Remote editor failed (${exec.exitStatus}): $errors" }
            Thread.sleep(100)
        }
        val targetPort = requireNotNull(remotePort) { "Remote editor startup timed out or was cancelled." }
        require(targetPort in 1..65535)
        check(!closed) { "Connection cancelled." }
        val localPort = ssh.setPortForwardingL("127.0.0.1", 0, "127.0.0.1", targetPort)
        record("ready")
        heartbeat.scheduleAtFixedRate({
            if (closed) return@scheduleAtFixedRate
            if (!isConnected()) {
                closeWithReason(if (session?.isConnected != true) "transport-lost" else "remote-process-ended")
                return@scheduleAtFixedRate
            }
            try { control?.write("ping\n".toByteArray()); control?.flush() }
            catch (error: Exception) { closeWithReason("heartbeat-failed:${error.javaClass.simpleName}") }
        }, 15, 15, TimeUnit.SECONDS)
        val identity = java.security.MessageDigest.getInstance("SHA-256")
            .digest("$user@$host:$port".toByteArray()).take(12).joinToString("") { "%02x".format(it) }
        return Connection(localPort, token, folder, "ssh-remote+$identity", "$user@$host", resourceRoots, setupWarnings)
    }

    fun isConnected(): Boolean = !closed && session?.isConnected == true && channel?.isClosed == false

    override fun close() = closeWithReason("requested-or-startup-cleanup")

    @Synchronized private fun closeWithReason(reason: String) {
        if (closed) return
        record(reason)
        closed = true
        heartbeat.shutdownNow()
        try { control?.write("close\n".toByteArray()); control?.flush(); control?.close() } catch (_: Exception) { }
        channel?.disconnect()
        session?.disconnect()
    }

    companion object {
        fun shellQuote(value: String): String = "'" + value.replace("'", "'\"'\"'") + "'"
    }
}
