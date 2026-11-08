package com.vscodroid.remote

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.json.JSONObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RemoteWorkspacesTest {
    @AfterEach fun cleanup() { RemoteWorkspaces.disconnect() }

    @Test fun `expired transport returns a recoverable response instead of throwing through JavaScript`() {
        val ssh = mockk<RemoteWorkspaceSession>(relaxed = true)
        every { ssh.isConnected() } returns false
        RemoteWorkspaces.replace(ssh, RemoteWorkspaceSession.Connection(1234, "secret", "/work", "ssh-remote+a", "dev@host", emptyList()))
        val result = JSONObject(RemoteWorkspaces.resolve("ssh-remote+a"))
        assertEquals("disconnected", result.getString("status"))
        assertFalse(result.has("token"))
    }

    @Test fun `missing session is recoverable but different active host must not be replaced`() {
        RemoteWorkspaces.disconnect()
        assertEquals("disconnected", JSONObject(RemoteWorkspaces.resolve("ssh-remote+a")).getString("status"))
        val ssh = mockk<RemoteWorkspaceSession>(relaxed = true)
        every { ssh.isConnected() } returns true
        RemoteWorkspaces.replace(ssh, RemoteWorkspaceSession.Connection(1234, "secret", "/work", "ssh-remote+b", "dev@host", emptyList()))
        assertEquals("authorityMismatch", JSONObject(RemoteWorkspaces.resolve("ssh-remote+a")).getString("status"))
        val healthy = JSONObject(RemoteWorkspaces.resolve("ssh-remote+b"))
        assertEquals(1234, healthy.getInt("port"))
        assertEquals("secret", healthy.getString("token"))
    }
    @Test fun `late reconnect cannot replace a different host selected meanwhile`() {
        val old = mockk<RemoteWorkspaceSession>(relaxed = true)
        val pending = mockk<RemoteWorkspaceSession>(relaxed = true)
        val active = RemoteWorkspaceSession.Connection(1234, "old-token", "/work", "ssh-remote+b", "dev@b", emptyList())
        RemoteWorkspaces.replace(old, active)
        assertThrows(IllegalStateException::class.java) {
            RemoteWorkspaces.replace(pending, active.copy(authority = "ssh-remote+a"), "ssh-remote+a")
        }
        assertEquals(active, RemoteWorkspaces.current)
        verify(exactly = 0) { old.close() }
    }

}
