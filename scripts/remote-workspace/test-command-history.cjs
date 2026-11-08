// Exercise the actual bundled CommandsHistory, without a graceful shutdown event.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let source = fs.readFileSync(process.argv[2], 'utf8');
if (process.argv.includes('--patched')) {
    const server = fs.readFileSync(require('node:path').join(__dirname, '../../android/app/src/main/assets/server.js'), 'utf8');
    const helper = server.match(/function persistCommandHistory\(source\) \{[\s\S]*?\n\}/)?.[0];
    assert(helper, 'Missing production history patch');
    const patch = vm.runInNewContext(helper + ';persistCommandHistory');
    const original = source;
    source = patch(source);
    assert.equal(patch(source), source, 'Patch must be idempotent');
    assert.throws(() => patch('unsupported workbench'), /Unsupported/);
    assert.throws(() => patch(original + original), /Unsupported/);
}
const start = source.lastIndexOf('var rp=class', source.indexOf('commandPalette.mru.cache'));
const end = source.indexOf(';rp=I(', start);
assert(start >= 0 && end > start, 'Pinned CommandsHistory changed');
const History = vm.runInNewContext(source.slice(start, end) + ';rp', {
    x: class { _register() {} },
    Ps: class extends Map { constructor(limit) { super(); this.limit=limit; } peek(key) { return this.get(key); } }
});
const saved = new Map();
const storage = {get:k=>saved.get(k), getNumber:(k,scope,fallback)=>saved.get(k)??fallback,
    store:(k,v)=>saved.set(k,v), onWillSaveState:()=>({dispose(){}})};
const config = {getValue:()=>({workbench:{commandPalette:{history:50}}}), onDidChangeConfiguration:()=>({dispose(){}})};
const history = new History(storage,config,console);
history.push('vscodroid.connectRemoteWorkspace');
assert(saved.has('commandPalette.mru.cache'), 'Recent command was never stored before renderer destruction');
const afterReload = new History(storage,config,console);
assert.equal(afterReload.peek('vscodroid.connectRemoteWorkspace'), 1);
afterReload.push('workbench.action.terminal.new');
assert.equal(new History(storage,config,console).peek('workbench.action.terminal.new'), 2);
console.log('PASS: actual command MRU survives a new renderer without graceful shutdown');
