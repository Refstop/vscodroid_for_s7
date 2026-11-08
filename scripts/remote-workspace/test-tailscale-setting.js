'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { newestExtensionDir } = require('../lib/bundled-extension');
const root = newestExtensionDir('vscodroid.vscodroid-saf-bridge');
const calls = [];
let value = false, changed, openSettings;
const vscode = { commands: {
    registerCommand: (name, handler) => { assert.equal(name, 'vscodroid.configureTailscale'); openSettings = handler; return { dispose() {} }; },
    executeCommand: (...args) => args
}, workspace: {
    getConfiguration: () => ({ get: () => value }),
    onDidChangeConfiguration: handler => { changed = handler; return { dispose() {} }; }
} };
const context = vm.createContext({ module: { exports: {} }, require: () => vscode, console });
vm.runInContext(fs.readFileSync(path.join(root, 'extension.js'), 'utf8'), context);
context.sendBridgeCommand = async (command, args) => calls.push({ command, enabled: args.enabled });
context.module.exports.registerTailscaleAutomation({ subscriptions: [] });
assert.deepEqual(openSettings(), ['workbench.action.openSettings', '@id:vscodroid.tailscale.autoConnect']);
assert.deepEqual(calls, [{ command: 'configureTailscaleAutomation', enabled: false }]);
value = true;
changed({ affectsConfiguration: () => false });
assert.equal(calls.length, 1);
changed({ affectsConfiguration: key => key === 'vscodroid.tailscale.autoConnect' });
assert.equal(calls.at(-1).enabled, true);
value = false;
changed({ affectsConfiguration: () => true });
assert.equal(calls.at(-1).enabled, false);
const setting = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
    .contributes.configuration.properties['vscodroid.tailscale.autoConnect'];
assert.equal(setting.scope, 'application'); // A repository must not opt the device into VPN control.
assert.equal(setting.default, false);
console.log('PASS: Tailscale setting applies on activation/change, ignores unrelated changes, and is user-only opt-in');
