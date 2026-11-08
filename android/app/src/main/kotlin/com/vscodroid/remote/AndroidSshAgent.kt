// JSch AgentConnector requires Buffer.checkFreeSize, a package-private API.
package com.jcraft.jsch

import android.net.LocalSocket
import android.net.LocalSocketAddress
import com.jcraft.jsch.AgentConnector
import com.jcraft.jsch.AgentProxyException
import com.jcraft.jsch.Buffer
import java.io.DataInputStream

/** OpenSSH agent protocol over Android's Unix socket API; private keys stay in the agent. */
class AndroidSshAgent(private val path: String) : AgentConnector {
    override fun getName() = "Android SSH agent"
    private fun connect() = LocalSocket().apply {
        try { soTimeout = 5000; connect(LocalSocketAddress(path, LocalSocketAddress.Namespace.FILESYSTEM)) }
        catch (e: Exception) { close(); throw e }
    }
    override fun isAvailable(): Boolean = try { connect().use { }; true } catch (_: Exception) { false }
    override fun query(buffer: Buffer) {
        try {
            val request = ByteArray(buffer.length)
            buffer.setOffSet(0); buffer.getByte(request)
            connect().use { socket ->
                socket.outputStream.write(request); socket.outputStream.flush()
                val input = DataInputStream(socket.inputStream)
                val length = input.readInt()
                require(length in 1..262144) { "Invalid SSH agent response length" }
                val response = ByteArray(length); input.readFully(response)
                buffer.reset(); buffer.checkFreeSize(length); buffer.putByte(response); buffer.setOffSet(0)
            }
        } catch (e: Exception) { throw AgentProxyException("SSH agent request failed", e) }
    }
}
