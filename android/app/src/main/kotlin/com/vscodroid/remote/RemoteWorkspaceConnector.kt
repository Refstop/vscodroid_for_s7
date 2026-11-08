package com.vscodroid.remote

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** SSH transport only. All prompts and progress belong to the editor's Quick Input UI. */
object RemoteWorkspaceConnector {
    private class Attempt(val ssh: RemoteWorkspaceSession) {
        val id = UUID.randomUUID().toString()
        @Volatile var state = "connecting"
        @Volatile var message = "Connecting…"
        @Volatile var result: RemoteWorkspaceSession.Connection? = null
        @Volatile var question: CompletableFuture<Boolean>? = null
    }
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var pending: Attempt? = null

    @Synchronized fun request(context: Context, input: JSONObject): JSONObject {
        val config = RemoteSshConfig(File(context.filesDir, "home/.ssh/config"))
        when (input.getString("action")) {
            "resolveConfig" -> return config.resolve(input)
            "configHosts" -> return JSONObject().put("hosts", config.hosts())
            "readConfig" -> return JSONObject().put("text", config.read())
            "writeConfig" -> { config.write(input.getString("text")); return JSONObject() }
            "saveHostConfig" -> { config.save(input); return JSONObject() }
        }
        if (input.getString("action") == "previousHost") {
            val prefs = context.getSharedPreferences("remote-workspace", Context.MODE_PRIVATE)
            return JSONObject().put("host", prefs.getString("host", ""))
                .put("user", prefs.getString("user", "")).put("port", prefs.getString("port", "22")!!.toInt())
                .put("folder", prefs.getString("folder", "/"))
        }
        if (input.getString("action") == "start") {
            cancelPending()
            val resolved = config.resolve(input)
            val host = resolved.getString("host")
            val user = resolved.getString("user")
            val port = resolved.getInt("port")
            val folder = input.getString("folder")
            val secret = input.getString("password")
            input.remove("password")
            val attempt = Attempt(RemoteWorkspaceSession(File(context.filesDir, "remote-ssh/known_hosts")))
            pending = attempt
            val app = context.applicationContext
            worker.execute {
                try {
                    val result = attempt.ssh.connect(host, port, user, secret, folder,
                        app.assets.open("remote-workspace.sh").bufferedReader().use { it.readText() },
                        app.assets.open("remote-compat.bin").use { it.readBytes() },
                        { message ->
                            val answer = CompletableFuture<Boolean>()
                            attempt.question = answer
                            attempt.message = message
                            attempt.state = "hostKey"
                            try { answer.get(2, TimeUnit.MINUTES) } finally { attempt.question = null }
                        }, { message -> attempt.message = message }, resolved.getJSONObject("options"), File(context.filesDir, "home"))
                    synchronized(this) {
                        if (pending === attempt) { attempt.result = result; attempt.state = "ready" }
                        else attempt.ssh.close()
                    }
                } catch (error: Exception) {
                    attempt.ssh.close()
                    attempt.message = error.message ?: "SSH connection failed."
                    attempt.state = "error"
                }
            }
            // Reloading/closing the editor must not leave an unclaimed SSH connection.
            worker.schedule({ synchronized(this) { if (pending === attempt) cancelPending() } }, 25, TimeUnit.MINUTES)
            return JSONObject().put("id", attempt.id)
        }
        val attempt = pending?.takeIf { it.id == input.getString("id") }
            ?: error("This connection attempt has ended.")
        when (input.getString("action")) {
            "poll" -> return JSONObject().put("state", attempt.state).put("message", attempt.message)
            "answer" -> {
                check(attempt.state == "hostKey")
                attempt.state = "connecting"
                attempt.question?.complete(input.getBoolean("trust"))
            }
            "cancel" -> cancelPending()
            "commit" -> {
                check(attempt.state == "ready")
                RemoteWorkspaces.replace(attempt.ssh, checkNotNull(attempt.result),
                    input.optString("reconnectAuthority").takeIf { it.isNotEmpty() })
                pending = null
            }
            else -> error("Unknown SSH action")
        }
        return JSONObject()
    }

    private fun cancelPending() {
        pending?.let { it.question?.complete(false); it.ssh.close() }
        pending = null
    }
}
