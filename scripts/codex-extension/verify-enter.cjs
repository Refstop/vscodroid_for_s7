// Uses the installed, pinned Codex editor in a running WebView. No messages are
// sent: each temporary controller has only a local submit counter attached.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');

async function main() {
    const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19223');
    let frame;
    try {
        for (const page of browser.contexts().flatMap(c => c.pages())) {
            for (const candidate of page.frames()) {
                if (await candidate.locator('[data-codex-composer][contenteditable=true]').count()) frame = candidate;
            }
        }
        assert(frame, 'Open the Codex composer first');
        const rows = await frame.evaluate(async () => {
            const base = document.querySelector('script[src]').src;
            const {jer: create} = await import(new URL('vscodroid-codex-BntLxKQb.js', base).href);
            const saved = window.__vscodroidHardwareKeyboardConnected;
            const rows = [];
            try {
                for (const test of [
                    {name: 'Enter sends', connected: true, expected: 1, paragraphs: 1},
                    {name: 'Shift+Enter newline', connected: true, shiftKey: true, expected: 0, paragraphs: 2},
                    {name: 'DOM Shift+Enter newline', connected: true, dom: true, shiftKey: true, expected: 0, paragraphs: 2},
                    {name: 'Active Korean composition Shift+Enter', connected: true, dom: true, shiftKey: true, isComposing: true, activeComposition: true, expected: 0, paragraphs: 2},
                    {name: 'DOM Enter sends once', connected: true, dom: true, expected: 1, paragraphs: 1},
                    {name: 'IME Enter does not send', connected: true, isComposing: true, expected: 0, paragraphs: 1},
                    {name: 'Detached keyboard newline', connected: false, expected: 0, paragraphs: 2},
                    {name: 'Reattached keyboard sends', connected: true, expected: 1, paragraphs: 1},
                    {name: 'Explicit newline preference', connected: true, behavior: 'newline', expected: 0, paragraphs: 2}
                ]) {
                    window.__vscodroidHardwareKeyboardConnected = test.connected;
                    const c = create('한글테스트', {defaultTextKind: 'prompt', enterBehavior: test.behavior || 'enter'});
                    let submits = 0;
                    c.eventEmitter.addListener('submit', () => submits++);
                    try {
                        if (test.activeComposition) c.view.dom.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
                        const key = new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                            shiftKey: !!test.shiftKey, isComposing: !!test.isComposing,
                            bubbles: true, cancelable: true
                        });
                        if (test.dom) c.view.dom.dispatchEvent(key);
                        else c.view.someProp('handleKeyDown', fn => fn(c.view, key));
                        rows.push({name: test.name, submits, paragraphs: c.view.state.doc.childCount,
                            pass: submits === test.expected && c.view.state.doc.childCount === test.paragraphs});
                    } finally { c.destroy(); }
                }
            } finally { window.__vscodroidHardwareKeyboardConnected = saved; }
            return rows;
        });
        console.log(JSON.stringify(rows, null, 2));
        assert(rows.every(row => row.pass), 'Codex Enter regression');
        if (process.argv.includes('--hardware')) {
            assert(process.env.ADB && process.env.ADB_SERIAL && process.env.KEYBOARD_DEVICE_ID,
                'Set ADB, ADB_SERIAL, KEYBOARD_DEVICE_ID; install the HardwareKeys debug helper first');
            await frame.evaluate(async () => {
                const {jer: create} = await import(new URL('vscodroid-codex-BntLxKQb.js', document.querySelector('script[src]').src).href);
                const c = create('Enter 진단', {defaultTextKind: 'prompt', enterBehavior: 'enter'});
                const host = document.createElement('div');
                host.style = 'position:fixed;bottom:0;left:0;z-index:2147483647;background:#222;color:white;padding:12px';
                host.append(c.view.dom);
                document.body.append(host);
                const test = window.__vscodroidEnterTest = {c, host, submits: 0, focus: document.activeElement};
                c.eventEmitter.addListener('submit', () => test.submits++);
                c.focus('end');
            });
            assert(/^\d+$/.test(process.env.KEYBOARD_DEVICE_ID));
            execFileSync(process.env.ADB, ['-s', process.env.ADB_SERIAL, 'shell',
                `CLASSPATH=/data/local/tmp/vscodroid-hardware-keys.dex app_process / HardwareKeys ${process.env.KEYBOARD_DEVICE_ID} 66`], {timeout: 10000});
            await frame.waitForFunction(() => window.__vscodroidEnterTest.submits === 1, null, {timeout: 3000});
            console.log('PASS: actual hardware/IME Enter reaches submit exactly once');
        }
    } finally {
        if (frame) await frame.evaluate(() => {
            const test = window.__vscodroidEnterTest;
            if (!test) return;
            test.c.destroy(); test.host.remove(); test.focus?.focus({preventScroll: true});
            delete window.__vscodroidEnterTest;
        }).catch(() => {});
        await browser.close(); // Disconnect the debugger, keeping Android alive.
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
