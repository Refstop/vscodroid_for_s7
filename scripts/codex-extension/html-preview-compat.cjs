// Honor the user's editor association for HTML links instead of forcing raw text.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const original = 'let y=await eo.workspace.openTextDocument(v),w=new eo.Position';
const replacement = 'if(/\\.html?$/i.test(v.path))return await eo.commands.executeCommand("vscode.open",v,{preview:!1}),!0;' + original;
const expectedHash = 'a9cc6736cd2c2d22f6cf43fc5763d5f8a873e4f741f522b44a600b1926f4e627';
const hash = source => createHash('sha256').update(source).digest('hex');
function patchHtmlOpen(source) {
    if (source.includes(replacement)) return source;
    assert.equal(source.split(original).length, 2, 'Unsupported Codex file opener');
    return source.replace(original, replacement);
}
function installHtmlOpen(extension, restore = false) {
    const pkg = JSON.parse(fs.readFileSync(path.join(extension, 'package.json')));
    assert(pkg.publisher === 'openai' && pkg.name === 'chatgpt' && pkg.version === '26.1021.22027', 'Unsupported Codex version');
    const file = path.join(extension, 'out/extension.js');
    const backup = path.join(extension, '.vscodroid-webview-backup/html-open-original.js');
    if (restore && !fs.existsSync(backup)) return;
    const current = fs.readFileSync(file, 'utf8');
    const pristine = fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : current;
    assert.equal(hash(pristine), expectedHash, 'Codex extension host changed; revalidate HTML opener');
    const patched = patchHtmlOpen(pristine);
    assert(current === pristine || current === patched, 'Refusing to overwrite unrelated extension host changes');
    const result = restore ? pristine : patched;
    if (result === current) return;
    if (!restore && !fs.existsSync(backup)) {
        fs.mkdirSync(path.dirname(backup), {recursive:true});
        fs.writeFileSync(backup, pristine, {flag:'wx'});
    }
    fs.writeFileSync(file + '.vscodroid-tmp', result);
    fs.renameSync(file + '.vscodroid-tmp', file);
    console.log(restore ? 'Restored original Codex HTML opener.' : 'Codex HTML links now honor the default editor. Reload when current work is finished.');
}
module.exports = {patchHtmlOpen, installHtmlOpen};
if (require.main === module) {
    try { assert(process.argv[2], 'Pass the Codex extension directory'); installHtmlOpen(process.argv[2], process.argv[3] === '--restore'); }
    catch (e) {console.error(e.message); process.exitCode=1;}
}
