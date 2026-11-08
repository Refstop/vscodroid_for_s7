package com.vscodroid.remote

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.vscodroid.util.Logger

/** Opt-in lifecycle integration with Tailscale's exported VPN receiver. */
object TailscaleAutomation {
    private const val PREFS = "tailscale_automation"
    private var requested = false

    fun enabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)

    @Synchronized fun configure(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled).apply()
        if (enabled) start(context)
        else requested = false // Turning off automation leaves the user's VPN alone.
    }

    @Synchronized fun start(context: Context) {
        if (enabled(context) && !requested) requested = send(context, "CONNECT_VPN")
    }

    @Synchronized fun stop(context: Context) {
        if (!requested) return
        requested = false
        send(context, "DISCONNECT_VPN")
    }

    private fun send(context: Context, action: String): Boolean = try {
        context.sendBroadcast(Intent("com.tailscale.ipn.$action").apply {
            component = ComponentName("com.tailscale.ipn", "com.tailscale.ipn.IPNReceiver")
        })
        Logger.i("TailscaleAutomation", "Requested $action")
        true
    } catch (error: RuntimeException) {
        Logger.w("TailscaleAutomation", "VPN request failed: ${error.javaClass.simpleName}")
        false
    }
}
