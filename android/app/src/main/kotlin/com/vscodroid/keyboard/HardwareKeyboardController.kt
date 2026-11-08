package com.vscodroid.keyboard

import android.content.Context
import android.hardware.input.InputManager
import android.os.Handler
import android.os.Looper
import android.view.InputDevice
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/** Physical connection state for the touch guard and extra keys; never dismiss the IME. */
internal class HardwareKeyboardController(
    context: Context,
    private val onConnectionChanged: (Boolean) -> Unit,
) : InputManager.InputDeviceListener {
    private val inputManager = context.getSystemService(InputManager::class.java)
    private val script = context.assets.open("hardware-keyboard.js").bufferedReader().use { it.readText() }
    private var startupScript: ScriptHandler? = null
    private var webView: WebView? = null
    var connected = false
        private set

    init {
        inputManager.registerInputDeviceListener(this, Handler(Looper.getMainLooper()))
        refresh()
    }

    fun attach(view: WebView) {
        detach()
        webView = view
        installScript()
    }

    fun detach() {
        startupScript?.remove()
        startupScript = null
        webView = null
    }

    fun refresh() {
        val next = inputManager.inputDeviceIds.any { id ->
            inputManager.getInputDevice(id)?.let { device ->
                isPhysicalKeyboard(device.isVirtual, device.isEnabled, device.sources, device.keyboardType)
            } == true
        }
        if (connected != next) {
            connected = next
            installScript()
        }
        onConnectionChanged(connected)
    }

    private fun installScript() {
        val view = webView ?: return
        startupScript?.remove()
        val source = "$script\nwindow.__vscodroidSetHardwareKeyboard($connected);"
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            startupScript = WebViewCompat.addDocumentStartJavaScript(view, source, setOf("*"))
        }
        view.evaluateJavascript(source, null)
    }

    override fun onInputDeviceAdded(deviceId: Int) = refresh()
    override fun onInputDeviceRemoved(deviceId: Int) = refresh()
    override fun onInputDeviceChanged(deviceId: Int) = refresh()

    fun close() {
        inputManager.unregisterInputDeviceListener(this)
        detach()
    }

    companion object {
        internal fun isPhysicalKeyboard(isVirtual: Boolean, enabled: Boolean, sources: Int, keyboardType: Int) =
            enabled && !isVirtual &&
                (sources and InputDevice.SOURCE_KEYBOARD) == InputDevice.SOURCE_KEYBOARD &&
                keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC
    }
}
