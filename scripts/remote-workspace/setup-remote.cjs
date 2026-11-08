// Shipped in the APK and run with the matching remote agent's Node, before startup.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const jsonc = require('./vendor/jsonc-parser/lib/umd/main.js');
const codexVersion = '26.1021.22027';
const codexHashes = {x64:'9a5c1aa4b50d0eb9b9c06c3d7ffd18e1e7fa4591da85b1973bd1629e4db75fa9', arm64:'949b421f78de9a4a83fd0d373ed1416e8b5d5bd326c521318a71b8d4406b1dd6'};
function status(message) { console.log('VSCODROID_STATUS=' + message); }
function warning(message) { console.log('VSCODROID_WARNING=' + message.replace(/[\r\n]+/g, ' ').slice(0, 1000)); }
function run(command, args, options = {}) {
    const r = spawnSync(command, args, {encoding:'utf8', timeout:600000, maxBuffer:4*1024*1024, ...options});
    if (r.error || r.status !== 0) throw Error(`${path.basename(command)} failed: ${(r.error?.message || r.stderr || r.stdout || `exit ${r.status}`).slice(-1200)}`);
    return r.stdout;
}
function sha(file, algorithm='sha256') { return createHash(algorithm).update(fs.readFileSync(file)).digest(algorithm==='sha512'?'base64':'hex'); }
function download(url, file, digest, algorithm='sha256') {
    if (fs.existsSync(file) && sha(file,algorithm) === digest) return;
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const temp = file + '.' + process.pid + '.tmp';
    try {
        run('curl', ['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','360',url,'-o',temp]);
        if (sha(temp,algorithm) !== digest) throw Error('Downloaded package checksum mismatch');
        fs.renameSync(temp,file);
    } finally {fs.rmSync(temp,{force:true});}
}
function installed(extensions, id) {
    const indexed = path.join(extensions,'extensions.json');
    if (fs.existsSync(indexed)) {
        const entries = JSON.parse(fs.readFileSync(indexed,'utf8')).filter(e=>e.identifier?.id===id);
        return entries.map(e=>({version:e.version, directory:e.location?.path || path.join(extensions,e.relativeLocation)}));
    }
    // A newly prepared directory has not acquired VS Code's installation index yet.
    return fs.readdirSync(extensions).filter(n=>n.startsWith(id+'-')).flatMap(n=>{
        try {const p=JSON.parse(fs.readFileSync(path.join(extensions,n,'package.json')));return p.publisher+'.'+p.name===id?[{version:p.version,directory:path.join(extensions,n)}]:[];}catch{return [];}
    });
}
function configureSettings(file) {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    let text = fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '{}\n';
    const errors=[]; const settings=jsonc.parse(text,errors,{allowTrailingComma:true});
    if(errors.length || !settings || typeof settings!=='object' || Array.isArray(settings)) throw Error('Remote settings.json is invalid; existing settings were preserved');
    // Set defaults only once. Later user choices must not be overwritten on reconnect.
    for(const [key,value] of Object.entries({'*.html':'simpleHtmlViewer.preview','*.htm':'simpleHtmlViewer.preview'})) {
        if(settings['workbench.editorAssociations']?.[key] !== undefined) continue;
        text=jsonc.applyEdits(text,jsonc.modify(text,['workbench.editorAssociations',key],value,{formattingOptions:{insertSpaces:true,tabSize:4,eol:'\n'}}));
    }
    const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,text);fs.renameSync(temp,file);
}
async function setup(agent, home=os.homedir()) {
    const base=path.join(home,'.cache/vscodroid-remote');
    const extensions=path.join(home,'.local/share/vscodroid-remote/oss-extensions');
    const data=path.join(home,'.local/share/vscodroid-remote/oss-data');
    fs.mkdirSync(extensions,{recursive:true});fs.mkdirSync(base,{recursive:true});
    const lock=path.join(base,'compat-setup.lock');
    let acquired=false;
    for(let i=0;i<1200;i++) {
        try {fs.writeFileSync(lock,String(process.pid),{flag:'wx'});acquired=true;break;}catch(e){if(e.code!=='EEXIST')throw e;}
        const pid=Number(fs.readFileSync(lock,'utf8'));
        if(Number.isInteger(pid)&&pid>0) {try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){fs.rmSync(lock,{force:true});continue;}}}
        if(i===0)status('Waiting for another SSH compatibility setup…');
        await new Promise(r=>setTimeout(r,500));
    }
    if(!acquired)throw Error('Another remote setup is still running. Reconnect later.');
    const node=path.join(agent,'node');
    const install=vsix=>run(node,[path.join(agent,'out/server-main.js'),'--install-extension',vsix,'--extensions-dir',extensions,'--server-data-dir',data,'--accept-server-license-terms','--disable-telemetry']);
    try {
        try {
            if(!installed(extensions,'austin-spagnolo.simple-html-viewer').length) {
                status('Installing HTML Preview…');
                const vsix=path.join(base,'downloads/simple-html-viewer-0.1.0.vsix');
                download('https://open-vsx.org/api/austin-spagnolo/simple-html-viewer/0.1.0/file/austin-spagnolo.simple-html-viewer-0.1.0.vsix',vsix,'20f6296f097791260965b135a9df6c3a28f0fbfa3ab9de77f38731afefc41eba');install(vsix);
            }
            configureSettings(path.join(data,'data/Machine/settings.json'));
        }catch(e){warning('HTML Preview setup: '+e.message);}
        try {
            let codex=installed(extensions,'openai.chatgpt');
            if(!codex.length) {
                const digest=codexHashes[process.arch];if(!digest)throw Error('Unsupported Codex CPU architecture');
                status('Installing the verified Codex extension…');
                const vsix=path.join(base,`downloads/codex-${codexVersion}-linux-${process.arch}.vsix`);
                download(`https://open-vsx.org/api/openai/chatgpt/linux-${process.arch}/${codexVersion}/file/openai.chatgpt-${codexVersion}@linux-${process.arch}.vsix`,vsix,digest);install(vsix);
                codex=installed(extensions,'openai.chatgpt');
            }
            if(codex.length!==1 || codex[0].version!==codexVersion) throw Error(`Codex ${codex.map(e=>e.version).join(', ')||'missing'} is not the verified ${codexVersion}. Existing extensions were preserved.`);
            const extension=codex[0].directory;
            const toolDir=path.join(__dirname,'codex');
            const stateFile=path.join(extension,'.vscodroid-webview-backup/state.json');
            let bundled=false;
            if(fs.existsSync(stateFile)) {
                const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
                bundled=state.htmlHash===sha(path.join(extension,'webview/index.html'));
            }
            if(!bundled) {
                status('Preparing Codex for the tablet (first connection may take several minutes)…');
                const npmDir=path.join(base,'npm-11.6.2');
                if(!fs.existsSync(path.join(npmDir,'package/bin/npm-cli.js'))) {
                    const tgz=path.join(base,'downloads/npm-11.6.2.tgz');
                    download('https://registry.npmjs.org/npm/-/npm-11.6.2.tgz',tgz,'7iKzNfy8lWYs3zq4oFPa8EXZz5xt9gQNKJZau3B1ErLBb6bF7sBJ00x09485DOvRT2l5Gerbl3VlZNT57MxJVA==','sha512');
                    fs.mkdirSync(npmDir,{recursive:true});run('tar',['-xzf',tgz,'-C',npmDir]);
                }
                run(node,[path.join(npmDir,'package/bin/npm-cli.js'),'ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:toolDir,env:{...process.env,PATH:agent+path.delimiter+process.env.PATH}});
            }
            status('Applying Codex keyboard, queue and HTML compatibility…');
            run(node,[path.join(toolDir,'bundle.cjs'),extension],{env:{...process.env,PATH:agent+path.delimiter+process.env.PATH}});
        }catch(e){warning('Codex setup: '+e.message);}
    }finally{fs.rmSync(lock,{force:true});}
}
module.exports={configureSettings,installed,setup};
if(require.main===module)setup(process.argv[2]).catch(e=>{warning(e.message);process.exitCode=1;});
