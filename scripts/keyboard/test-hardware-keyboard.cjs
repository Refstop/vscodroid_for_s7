// Real DOM coverage for hardware connection state. Actual Samsung/Hangul IME
// coverage lives in verify-korean.cjs: desktop CDP typing bypasses Android's IME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const script = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/assets/hardware-keyboard.js'), 'utf8');
(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
    try {
        const page = await browser.newPage();
        await page.setContent('<input id="host"><textarea class="xterm-helper-textarea" id="terminal" inputmode="none" virtualkeyboardpolicy="auto"></textarea><div class="native-edit-context" contenteditable="true" inputmode="none" id="editor"></div><input id="custom" inputmode="none">');
        await page.evaluate(script);
        await page.evaluate(() => window.__vscodroidSetHardwareKeyboard(true));
        for (const id of ['host', 'terminal', 'editor']) {
            assert.notEqual(await page.locator('#' + id).getAttribute('virtualkeyboardpolicy'), 'manual');
            assert.equal(await page.locator('#' + id).getAttribute('inputmode'), null);
            await page.locator('#' + id).click();
            await page.keyboard.type('hardware');
        }
        assert.equal(await page.locator('#host').inputValue(), 'hardware');
        assert.equal(await page.locator('#terminal').inputValue(), 'hardware');
        assert.equal(await page.locator('#editor').innerText(), 'hardware');
        assert.equal(await page.locator('#custom').getAttribute('inputmode'), 'none');
        await page.evaluate(() => {
            const input = document.createElement('input'); input.id = 'dynamic'; document.body.append(input);
        });
        assert.equal(await page.locator('#dynamic').getAttribute('virtualkeyboardpolicy'), null);
        await page.locator('#host').focus();
        await page.evaluate(() => { window.__blurred = 0; document.querySelector('#host').addEventListener('blur', () => window.__blurred++); });
        await page.evaluate(() => window.__vscodroidSetHardwareKeyboard(false));
        assert.equal(await page.evaluate(() => window.__blurred), 0);
        assert.equal(await page.locator('#terminal').getAttribute('virtualkeyboardpolicy'), 'auto');
        assert.equal(await page.evaluate(() => window.__vscodroidHardwareKeyboardConnected), false);
        await page.evaluate(() => { const f = document.createElement('iframe'); f.src = 'data:text/html,<input id="child">'; document.body.append(f); });
        const child = page.frames().find(frame => frame !== page.mainFrame());
        await child.waitForSelector('input');
        await child.evaluate(script);
        await page.evaluate(() => window.__vscodroidSetHardwareKeyboard(true));
        await child.waitForFunction(() => window.__vscodroidHardwareKeyboardConnected === true);
        assert.equal(await child.locator('input').getAttribute('virtualkeyboardpolicy'), null);
        await page.evaluate(() => window.__vscodroidSetHardwareKeyboard(false));
        await child.waitForFunction(() => window.__vscodroidHardwareKeyboardConnected === false);
        console.log('PASS: normal IME policy, editing-host holds released, dynamic inputs, focus and iframe state');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
