const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {configureSettings,installed}=require('./setup-remote.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vscodroid-setup-'));
try {
    const settings=path.join(root,'settings.json');
    fs.writeFileSync(settings,'{\n // Keep this comment\n "editor.fontSize": 17,\n "workbench.editorAssociations": {"*.html":"default"},\n}\n');
    configureSettings(settings);
    let text=fs.readFileSync(settings,'utf8');
    assert(text.includes('// Keep this comment')&&text.includes('"editor.fontSize": 17'));
    assert.equal(require('./vendor/jsonc-parser/lib/umd/main.js').parse(text)['workbench.editorAssociations']['*.html'],'default');
    assert(text.includes('"*.htm": "simpleHtmlViewer.preview"'));
    configureSettings(settings);assert.equal(fs.readFileSync(settings,'utf8'),text);
    fs.writeFileSync(settings,'{invalid json');assert.throws(()=>configureSettings(settings),/preserved/);
    assert.equal(fs.readFileSync(settings,'utf8'),'{invalid json');
    const fresh=path.join(root,'fresh/settings.json');configureSettings(fresh);
    assert.equal(JSON.parse(fs.readFileSync(fresh))['workbench.editorAssociations']['*.html'],'simpleHtmlViewer.preview');
    console.log('PASS: fresh HTML defaults, JSONC/comments, other settings, user overrides, idempotence and invalid-file preservation');
    if(process.argv[2]) {
        // Fresh HOME: use the real remote CLI and pinned HTML download. An unknown
        // Codex version must be retained, never downgraded or patched speculatively.
        const home=path.join(root,'home');
        const extensions=path.join(home,'.local/share/vscodroid-remote/oss-extensions');
        const codex=path.join(extensions,'openai.chatgpt-unknown');fs.mkdirSync(codex,{recursive:true});
        fs.writeFileSync(path.join(codex,'package.json'),JSON.stringify({publisher:'openai',name:'chatgpt',version:'99.0.0'}));
        fs.writeFileSync(path.join(extensions,'extensions.json'),JSON.stringify([{identifier:{id:'openai.chatgpt'},version:'99.0.0',location:{scheme:'file',path:codex},relativeLocation:path.basename(codex)}]));
        const r=spawnSync(process.execPath,[path.join(__dirname,'setup-remote.cjs'),process.argv[2]],{env:{...process.env,HOME:home},encoding:'utf8',timeout:180000});
        assert.equal(r.status,0,r.stderr);assert(r.stdout.includes('VSCODROID_WARNING=Codex setup: Codex 99.0.0'),r.stdout);
        assert.equal(installed(extensions,'austin-spagnolo.simple-html-viewer').length,1,r.stdout);
        assert.equal(installed(extensions,'openai.chatgpt')[0].version,'99.0.0');
        assert.equal(JSON.parse(fs.readFileSync(path.join(home,'.local/share/vscodroid-remote/oss-data/data/Machine/settings.json')))['workbench.editorAssociations']['*.html'],'simpleHtmlViewer.preview');
        console.log('PASS: isolated fresh HOME installs HTML with the real CLI and preserves an unsupported Codex version with a visible warning');
    }
}finally{fs.rmSync(root,{recursive:true,force:true});}
