const assert = require('node:assert/strict');
const vm = require('node:vm');
const {original, replacement, androidEnter, hardwareEnter, composingKeydown, composingNewline, patchKeyboard} = require('./keyboard-compat.cjs');
const source = `function touchOnly(){return${original}}; touchOnly()`;
const patched = patchKeyboard(source);
assert(patched.includes(replacement));
assert.equal(patchKeyboard(patched), patched);
assert.equal(patchKeyboard(`function touchOnly(){returnwindow.__vscodroidHardwareKeyboardConnected!==true&&${original}}; touchOnly()`), patched);
assert.equal(patchKeyboard('unrelated module'), 'unrelated module');
assert.throws(() => patchKeyboard(original + ';' + original), /Ambiguous/);
const window = {matchMedia: () => ({matches: true})};
const context = {window, navigator: {platform: 'Linux armv8l'}};
assert.equal(vm.runInNewContext(source, context), true, 'Original misclassifies attached keyboards');
for (const connected of [true, false, true, undefined]) {
    window.__vscodroidHardwareKeyboardConnected = connected;
    assert.equal(vm.runInNewContext(patched, context), connected !== true);
}
window.matchMedia = () => ({matches: false});
assert.equal(vm.runInNewContext(patched, context), false);
window.matchMedia = () => ({matches: true});
context.navigator.platform = 'Win32';
assert.equal(vm.runInNewContext(patched, context), false);
console.log('PASS: physical keyboard policy, detach/reattach, desktop, idempotence');
const dom = patchKeyboard(replacement + ';' + androidEnter);
assert(dom.includes(hardwareEnter), 'Already-patched touch policy must still receive the DOM fix');
assert.equal(patchKeyboard(dom), dom);
assert.throws(() => patchKeyboard(androidEnter + ';' + androidEnter), /Ambiguous/);
for (const connected of [true, false, undefined]) {
    for (const composing of [true, false]) {
        assert.equal(vm.runInNewContext(hardwareEnter, {B$414:true, I$396:true,
            n:{keyCode:13, isComposing:composing}, window:{__vscodroidHardwareKeyboardConnected:connected}}),
        connected === true && !composing);
    }
}
console.log('PASS: Android DOM guard preserves IME and touch fallback; hardware Enter reaches the original keymap');

const ime = patchKeyboard(composingKeydown);
assert.equal(ime, composingNewline);
assert.equal(patchKeyboard(ime), ime);
assert.throws(() => patchKeyboard(composingKeydown + composingKeydown), /Ambiguous/);
console.log("PASS: composing Shift+Enter patch applies once and rejects ambiguous handlers");
