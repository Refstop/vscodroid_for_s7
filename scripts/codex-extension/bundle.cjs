// Run on the Linux SSH host: node bundle.cjs <extension-directory> [--restore]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {patchKeyboard} = require('./keyboard-compat.cjs');
const {patchQueue} = require('./queue-compat.cjs');
const {installHtmlOpen} = require('./html-preview-compat.cjs');
const patchCompatibility = source => patchQueue(patchKeyboard(source));
const digest = source => createHash('sha256').update(source).digest('hex');
const expectedHtml = 'd542fed64423f56c08a20554c842f7bc247642a718d7a8d797ee66de6959e9b1';
const roots = ['index-7e47869603c2.js', 'app-main-765fabf054a6.js', 'app-runtime-ca74aa759873.js'];
const hashes = [
    '21800da00f2223d72f20bf4e73291df232941f2cb9d51acd080273fc9f124325',
    '2a66e9900da878a6e2f9a1f0e2e7114fd44f8952a64c7a2486a5b09bc4e0953f',
    'd2564b2aa1f07c7a0f9d2179544823020dcf3b26c7e66adcc0734293d3100f68'
];
const helperName = 'app-initial-13f932cb2f13.js';
const prefix = 'vscodroid-codex-';

async function main() {
    assert(process.argv[2], 'Usage: node bundle.cjs <extension-directory> [--restore]');
    const extension = fs.realpathSync(process.argv[2]);
    const pkg = JSON.parse(fs.readFileSync(path.join(extension, 'package.json')));
    assert(pkg.publisher === 'openai' && pkg.name === 'chatgpt' && pkg.version === '26.1021.22027',
        'This compatibility build supports only openai.chatgpt 26.1021.22027');
    const webview = path.join(extension, 'webview');
    const assets = path.join(webview, 'assets');
    const htmlPath = path.join(webview, 'index.html');
    const backup = path.join(extension, '.vscodroid-webview-backup');
    const statePath = path.join(backup, 'state.json');
    const currentHtml = fs.readFileSync(htmlPath, 'utf8');
    const atomicHtml = html => {
        fs.writeFileSync(htmlPath + '.vscodroid-tmp', html);
        fs.renameSync(htmlPath + '.vscodroid-tmp', htmlPath);
    };
    if (process.argv[3] === '--restore') {
        const state = JSON.parse(fs.readFileSync(statePath));
        const original = fs.readFileSync(path.join(backup, 'index.html'), 'utf8');
        assert.equal(digest(original), expectedHtml, 'Backup does not match this extension');
        assert([state.htmlHash, expectedHtml].includes(digest(currentHtml)), 'HTML changed since patch; refusing to overwrite it');
        installHtmlOpen(extension, true);
        atomicHtml(original);
        // Keep bundles until the editor reloads: existing views may still import them.
        console.log('Restored original HTML. Reload the editor to use the original extension.');
        return;
    }
    assert(!process.argv[3], 'Unknown option');
    if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath));
        if (digest(currentHtml) === state.htmlHash) {
            for (const [name, hash] of Object.entries(state.files))
                assert.equal(digest(fs.readFileSync(path.join(assets, name))), hash, `Changed bundle: ${name}`);
            installHtmlOpen(extension);
            let changed = 0;
            for (const name of Object.keys(state.files)) {
                const file = path.join(assets, name);
                const source = fs.readFileSync(file, 'utf8');
                const patched = patchCompatibility(source);
                if (patched === source) continue;
                fs.writeFileSync(file + '.vscodroid-tmp', patched);
                fs.renameSync(file + '.vscodroid-tmp', file);
                state.files[name] = digest(patched);
                changed++;
            }
            if (changed) {
                fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2));
                fs.renameSync(statePath + '.tmp', statePath);
            }
            console.log(changed ? `Updated compatibility in ${changed} bundle(s).` :
                'Compatibility bundle is already installed and verified.');
            return;
        }
    }
    assert.equal(digest(currentHtml), expectedHtml, 'Unsupported or modified webview HTML');
    roots.forEach((name, i) => assert.equal(digest(fs.readFileSync(path.join(assets, name))), hashes[i], `Changed entry: ${name}`));
    const helper = fs.readFileSync(path.join(assets, helperName), 'utf8');
    assert.equal(digest(helper), '9852ece5b9a25906b654fa8cccd77873105fe1b88556b141fc35dc4062511629', 'Changed preload helper');

    const {init, parse} = require('es-module-lexer');
    await init;
    const initial = new Set();
    function visit(file) {
        if (initial.has(file)) return;
        assert(file.startsWith(assets + path.sep), 'Module outside assets');
        initial.add(file);
        for (const item of parse(fs.readFileSync(file, 'utf8'))[0]) {
            if (item.d !== -1) continue; // Preserve lazy imports.
            assert(item.n?.startsWith('./'), `Unexpected static import: ${item.n}`);
            visit(path.resolve(path.dirname(file), item.n));
        }
    }
    roots.forEach(name => visit(path.join(assets, name)));
    // Keep entry/main/runtime separate. Merging the top-level-await entry with its
    // dynamic dependencies creates a module-evaluation deadlock in Chromium.
    roots.forEach(name => initial.delete(path.join(assets, name)));
    assert.equal(initial.size, 3044, 'Startup graph changed; revalidate before applying');

    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vscodroid-codex-'));
    let bundle;
    try {
        const {rolldown} = await import('rolldown');
        bundle = await rolldown({
            input: path.join(assets, roots[0]),
            plugins: [{name: 'preserve-css-preloads', transform(source, id) {
                if (id !== path.join(assets, helperName)) return;
                // Bundles replace original JS preloads; CSS still uses original URLs.
                return source.replace('let r=t.endsWith(`.css`);for(let n=e.length-1;',
                    'let r=t.endsWith(`.css`);if(!r)return;for(let n=e.length-1;');
            }}]
        });
        const result = await bundle.write({
            dir: stage, format: 'es', entryFileNames: prefix + 'entry.js',
            chunkFileNames: prefix + '[hash].js',
            minify: {compress: false, mangle: false, codegen: {removeWhitespace: true}},
            codeSplitting: {groups: [{name: id => initial.has(id) ? 'startup' : null}]}
        });
        const files = {};
        for (const output of result.output) {
            assert(output.fileName.startsWith(prefix) && path.basename(output.fileName) === output.fileName,
                'Unexpected output path');
            const data = patchCompatibility(fs.readFileSync(path.join(stage, output.fileName), 'utf8'));
            files[output.fileName] = digest(data);
            fs.writeFileSync(path.join(assets, output.fileName), data);
        }
        const html = currentHtml.replace(/<link\b[^>]*rel="modulepreload"[^>]*>\s*/g, '')
            .replace('assets/' + roots[0], 'assets/' + prefix + 'entry.js');
        assert(html.includes('assets/' + prefix + 'entry.js'), 'Entry replacement failed');
        fs.mkdirSync(backup, {recursive: true});
        fs.writeFileSync(path.join(backup, 'index.html'), currentHtml);
        fs.writeFileSync(statePath, JSON.stringify({version: pkg.version, htmlHash: digest(html), files}, null, 2));
        // Publish only after all modules and the rollback information are on disk.
        installHtmlOpen(extension);
        atomicHtml(html);
        console.log(`Installed ${Object.keys(files).length} bundles; consolidated ${initial.size} startup modules. Reload the editor.`);
    } finally {
        await bundle?.close();
        fs.rmSync(stage, {recursive: true, force: true});
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
