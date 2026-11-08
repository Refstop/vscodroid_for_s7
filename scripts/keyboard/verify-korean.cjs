// Real-device regression: use Android's IME with the attached keyboard's device
// ID, not CDP insertText (which bypasses Hangul composition). Requires the test
// HardwareKeys dex at /data/local/tmp/vscodroid-hardware-keys.dex and CDP :19223.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const adb = (...args) => execFileSync(process.env.ADB || 'adb', args, {encoding: 'utf8'});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const keys = [35, 39, 47, 46, 41, 34, 52, 44, 48, 41, 52, 41, 62]; // gksrmfxptmxm + space
(async () => {
    const devices = adb('shell', 'dumpsys', 'input');
    const keyboard = [...devices.matchAll(/Device (\d+):[^\n]+\n(?:(?!  Device ).|\n)*?KeyboardType: 2/g)]
        .find(match => match[0].includes('IsExternal: true'));
    assert(keyboard, 'Attach a physical alphabetic keyboard');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:19223');
    try {
        const page = browser.contexts().flatMap(c => c.pages())[0];
        page.setDefaultTimeout(5000);
        const typeKorean = (switchLanguage = false) => adb('shell',
            'CLASSPATH=/data/local/tmp/vscodroid-hardware-keys.dex', 'app_process', '/',
            'HardwareKeys', keyboard[1], ...(switchLanguage ? ['204'] : []), ...keys.map(String));
        if (process.argv.includes('--terminal')) {
            // Run on the SSH host, with a fresh disposable bash terminal focused
            // in VSCodroid. Never use this mode inside an existing CLI/program.
            assert(await page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')),
                'Focus a fresh disposable terminal first');
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscodroid-korean-'));
            try {
                const output = path.join(dir, 'terminal.txt');
                await page.keyboard.insertText("printf '%s\\n' '");
                typeKorean();
                await pause(750);
                await page.keyboard.insertText("' > " + output);
                await page.keyboard.press('Enter');
                for (let i = 0; i < 30 && !fs.existsSync(output); i++) await pause(100);
                assert.equal(fs.readFileSync(output, 'utf8').trim(), '한글테스트',
                    'Terminal received an incomplete/recomposed Hangul syllable');
                assert(!/InsetsSource type=ITYPE_IME .*visible=true/.test(adb('shell', 'dumpsys', 'window', 'displays')),
                    'Software keyboard appeared');
                console.log('PASS: remote shell received exact 한글테스트 while the software keyboard stayed hidden');
            } finally { fs.rmSync(dir, {recursive: true, force: true}); }
            return;
        }
        let value;
        for (let attempt = 0; attempt < 2; attempt++) {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Control+Shift+p');
            const input = page.locator('.quick-input-box input');
            await input.fill('');
            await input.click({timeout: 3000});
            await pause(500);
            typeKorean(attempt > 0);
            await pause(750);
            value = (await input.inputValue()).trim();
            if (value === '한글테스트') break;
        }
        assert.equal(value, '한글테스트', 'Hardware keys did not produce the expected Korean composition');
        const windows = adb('shell', 'dumpsys', 'window', 'displays');
        assert(!/InsetsSource type=ITYPE_IME .*visible=true/.test(windows), 'Software keyboard appeared');
        console.log('PASS: physical-key IME produces 한글테스트 with the software keyboard hidden');
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
