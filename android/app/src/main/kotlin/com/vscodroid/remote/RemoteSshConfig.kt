package com.vscodroid.remote

import com.jcraft.jsch.OpenSSHConfig
import org.json.JSONObject
import java.io.File

/** The tablet's OpenSSH config is shared with its CLI; connection secrets never belong here. */
class RemoteSshConfig(private val file: File) {
    fun read(): String = if (file.exists()) file.readText() else ""
    fun write(text: String) {
        require(text.length <= 256 * 1024 && !text.contains('\u0000')) { "Invalid SSH config file" }
        // JSch cannot safely interpret Include/Match or execute proxy commands.
        require(!Regex("(?im)^\\s*(Include|Match|ProxyCommand|ProxyJump|LocalCommand)\\s").containsMatchIn(text)) {
            "Include, Match and proxy/command directives are not supported by VSCodroid's SSH transport."
        }
        file.parentFile!!.mkdirs()
        val temp = File(file.parentFile, ".config-vscodroid.tmp")
        temp.writeText(text)
        temp.setReadable(false, false); temp.setWritable(false, false)
        temp.setReadable(true, true); temp.setWritable(true, true)
        check(temp.renameTo(file)) { "Cannot save SSH config" }
    }
    fun save(input: JSONObject) {
        val alias = input.optString("configHost").ifEmpty { input.getString("host") }
        require(alias.matches(Regex("[A-Za-z0-9_:][A-Za-z0-9_.:%-]*"))) { "Invalid SSH host alias" }
        val values = linkedMapOf("HostName" to input.getString("host"), "User" to input.getString("user"), "Port" to input.getInt("port").toString())
        input.optJSONObject("options")?.let { options -> options.keys().forEach { key ->
            require(key in supported) { "Unsupported SSH option: $key" }
            values[key] = options.getString(key)
        } }
        values.forEach { (key, value) -> validate(key, value) }
        val lines = read().lines().toMutableList()
        // Update a single exact Host stanza; wildcard sections and unrelated hosts stay intact.
        val start = lines.indexOfFirst { it.trim().matches(Regex("(?i)Host\\s+${Regex.escape(alias)}")) }
        if (start >= 0) {
            val end = (start + 1 until lines.size).firstOrNull { lines[it].trim().startsWith("Host ", true) || lines[it].trim().startsWith("Host\t", true) } ?: lines.size
            for (i in end - 1 downTo start + 1) {
                val key = lines[i].trim().split(Regex("[=\\s]+"), limit = 2).first()
                if (values.keys.any { it.equals(key, true) }) lines.removeAt(i)
            }
            lines.addAll(start + 1, values.map { (key, value) -> "    $key $value" })
            val newEnd = (start + 1 until lines.size).firstOrNull { lines[it].trim().matches(Regex("(?i)Host\\s+.*")) } ?: lines.size
            val stanza = lines.subList(start, newEnd).toList()
            lines.subList(start, newEnd).clear()
            write((stanza + lines).joinToString("\n").trimEnd() + "\n")
        } else {
            // Specific settings precede Host *: OpenSSH uses the first obtained value.
            write("Host $alias\n" + values.entries.joinToString("\n") { "    ${it.key} ${it.value}" } + "\n\n" + read())
        }
    }
    fun hosts(): org.json.JSONArray {
        val result = org.json.JSONArray()
        for (line in read().lines()) {
            val match = Regex("(?i)^\\s*Host\\s+(.+)$").find(line) ?: continue
            for (alias in match.groupValues[1].split(Regex("\\s+"))) {
                if (!alias.matches(Regex("[A-Za-z0-9_:][A-Za-z0-9_.:%-]*"))) continue
                result.put(resolve(JSONObject().put("host", alias).put("configHost", alias).put("user", "").put("port", 22)))
            }
        }
        return result
    }
    fun resolve(input: JSONObject): JSONObject {
        val result = JSONObject()
        // Return connection data only, never a bridge action, password or attempt id.
        for (key in listOf("host", "user", "port", "folder", "configHost", "label")) {
            if (input.has(key)) result.put(key, input.get(key))
        }
        val config = OpenSSHConfig.parse(read()).getConfig(input.optString("configHost").ifEmpty { input.getString("host") })
        config.hostname?.let { result.put("host", it) }
        config.user?.let { result.put("user", it) }
        if (config.port != -1) result.put("port", config.port)
        val options = JSONObject()
        for (key in supported) config.getValue(key)?.let { raw ->
            // JSch exposes these two OpenSSH seconds fields as milliseconds.
            val value = if (key in setOf("ServerAliveInterval", "ConnectTimeout"))
                (raw.toLong() / 1000).toString() else raw
            validate(key, value); options.put(key, value)
        }
        result.put("options", options)
        return result
    }
    companion object {
        val supported = setOf("HostName", "User", "Port", "ForwardAgent", "Compression", "ServerAliveInterval", "ServerAliveCountMax", "ConnectTimeout", "IdentityAgent")
        fun validate(key: String, value: String) {
            require(value.isNotEmpty() && !value.any { it == '\n' || it == '\r' || it == '\u0000' }) { "Invalid $key" }
            when (key) {
                "HostName" -> require(value.matches(Regex("[A-Za-z0-9_:][A-Za-z0-9_.:%-]*"))) { "Invalid HostName" }
                "User" -> require(value.matches(Regex("[A-Za-z0-9_.-]+"))) { "Invalid User" }
                "Port" -> require(value.toIntOrNull() in 1..65535) { "Invalid Port" }
                "ForwardAgent", "Compression" -> require(value.lowercase() in setOf("yes", "no")) { "$key must be yes or no" }
                "ServerAliveInterval", "ConnectTimeout" -> require(value.toIntOrNull() in 0..86400) { "Invalid $key" }
                "ServerAliveCountMax" -> require(value.toIntOrNull() in 0..1000) { "Invalid $key" }
                "IdentityAgent" -> require(value == "none" || value == "SSH_AUTH_SOCK" || value.startsWith('/') || value.startsWith("~/")) { "IdentityAgent must be an absolute socket path, ~/path, SSH_AUTH_SOCK or none" }
            }
        }
    }
}
