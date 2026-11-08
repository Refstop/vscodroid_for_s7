// Exercise the real installed opener with the VS Code API boundary stubbed.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {patchHtmlOpen} = require('./html-preview-compat.cjs');
const source = fs.readFileSync(process.argv[2] + '/out/extension.js', 'utf8');
const patched = patchHtmlOpen(source);
assert.equal(patchHtmlOpen(patched), patched);
assert.throws(() => patchHtmlOpen('unsupported version'), /Unsupported/);
const start = patched.indexOf('f=async v=>{try{if(s)return await eo.commands.executeCommand("revealFileInOS",v)');
const end = patched.indexOf(';if(lUe(p))', start);
assert(start >= 0 && end > start, 'Pinned Codex opener changed');
(async () => {
    for (const test of [
        {path:'/work/page.html', command:'vscode.open'},
        {path:'/work/page.HTM', command:'vscode.open'},
        {path:'/work/page.html', line:14, command:'vscode.open'},
        {path:'/work/code.cpp', line:14, command:'raw'},
        {path:'/work/file.html.txt', command:'raw'},
        {path:'/work/page.html', reveal:true, command:'revealFileInOS'},
        {path:'/work/page.html', fail:true, command:'vscode.open'}
    ]) {
        const calls = [];
        const eo = {commands:{executeCommand:async (...args) => {calls.push(args); if(test.fail) throw Error('No editor');}},
            workspace:{openTextDocument:async v => {calls.push(['raw',v]); return v;}},
            window:{showTextDocument:async (doc,options) => calls.push(['show',doc,options])},
            Position:class{constructor(line,column){Object.assign(this,{line,column});}},
            Range:class{constructor(start,end){Object.assign(this,{start,end});}}};
        const open = vm.runInNewContext('(' + patched.slice(start+2,end) + ')', {s:!!test.reveal,u:test.line,c:1,eo});
        const uri = {path:test.path,scheme:'vscode-remote'};
        assert.equal(await open(uri), !test.fail);
        assert.equal(calls[0][0], test.command);
        assert.equal(calls[0][1], uri, 'Preserve the original URI/scheme');
        if (test.command === 'raw' && test.line) assert.equal(calls[1][2].selection.start.line, test.line-1);
        if (test.command !== 'raw') assert.equal(calls.length, 1, 'Preview/reveal must not open a text document');
    }
    console.log('PASS: HTML/HTM associations, uppercase, line links, ordinary source selection, reveal, failure and idempotence');
})().catch(e => {console.error(e);process.exitCode=1;});
