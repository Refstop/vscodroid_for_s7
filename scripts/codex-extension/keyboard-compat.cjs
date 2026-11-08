const original = '!navigator.platform.startsWith(`Win`)&&window.matchMedia(`(pointer: coarse)`).matches';
const previous = 'window.__vscodroidHardwareKeyboardConnected!==true&&' + original;
// Parentheses keep minified `return!…` valid after replacement (`return(…`) and
// avoid merging the keyword with `window` into a returnwindow identifier.
const replacement = '(' + previous + ')';
// Pinned bundled ProseMirror DOM handler. Its Android workaround skips Enter
// before the Codex keymap sees Shift, losing the default Shift+Enter newline.
const androidEnter = '!(B$414&&I$396&&n.keyCode==13)';
const hardwareEnter = '!(B$414&&I$396&&n.keyCode==13&&(window.__vscodroidHardwareKeyboardConnected!==true||n.isComposing))';

// Commit the native IME range before dispatching the explicit newline keymap.
// Clearing only ProseMirror's composing flag would leave Chromium composing over
// the new paragraph and corrupt the next Hangul syllable. Blur commits the range;
// forceFlush/Qt reconcile it, then EditorView.focus restores the model selection.
const composingKeydown = 'J$415.keydown=(e,t)=>{let n=t;';
const composingNewline = composingKeydown +
    'if(B$414&&window.__vscodroidHardwareKeyboardConnected===true&&n.key===`Enter`&&n.shiftKey&&!n.ctrlKey&&!n.altKey&&!n.metaKey&&(e.composing||n.isComposing)){' +
    'n.preventDefault();e.dom.blur();e.domObserver.forceFlush();Qt$69(e,true);e.focus();' +
    'n=new KeyboardEvent(`keydown`,{key:`Enter`,code:`Enter`,keyCode:13,which:13,shiftKey:true,bubbles:true,cancelable:true});}';

// Codex's touch-only Enter policy ignores attached keyboards. VSCodroid already
// supplies this live flag in every webview frame, including attach/detach changes.
// Keep the existing keymap, IME guards, send preference and suggestion handling.
function patchKeyboard(source) {
    if (!source.includes(replacement)) {
        if (source.includes(previous)) source = source.replace(previous, replacement);
        else {
            if (source.split(original).length > 2) throw new Error('Ambiguous Codex keyboard policy');
            source = source.replace(original, replacement);
        }
    }
    if (source.split(androidEnter).length > 2) throw new Error('Ambiguous Android Enter handler');
    source = source.replace(androidEnter, hardwareEnter);
    if (!source.includes(composingNewline)) {
        if (source.split(composingKeydown).length > 2) throw new Error('Ambiguous composing keydown handler');
        source = source.replace(composingKeydown, composingNewline);
    }
    return source;
}

module.exports = {original, replacement, androidEnter, hardwareEnter, composingKeydown, composingNewline, patchKeyboard};
