#!/usr/bin/env python3
"""Reload the actual connected tablet twice; requires Python websocket-client.

Forward the WebView DevTools socket to localhost:19223 before running this.
No connection tokens leave the WebView. This caught the Linux worker-host crash.
"""
import json
import time
import urllib.request
import websocket

pages = json.load(urllib.request.urlopen('http://127.0.0.1:19223/json'))
pages = [page for page in pages if page.get('type') == 'page']
assert len(pages) == 1, 'Expected the one existing editor WebView'
ws = websocket.create_connection(pages[0]['webSocketDebuggerUrl'], suppress_origin=True, timeout=30)
sequence = 0

def call(method, params=None):
    global sequence
    sequence += 1
    ws.send(json.dumps(dict(id=sequence, method=method, params=params or {})))
    while True:
        answer = json.loads(ws.recv())
        if answer.get('id') == sequence:
            assert 'error' not in answer, answer.get('error')
            return answer.get('result', {})

def evaluate(expression):
    result = call('Runtime.evaluate', dict(expression=expression, returnByValue=True, awaitPromise=True))
    assert 'exceptionDetails' not in result, 'WebView evaluation failed'
    return result.get('result', {}).get('value')

health = '''(() => { try {
 const current = window.__vscodroidRemoteWorkspace;
 const resolved = JSON.parse(AndroidBridge.resolveRemoteWorkspace(window.__vscodroid.authToken, current.authority));
 const text = document.body.innerText;
 return resolved.port > 0 && text.includes('SSH: ' + current.label)
   && !text.includes('failed to connect to the server')
   && document.querySelectorAll('.monaco-list-row[role="treeitem"]').length > 0;
} catch { return false; } })()'''

try:
    assert evaluate(health), 'Connect an SSH folder before running the reload check'
    origin = evaluate('location.origin')
    authority = evaluate('window.__vscodroidRemoteWorkspace.authority')
    for iteration in range(2):
        call('Page.reload')
        # The Linux native addon crashed just after the old extension host exited.
        # Wait through two SSH control heartbeats, not just the first painted frame.
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            time.sleep(1)
        assert evaluate(health), 'Reload lost the remote server, filesystem, or editor'
        assert evaluate('location.origin') == origin, 'Reload replaced the local profile origin'
        assert evaluate('window.__vscodroidRemoteWorkspace.authority') == authority
        print(f'PASS: reload {iteration + 1}; same editor/profile, remote files and SSH alive', flush=True)
finally:
    ws.close()
