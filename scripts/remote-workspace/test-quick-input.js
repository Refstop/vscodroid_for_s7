'use strict';
// Exercise the shipped UI flow with the VS Code API boundary stubbed, not a copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { newestExtensionDir } = require('../lib/bundled-extension');
const extension = path.join(newestExtensionDir('vscodroid.vscodroid-saf-bridge'), 'extension.js');
const source = fs.readFileSync(extension, 'utf8');

function harness({ inputs = [], selection = 'host', states = ['ready'], trust = true, cancelled = false,
    lastRemote, workspaceFolders = [], transport = { port: 12345, token: "test-token" }, saveAll = true } = {}) {
    const commands = new Map(), calls = [], errors = [], prompts = [], saved = [], warnings = [];
    let hosts = lastRemote ? [lastRemote] : [];
    const state = new Map(lastRemote ? [['lastRemoteWorkspace', lastRemote]] : []);
    let resolver;
    const noop = () => ({ dispose() {} });
    const vscode = {
        Uri: { parse: value => value }, FileType: { File: 1 }, FileChangeType: { Changed: 1 },
        EventEmitter: class { event() {} fire() {} dispose() {} },
        ResolvedAuthority: class { constructor(host, port, token) { Object.assign(this, { host, port, token }); } },
        env: { language: 'ko', remoteName: '127.0.0.1:13338' }, ConfigurationTarget: { Global: 1 }, ProgressLocation: { Notification: 15 },
        workspace: {
            workspaceFolders, registerFileSystemProvider: noop, openTextDocument: async uri => uri,
            registerRemoteAuthorityResolver: (prefix, value) => { resolver = value; return noop(); },
            onDidChangeWorkspaceFolders: noop,
            saveAll: async () => saveAll,
            getConfiguration: () => ({ get: () => hosts, update: async (key, value) => { hosts = value; saved.push(JSON.stringify(value)); } })
        },
        commands: { registerCommand: (name, handler) => { commands.set(name, handler); return noop(); }, executeCommand: async (...args) => calls.push({ command: args }) },
        window: {
            showTextDocument: async uri => calls.push({ command: ['openConfig', uri] }),
            showInputBox: async options => { prompts.push(options); return inputs.shift(); },
            showErrorMessage: value => errors.push(value),
            showWarningMessage: value => warnings.push(value),
            showInformationMessage() {},
            showQuickPick: async items => trust === undefined ? undefined : items.find(i => i.trust === trust),
            withProgress: async (options, run) => run({ report() {} }, { isCancellationRequested: cancelled }),
            createQuickPick: () => {
                const handlers = {};
                const picker = {
                    items: [], selectedItems: [],
                    onDidChangeValue: callback => { handlers.value = callback; return noop(); },
                    onDidAccept: callback => { handlers.accept = callback; return noop(); },
                    onDidHide: callback => { handlers.hide = callback; return noop(); }, dispose() {},
                    show() {
                        if (selection === 'escape') { handlers.hide(); return; }
                        if (selection.startsWith('typed:')) {
                            handlers.value(selection.slice(6)); picker.selectedItems = picker.items.filter(i => i.command);
                        } else if (selection.startsWith('search:')) {
                            handlers.value(selection.slice(7)); picker.selectedItems = picker.items.slice(0, 1);
                        } else picker.selectedItems = picker.items.filter(i => selection === 'host' ? i.host : i.action === selection);
                        handlers.accept();
                    }
                };
                return picker;
            }
        }
    };
    const context = vm.createContext({ module: { exports: {} }, require: () => vscode, console, TextDecoder,
        setTimeout: fn => { queueMicrotask(fn); }, URL, TextEncoder, crypto: require('node:crypto').webcrypto });
    vm.runInContext(source, context, { filename: extension });
    context.sendBridgeCommand = async (cmd, data) => {
        if (cmd === 'resolveRemoteWorkspace') return transport;
        if (cmd === 'publishRemoteWorkspaceRoots') return {};
        const { request } = data;
        assert.equal(cmd, 'remoteSSH');
        if (request.action === 'resolveConfig') return { ...request }; // Native APK 21 returned the request action too.
        if (request.action === 'configHosts') return {hosts: []};
        calls.push(request);
        if (request.action === 'previousHost') return { host: 'host.example', user: 'dev', port: 22, folder: '/work' };
        if (request.action === 'commit' && request.reconnectAuthority) transport = { port: 23456, token: 'new-test-token' };
        if (request.action === 'start') return { id: 'attempt-1' };
        if (request.action === 'poll') return { state: states.shift() || 'ready', message: 'SHA256:verifiedFingerprint' };
        return {};
    };
    const startup = context.module.exports.registerRemoteSshCommands({ subscriptions: [], globalState: {
        get: key => state.get(key), update: async (key, value) => { state.set(key, value); }
    } });
    return { ...context.module.exports, commands, calls, errors, prompts, saved, state, startup, resolver, warnings };
}

(async () => {
    const { parseSshCommand } = harness();
    for (const command of ['ssh dev@host.example -p 2222', 'ssh -p2222 -l dev host.example', 'ssh://dev@host.example:2222']) {
        const {host, user, port} = parseSshCommand(command);
        assert.deepEqual({host,user,port}, { host: 'host.example', user: 'dev', port: 2222 });
    }
    assert.equal(parseSshCommand('ssh dev@[2001:db8::1]').host, '2001:db8::1');
    assert.deepEqual(JSON.parse(JSON.stringify(parseSshCommand('ssh -A -C -p 2222 -o ServerAliveInterval=30 dev@host.example').options)),
        {ForwardAgent:'yes', Compression:'yes', Port:'2222', ServerAliveInterval:'30'});
    assert.equal(parseSshCommand('ssh -a -o "ConnectTimeout 12" host.example').options.ForwardAgent, 'no');
    assert.equal(parseSshCommand('ssh -o ForwardAgent=yes host.example').options.ForwardAgent, 'yes');
    assert.throws(() => parseSshCommand('ssh -o ProxyCommand=evil host.example'), /Unsupported/);

    for (const command of ['', 'ssh host -p 0', 'ssh host -p 65536', 'ssh host -l', 'ssh host;id', 'ssh host whoami', 'ssh host -J jump', 'ssh://dev:password@host', 'ssh "host', 'ssh host\nwhoami']) {
        assert.throws(() => parseSshCommand(command), command);
    }
    const good = harness({ inputs: ['/work', 'temporary-test-secret'], states: ['hostKey', 'ready'] });
    await good.commands.get('vscodroid.connectRemoteWorkspace')();
    assert.deepEqual(good.calls.map(c => c.action), ['previousHost', 'start', 'poll', 'answer', 'poll', 'commit']);
    assert.equal(good.prompts[1].password, true);
    assert(!good.saved.join('').includes('temporary-test-secret'));
    assert.equal(good.errors.length, 0);
    for (const options of [
        { selection: 'escape' }, { inputs: [undefined] }, { inputs: ['/work', undefined] },
        { inputs: ['/work', 'secret'], states: ['hostKey'], trust: false },
        { inputs: ['/work', 'secret'], cancelled: true },
        { inputs: ['/work', 'secret'], states: ['error'] }
    ]) {
        const test = harness(options);
        await test.commands.get('vscodroid.connectRemoteWorkspace')();
        assert(!test.calls.some(c => c.action === 'commit'), JSON.stringify(options));
        if (test.calls.some(c => c.action === 'start')) assert(test.calls.some(c => c.action === 'cancel'));
    }
    const add = harness({ inputs: ['ssh -A -C added@new.example -p 2222'] });
    await add.commands.get('vscodroid.addRemoteHost')();
    assert(add.saved.at(-1).includes('new.example'));
    const persisted = add.calls.find(c => c.action === 'saveHostConfig');
    assert.equal(persisted.options.ForwardAgent, 'yes');
    assert.equal(persisted.options.Compression, 'yes');
    assert.equal(persisted.port, 2222);
    assert(!add.calls.some(c => c.action === 'start'));
    const duplicate = harness({ inputs: ['ssh dev@host.example'] });
    await duplicate.commands.get('vscodroid.addRemoteHost')();
    assert.equal(JSON.parse(duplicate.saved.at(-1))[0].folder, '/work');
    const direct = harness({ selection: 'typed:ssh new@other.example -p 2222', inputs: ['/src', 'secret'] });
    await direct.commands.get('vscodroid.connectRemoteWorkspace')();
    assert.equal(direct.calls.find(c => c.action === 'start').host, 'other.example');
    const search = harness({ selection: 'search:host', inputs: ['/work', 'secret'] });
    await search.commands.get('vscodroid.connectRemoteWorkspace')();
    assert.equal(search.calls.find(c => c.action === 'start').host, 'host.example');
    const configure = harness({ selection: 'configure' });
    await configure.commands.get('vscodroid.connectRemoteWorkspace')();
    assert(configure.calls.some(c => c.command?.[0] === 'openConfig'));
    const lastRemote = { host: 'host.example', user: 'dev', port: 22, folder: '/last/project' };
    const restored = harness({ lastRemote, inputs: ['temporary-test-secret'] });
    await restored.startup;
    assert.equal(restored.prompts.length, 1, 'Restore asks only for the password');
    assert.equal(restored.prompts[0].password, true);
    assert.equal(restored.calls.find(c => c.action === 'start').folder, '/last/project');
    assert(restored.calls.some(c => c.action === 'commit'));
    assert(!JSON.stringify([...restored.state]).includes('temporary-test-secret'));
    const cancelRestore = harness({ lastRemote, inputs: [undefined] });
    await cancelRestore.startup;
    assert.equal(cancelRestore.calls.length, 0);
    const failedRestore = harness({ lastRemote, inputs: ['secret'], states: ['error'] });
    await failedRestore.startup;
    assert.equal(failedRestore.errors.length, 1);
    assert(failedRestore.calls.some(c => c.action === 'cancel'));
    assert(!failedRestore.calls.some(c => c.action === 'commit'));
    const authority = 'ssh-remote+' + require('node:crypto').createHash('sha256').update('dev@host.example:22').digest('hex').slice(0,24);
    const alreadyRemote = harness({ lastRemote, workspaceFolders: [{ uri: {
        scheme: 'vscode-remote', authority, path: '/newer/project'
    } }] });
    await alreadyRemote.startup;
    assert.equal(alreadyRemote.prompts.length, 0);
    assert.equal(alreadyRemote.state.get('lastRemoteWorkspace').folder, '/newer/project');
    const remoteFolders = [{ uri: { scheme: 'vscode-remote', authority, path: '/newer/project' } }];
    const reconnect = harness({ lastRemote, workspaceFolders: remoteFolders, inputs: ['secret'],
        transport: { status: 'disconnected' }, saveAll: false });
    await reconnect.startup;
    assert(reconnect.resolver, 'Remote authority resolver must be registered');
    const [a, b] = await Promise.all([reconnect.resolver.resolve(authority), reconnect.resolver.resolve(authority)]);
    assert.equal(a.port, 23456);
    assert.equal(b.token, 'new-test-token');
    assert.equal(reconnect.prompts.length, 1, 'Concurrent resolves share one password prompt');
    assert.equal(reconnect.calls.filter(c => c.action === 'start').length, 1);
    assert.equal(reconnect.calls.find(c => c.action === 'commit').reconnectAuthority, authority);
    assert.equal(reconnect.calls.find(c => c.action === 'start').folder, '/newer/project');
    await reconnect.resolver.resolve(authority);
    assert.equal(reconnect.prompts.length, 1, 'Healthy reload never prompts');
    const cancelledReconnect = harness({ lastRemote, workspaceFolders: remoteFolders,
        transport: { status: 'disconnected' }, inputs: [undefined, 'secret'] });
    await cancelledReconnect.startup;
    await assert.rejects(cancelledReconnect.resolver.resolve(authority), /cancel|취소/i);
    assert.equal(cancelledReconnect.calls.length, 0);
    await cancelledReconnect.resolver.resolve(authority);
    assert.equal(cancelledReconnect.prompts.length, 2, 'Cancel permits a subsequent retry');
    const unknown = harness({ lastRemote, workspaceFolders: remoteFolders, transport: { status: 'disconnected' } });
    await unknown.startup;
    await assert.rejects(unknown.resolver.resolve('ssh-remote+unknown'), /host|호스트/i);
    assert.equal(unknown.prompts.length, 0, 'Never reconnect to an unrelated saved host');
    const mismatch = harness({ lastRemote, workspaceFolders: remoteFolders,
        transport: { status: 'authorityMismatch', message: 'Different active SSH host' } });
    await mismatch.startup;
    await assert.rejects(mismatch.resolver.resolve(authority), /Different active SSH host/);
    assert.equal(mismatch.prompts.length, 0);
    const failedReconnect = harness({ lastRemote, workspaceFolders: remoteFolders, inputs: ['secret'],
        transport: { status: 'disconnected' }, states: ['error'] });
    await failedReconnect.startup;
    await assert.rejects(failedReconnect.resolver.resolve(authority));
    assert(failedReconnect.calls.some(c => c.action === 'cancel'));
    const setupWarning = harness({ lastRemote, workspaceFolders: remoteFolders,
        transport: { port: 12345, token: 'test-token', setupWarnings: ['Unsupported Codex version'] } });
    await setupWarning.startup;
    await setupWarning.resolver.resolve(authority);
    await setupWarning.resolver.resolve(authority);
    assert.equal(setupWarning.warnings.length, 1, 'Setup failure is visible once without blocking SSH');
    console.log('PASS: disconnected reload, single-flight reconnect, healthy reload, cancellation/retry, unknown host, authority mismatch, and failed authentication');
    console.log('PASS: SSH parsing, host migration/add/select, masked password, host-key trust, cancellation, failure cleanup, and settings navigation');
    console.log('PASS: last workspace restore asks only for password, remembers folder changes, skips active remote, and handles cancel/failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
