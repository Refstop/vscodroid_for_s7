'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/assets/server.js'), 'utf8');
const functions = source.slice(source.indexOf('function extendWorkbenchPage('), source.indexOf('// How long the editor server'));
const api = { fs, path, crypto, writeThroughRename: (file, data) => fs.writeFileSync(file, data) };
vm.createContext(api);
vm.runInContext(functions, api);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscodroid-ui-cache-'));
try {
    const manifest = { publisher: 'vscodroid', browser: './extension.js' };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, 'extension.js'), 'old code');
    fs.writeFileSync(path.join(dir, 'package.nls.ko.json'), '{}');
    const first = api.uiExtensionDirectory(dir, 'bridge', manifest);
    assert.equal(api.uiExtensionDirectory(dir, 'bridge', manifest), first);
    for (const file of ['extension.js', 'package.json', 'package.nls.ko.json']) {
        const before = api.uiExtensionDirectory(dir, 'bridge', manifest);
        fs.appendFileSync(path.join(dir, file), ' ');
        assert.notEqual(api.uiExtensionDirectory(dir, 'bridge', manifest), before, file);
    }
    assert.equal(api.uiExtensionDirectory(dir, 'other', { publisher: 'other' }), 'other');
    const page = path.join(dir, 'workbench.html');
    fs.writeFileSync(page, '<meta id="vscode-workbench-web-configuration" data-settings="{{WORKBENCH_WEB_CONFIGURATION}}">\n<script nonce="{{WORKBENCH_SCRIPT_NONCE}}">existing();</script>');
    api.refreshRemoteWorkbenchPage(page, ['var LOCAL_UI_EXTENSIONS = ["old"];']);
    api.refreshRemoteWorkbenchPage(page, ['var LOCAL_UI_EXTENSIONS = ["new"];']);
    const html = fs.readFileSync(page, 'utf8');
    assert.equal(html.match(/vscodroid-remote-workbench-v1/g).length, 1);
    assert(!html.includes('["old"]'));
    assert(html.includes('["new"]'));
    assert(html.includes('<script nonce="{{WORKBENCH_SCRIPT_NONCE}}">existing();</script>'));
    assert.equal(html.match(/<script nonce=/g).length, 2);
    console.log('PASS: code, manifest and locale updates change cached URLs; restart refreshes one CSP-compatible extension list');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
