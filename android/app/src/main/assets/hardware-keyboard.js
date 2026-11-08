// Keep Chromium's normal input-method policy: `manual` also bypasses Samsung's
// hardware-key Hangul composition. OS/IME physical-keyboard display preferences
// control its window; this flag only disables the touch-specific DOM guard.
(function () {
    if (window.__vscodroidSetHardwareKeyboard) return;
    window.addEventListener('message', event => {
        if (window !== window.top && event.source === window.parent &&
            event.data?.type === 'vscodroid-hardware-keyboard') {
            window.__vscodroidSetHardwareKeyboard(event.data.connected);
        }
    });
    window.__vscodroidSetHardwareKeyboard = function (value) {
        const connected = value === true;
        window.__vscodroidHardwareKeyboardConnected = connected;
        if (connected) {
            // Release holds left by the touch guard before the keyboard attached.
            document.querySelectorAll('.native-edit-context, .monaco-editor textarea.inputarea, .xterm-helper-textarea')
                .forEach(element => {
                    if (element.getAttribute('inputmode') === 'none') element.removeAttribute('inputmode');
                });
        }
        for (let i = 0; i < window.frames.length; i++) {
            window.frames[i].postMessage({type: 'vscodroid-hardware-keyboard', connected}, '*');
        }
    };
})();
