// Real bundled composer + Android DOM dispatch, without opening a chat or sending messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const {patchKeyboard} = require('./keyboard-compat.cjs');
(async () => {
    assert(process.argv[2], 'Pass the installed pinned Codex extension directory');
    const root = path.resolve(process.argv[2], 'webview/assets');
    const server = http.createServer((req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname.slice(1);
        if (!name) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body></body></html>'); return; }
        if (name !== path.basename(name) || !fs.existsSync(path.join(root, name))) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/plain');
        let source = fs.readFileSync(path.join(root, name));
        if (name === 'vscodroid-codex-BntLxKQb.js') {
            // The app normally initializes this lazy module before constructing a composer.
            source = source.toString() + '\nexport { Fa$17 as initializeComposerForQA };';
        }
        res.end(process.argv.includes('--preview-patch') && name.endsWith('.js') ? patchKeyboard(source.toString()) : source);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
        const page = await browser.newPage({userAgent:'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', hasTouch:true});
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.addInitScript(() => { window.acquireVsCodeApi = () => ({postMessage() {}, getState() {}, setState() {}}); });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const rows = await page.evaluate(async () => {
            const {jer:create, initializeComposerForQA} = await import('/vscodroid-codex-BntLxKQb.js');
            initializeComposerForQA();
            const result = [];
            for (const test of [
                {name:'Shift+Enter inserts a paragraph', key:'Shift+Enter', paragraphs:2, submits:0},
                {name:'Active Korean composition Shift+Enter commits and inserts a paragraph', key:'Shift+Enter', composing:true, activeComposition:true, paragraphs:2, submits:0},
                {name:'Enter submits once', key:'Enter', paragraphs:1, submits:1},
                {name:'Explicit newline preference', key:'Enter', behavior:'newline', paragraphs:2, submits:0},
                {name:'IME Enter does not send', key:'Enter', composing:true, paragraphs:1, submits:0},
                {name:'Active IME Enter only commits', key:'Enter', composing:true, activeComposition:true, paragraphs:1, submits:0},
                {name:'Detached active IME stays untouched', key:'Shift+Enter', connected:false, composing:true, activeComposition:true, paragraphs:1, submits:0},
                {name:'Detached IME stays on Android fallback', key:'Shift+Enter', connected:false, paragraphs:1, submits:0},
                {name:'Reattached Shift+Enter inserts a paragraph', key:'Shift+Enter', paragraphs:2, submits:0}
            ]) {
                window.__vscodroidHardwareKeyboardConnected = test.connected !== false;
                const c = create('한글 test', {defaultTextKind:'prompt', enterBehavior:test.behavior || 'enter'});
                let submits = 0;
                c.eventEmitter.addListener('submit', () => submits++);
                try {
                    if (test.activeComposition) c.view.dom.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true, data:''}));
                    const e = new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, which:13,
                        shiftKey:test.key.startsWith('Shift'), isComposing:!!test.composing, bubbles:true, cancelable:true});
                    // Go through ProseMirror's DOM listener, not directly to its keymap.
                    c.view.dom.dispatchEvent(e);
                    const paragraphs = c.view.state.doc.childCount;
                    result.push({name:test.name, paragraphs, submits,
                        pass:paragraphs===test.paragraphs && submits===test.submits});
                } finally {c.destroy();}
            }
            return result;
        });
        console.log(JSON.stringify(rows, null, 2));
        assert(rows.every(r => r.pass), 'Android DOM key handling regression');
        // Browser-generated input also exercises beforeinput/default actions:
        // the patched keymap must insert once, with no duplicate browser newline.
        await page.evaluate(async () => {
            const {jer:create} = await import('/vscodroid-codex-BntLxKQb.js');
            const c = create('한글 test', {defaultTextKind:'prompt', enterBehavior:'enter'});
            const t = window.composerQA = {c, submits:0};
            c.eventEmitter.addListener('submit', () => t.submits++);
            document.body.append(c.view.dom); c.focus('end');
        });
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('second line');
        const typed = await page.evaluate(() => ({paragraphs:window.composerQA.c.view.state.doc.childCount,
            text:window.composerQA.c.view.state.doc.textBetween(0,window.composerQA.c.view.state.doc.content.size,'\n'),
            submits:window.composerQA.submits}));
        assert.deepEqual(typed, {paragraphs:2, text:'한글 test\nsecond line', submits:0});
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.composerQA.submits), 1);
        await page.evaluate(() => {window.composerQA.c.destroy(); delete window.composerQA;});
        console.log('PASS: browser Shift+Enter + text inserts one newline; Enter submits exactly once');

        // A real Chromium composition range catches the data corruption missed by
        // isComposing-only events: Shift+Enter must commit it before splitting.
        const cdp = await page.context().newCDPSession(page);
        await page.evaluate(async () => {
            const {jer:create} = await import('/vscodroid-codex-BntLxKQb.js');
            const c = create('', {defaultTextKind:'prompt', enterBehavior:'enter'});
            window.composerQA = {c, submits:0};
            c.eventEmitter.addListener('submit', () => window.composerQA.submits++);
            document.body.append(c.view.dom); c.focus('end');
        });
        for (const text of ['테스트', '다음줄']) {
            await cdp.send('Input.imeSetComposition', {text, selectionStart:text.length, selectionEnd:text.length});
            assert.equal(await page.evaluate(() => window.composerQA.c.view.composing), true);
            await page.keyboard.press('Shift+Enter');
            assert.equal(await page.evaluate(() => window.composerQA.c.view.composing), false, 'IME must finish before the caret moves');
        }
        await page.keyboard.type('last');
        assert.deepEqual(await page.evaluate(() => {
            const {c,submits} = window.composerQA;
            return {paragraphs:c.view.state.doc.childCount, text:c.view.state.doc.textBetween(0,c.view.state.doc.content.size,'\n'), submits};
        }), {paragraphs:3, text:'테스트\n다음줄\nlast', submits:0});
        await page.evaluate(() => {window.composerQA.c.destroy(); delete window.composerQA;});
        console.log('PASS: real Chromium Korean IME commits, one newline, repeated composition and subsequent text preserved');

    } finally {await browser?.close(); await new Promise(r => server.close(r));}
})().catch(e => {console.error(e); process.exitCode=1;});
