package com.vscodroid.remote

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class RemoteSshConfigTest {
    @TempDir lateinit var directory: File
    private fun host() = JSONObject("""{"host":"pc.example","user":"dev","port":22,"folder":"/work"}""")
    @Test fun `options survive saving and config overrides connection defaults`() {
        val config = RemoteSshConfig(File(directory, "config"))
        config.write("# keep comment\nHost *\n    ForwardAgent no\n    ServerAliveInterval 60\n")
        config.save(host().put("options", JSONObject("""{"ForwardAgent":"yes","Compression":"yes","ConnectTimeout":"12"}""")))
        val resolved = config.resolve(host())
        assertEquals("yes", resolved.getJSONObject("options").getString("ForwardAgent"))
        assertEquals("60", resolved.getJSONObject("options").getString("ServerAliveInterval"))
        assertEquals("12", resolved.getJSONObject("options").getString("ConnectTimeout"))
        assertTrue(config.read().contains("# keep comment"))
        config.save(host().put("options", JSONObject("""{"ForwardAgent":"no"}""")))
        assertEquals(1, Regex("Host pc.example").findAll(config.read()).count())
        assertEquals("no", config.resolve(host()).getJSONObject("options").getString("ForwardAgent"))
        assertTrue(config.read().contains("Compression yes"))
    }
    @Test fun `resolve response cannot overwrite a subsequent start operation or echo a password`() {
        val config = RemoteSshConfig(File(directory, "config"))
        val result = config.resolve(host().put("action", "resolveConfig").put("password", "test-only-secret").put("id", "old-attempt"))
        assertFalse(result.has("action"))
        assertFalse(result.has("password"))
        assertFalse(result.has("id"))
        assertEquals("pc.example", result.getString("host"))
    }
    @Test fun `alias resolves hostname user port and cannot inject config directives`() {
        val config = RemoteSshConfig(File(directory, "config"))
        config.write("Host work\n    HostName pc.example\n    User dev\n    Port 2222\n")
        val result = config.resolve(host().put("host", "work").put("user", "other"))
        assertEquals("pc.example", result.getString("host"))
        assertEquals("dev", result.getString("user"))
        assertEquals(2222, result.getInt("port"))
        assertThrows(IllegalArgumentException::class.java) { config.save(host().put("options", JSONObject().put("ForwardAgent", "yes\nProxyCommand evil"))) }
        assertThrows(IllegalArgumentException::class.java) { config.save(host().put("options", JSONObject().put("ProxyCommand", "evil"))) }
    }
}
