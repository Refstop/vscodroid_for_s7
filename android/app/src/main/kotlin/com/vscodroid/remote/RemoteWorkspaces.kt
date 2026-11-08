package com.vscodroid.remote

import org.json.JSONObject

/** Process-owned transport. UI recreation must not destroy an active workspace. */
object RemoteWorkspaces {
    @Volatile var current: RemoteWorkspaceSession.Connection? = null
        private set
    @Volatile private var folders: List<String> = emptyList()
    @Volatile private var session: RemoteWorkspaceSession? = null

    @Synchronized fun replace(ssh: RemoteWorkspaceSession, connection: RemoteWorkspaceSession.Connection, reconnectAuthority: String? = null) {
        if (reconnectAuthority != null) {
            check(connection.authority == reconnectAuthority && (current == null || current?.authority == reconnectAuthority)) {
                "The active SSH host changed. Reopen the intended workspace."
            }
        }
        session?.close()
        session = ssh
        current = connection
        folders = listOf(connection.folder)
    }

    @Synchronized fun disconnect() {
        current = null
        session?.close()
        session = null
    }

    fun publishRoots(authority: String, paths: List<String>) {
        check(current?.authority == authority)
        require(paths.size <= 256 && paths.all { it.startsWith('/') && !it.contains('\u0000') })
        folders = paths
    }

    fun resourceUrl(authority: String, path: String): String? {
        val active = current?.takeIf { it.authority == authority } ?: return null
        if (session?.isConnected() != true || !path.startsWith('/') || path.contains('\u0000')) return null
        // The host validates real paths and the opened descriptor in this same request.
        // Serial SFTP checks here made large extension webviews miss their startup deadline.
        val roots = org.json.JSONArray(folders + active.resourceRoots).toString()
        return "http://127.0.0.1:${active.port}/vscodroid-webview-resource?path=" +
            android.net.Uri.encode(path) + "&roots=" + android.net.Uri.encode(roots) +
            "&tkn=" + android.net.Uri.encode(active.token)
    }

    @Synchronized fun resolve(authority: String): String {
        val active = current
        if (active != null && active.authority != authority) {
            return JSONObject().put("status", "authorityMismatch")
                .put("message", "The active SSH host changed. Reopen the intended workspace.").toString()
        }
        if (active == null || session?.isConnected() != true) {
            // Expected transport loss must not become an opaque JavaBridge exception.
            return JSONObject().put("status", "disconnected").toString()
        }
        return JSONObject().put("port", active.port).put("token", active.token)
            .put("setupWarnings", org.json.JSONArray(active.setupWarnings)).toString()
    }
}
