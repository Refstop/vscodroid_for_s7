// NODE_PATH=<Playwright modules> node scripts/codex-extension/verify-codex.cjs
// Open the Codex sidebar first. Requires the tablet WebView DevTools socket
// forwarded to localhost:19223. Pass --reload to test a workbench reload too.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const watchdog = setTimeout(() => {
    console.error('Codex verification exceeded 45 seconds (unresponsive renderer or CDP)');
    process.exit(1);
}, 45000);
(async () => {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:19223');
    try {
        const page = browser.contexts().flatMap(c => c.pages())[0];
        const started = Date.now();
        if (process.argv.includes('--reload')) await page.reload({waitUntil: 'domcontentloaded', timeout: 15000});
        const deadline = Date.now() + 35000;
        while (Date.now() < deadline) {
            const failure = await page.locator('.monaco-dialog-box:visible').allTextContents();
            assert(!failure.some(s => s.includes("command 'chatgpt.openSidebar' not found")),
                'Codex sidebar command was not registered');
            for (const frame of page.frames()) {
                if (frame === page.mainFrame()) continue;
                const verdict = await frame.evaluate(() => ({
                    timeout: /Codex could not start|did not become ready|The extension could not start/.test(document.body?.innerText || ''),
                    ready: !!document.querySelector('textarea, [contenteditable="true"], button') &&
                        !!document.querySelector('#root')?.children.length
                })).catch(() => null);
                assert(!verdict?.timeout, 'Codex renderer reported a startup error');
                if (verdict?.ready) {
                    console.log(`PASS: Codex webview rendered interactive UI (${Date.now() - started} ms)`);
                    return;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.fail('Codex sidebar did not render interactive UI within 35 seconds');
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
