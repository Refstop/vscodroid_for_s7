package com.vscodroid.keyboard

import android.view.InputDevice
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HardwareKeyboardControllerTest {
    @Test
    fun `attached alphabetic keyboards count without a preceding keystroke`() {
        for (sources in listOf(InputDevice.SOURCE_KEYBOARD, InputDevice.SOURCE_KEYBOARD or InputDevice.SOURCE_DPAD)) {
            assertTrue(HardwareKeyboardController.isPhysicalKeyboard(false, true, sources, InputDevice.KEYBOARD_TYPE_ALPHABETIC))
        }
    }

    @Test
    fun `virtual keyboards disabled devices touchpads and hardware buttons do not suppress typing`() {
        val keyboard = InputDevice.SOURCE_KEYBOARD
        val alphabetic = InputDevice.KEYBOARD_TYPE_ALPHABETIC
        assertFalse(HardwareKeyboardController.isPhysicalKeyboard(true, true, keyboard, alphabetic))
        assertFalse(HardwareKeyboardController.isPhysicalKeyboard(false, false, keyboard, alphabetic))
        assertFalse(HardwareKeyboardController.isPhysicalKeyboard(false, true, InputDevice.SOURCE_MOUSE, alphabetic))
        assertFalse(HardwareKeyboardController.isPhysicalKeyboard(false, true, keyboard, InputDevice.KEYBOARD_TYPE_NON_ALPHABETIC))
        assertFalse(HardwareKeyboardController.isPhysicalKeyboard(false, true, InputDevice.SOURCE_TOUCHSCREEN, InputDevice.KEYBOARD_TYPE_NONE))
    }
}
