const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');
exports.activate = async context => {
    const proofFile = path.join(context.globalStorageUri.fsPath, 'proof.json');
    const proof = {
        hostname: os.hostname(), platform: process.platform, arch: process.arch,
        executable: process.execPath, pid: process.pid,
        remoteName: vscode.env.remoteName,
        uiLanguage: vscode.env.language,
        fontSize: vscode.workspace.getConfiguration("editor").get("fontSize"),
        wordWrap: vscode.workspace.getConfiguration("editor").get("wordWrap"),
        minimap: vscode.workspace.getConfiguration("editor.minimap").get("enabled"),
        compactActivityBar: vscode.workspace.getConfiguration("workbench.activityBar").get("compact"),
        theme: vscode.workspace.getConfiguration("workbench").get("colorTheme"),
        folders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString())
    };
    fs.mkdirSync(path.dirname(proofFile), { recursive: true });
    const save = () => fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2));
    save();
    context.subscriptions.push(vscode.commands.registerCommand('vscodroid.testRemoteWorkspace', async () => {
        try {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder || !folder.uri.path.endsWith('/remote-workspace-check')) throw Error('Open the test workspace first.');
            const uri = vscode.Uri.joinPath(folder.uri, 'editor-check.js');
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            for (let attempt = 0; attempt < 30; attempt++) {
                const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, new vscode.Position(1, 13));
                proof.completion = completions?.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === 'remoteWorkspaceVerified') || false;
                if (proof.completion) break;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            // Verify the workspace filesystem supports an actual save on the host.
            const edit = new vscode.WorkspaceEdit();
            edit.insert(uri, new vscode.Position(doc.lineCount, 0), '\n// Saved from the tablet remote workspace.\n');
            await vscode.workspace.applyEdit(edit);
            proof.save = await doc.save();
            proof.debugStarted = await vscode.debug.startDebugging(folder, {
                type: 'pwa-node', request: 'launch', name: 'Remote workspace verification',
                program: vscode.Uri.joinPath(folder.uri, 'debug-check.js').fsPath,
                runtimeExecutable: process.execPath, console: 'internalConsole'
            });
            save();
            vscode.window.showInformationMessage(`Remote verification: ${proof.hostname}/${proof.arch}; completion=${proof.completion}; save=${proof.save}; debugger=${proof.debugStarted}`);
        } catch (error) { proof.error = String(error); save(); throw error; }
    }));
};
