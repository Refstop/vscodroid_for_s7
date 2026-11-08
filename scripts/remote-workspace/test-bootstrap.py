#!/usr/bin/env python3
"""Integration check for the real remote server (downloads the pinned server on first run)."""
import concurrent.futures
import gzip
import base64
import hashlib
import json
import tempfile
import http.client
import os
from pathlib import Path
import secrets
import selectors
import socket
import subprocess
import time
import urllib.parse

script = Path(__file__).resolve().parents[2] / 'android/app/src/main/assets/remote-workspace.sh'
payload_file = script.parents[3] / 'build/generated/remoteCompatAssets/remote-compat.bin'
assert payload_file.is_file(), 'Run :app:bundleRemoteCompatibilityAssets before this integration check'
payload = payload_file.read_bytes()
token = secrets.token_urlsafe(32)
proc = subprocess.Popen(['sh', str(script)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
selector = selectors.DefaultSelector()
selector.register(proc.stdout, selectors.EVENT_READ)
port = None
try:
    proc.stdin.write(token + '\n')
    proc.stdin.write(hashlib.sha256(payload).hexdigest() + '\n' + base64.b64encode(payload).decode() + '\n')
    proc.stdin.flush()
    deadline = time.monotonic() + 480
    pending = ''
    while time.monotonic() < deadline:
        if selector.select(timeout=1):
            pending += os.read(proc.stdout.fileno(), 8192).decode()
            while '\n' in pending:
                line, pending = pending.split('\n', 1)
                if line.startswith('VSCODROID_READY='):
                    port = int(line.split('=')[1])
                if line.startswith('VSCODROID_STATUS='):print(line.split('=',1)[1], flush=True)
                if line.startswith('VSCODROID_WARNING='):raise AssertionError(line)
            if port: break
        if proc.poll() is not None:raise AssertionError(proc.stderr.read())
    assert port, 'No ready marker from remote bootstrap'
    def request(method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        c.request(method,path,body,headers or {})
        r=c.getresponse(); result=(r.status,dict(r.getheaders()),r.read());c.close();return result
    status,_,_=request('GET','/')
    assert status==403, status
    status,_,_=request('GET','/?tkn=wrong')
    assert status==403, 'Wrong token was accepted'
    status,headers,_=request('GET','/?tkn='+urllib.parse.quote(token))
    assert status in (302,303),status
    cookie=headers['Set-Cookie'].split(';')[0]
    status,_,body=request('GET','/',headers={'Cookie':cookie})
    assert status==200 and b'workbench' in body, status
    status,_,body=request('GET','/version',headers={'Cookie':cookie})
    assert status==200 and b'04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1' in body, (status,body)
    print('PASS: matching Code OSS agent; anonymous and incorrect-token requests blocked',flush=True)
    # A real extension graph needs hundreds of reads. Authorize canonical paths on
    # the remote machine in the same request, without serialized SFTP round trips.
    with tempfile.TemporaryDirectory(prefix='vscodroid-resources-') as temp:
        base = Path(temp)
        allowed = base / 'allowed'; allowed.mkdir()
        good = allowed / 'entry.js'; good.write_text('export const ok = true;\n' * 100)
        outside = base / 'private.js'; outside.write_text('not published')
        (allowed / 'escape.js').symlink_to(outside)
        (allowed / 'inside.js').symlink_to(good)
        fifo = allowed / 'pipe'; os.mkfifo(fifo)
        def resource(path, supplied_token=token, method='GET', headers=None):
            query = urllib.parse.urlencode({'path': str(path), 'roots': json.dumps([str(allowed)]), 'tkn': supplied_token})
            return request(method, '/vscodroid-webview-resource?' + query, headers=headers)
        status,headers,body=resource(good)
        assert status==200 and body==good.read_bytes(), ('resource route', status)
        assert headers.get('Content-Type','').startswith('text/javascript'), headers
        assert resource(good, '')[0]==403
        assert resource(good, 'wrong')[0]==403
        assert resource(outside)[0]==403
        assert resource(allowed/'escape.js')[0]==403
        assert resource(allowed/'..'/'private.js')[0]==403
        assert resource(allowed/'inside.js')[2]==good.read_bytes()
        assert resource(allowed/'missing.js')[0]==404
        assert resource(fifo)[0]==403
        assert resource(allowed)[0]==403
        assert resource(good, method='POST')[0]==405
        status,headers,body=resource(good,headers={'Accept-Encoding':'gzip'})
        assert status==200 and headers.get('Content-Encoding')=='gzip' and gzip.decompress(body)==good.read_bytes()
        before=time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            assert all(pool.map(lambda _: resource(good)[0]==200, range(300)))
        print(f'PASS: resource auth, MIME, gzip, symlink boundaries and special files; 300 reads in {time.monotonic()-before:.2f}s',flush=True)

finally:
    try:proc.stdin.write('close\n');proc.stdin.flush();proc.stdin.close()
    except BrokenPipeError:pass
    try:proc.wait(timeout=15)
    except subprocess.TimeoutExpired:proc.kill();raise
if port:
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        try:
            s=socket.create_connection(('127.0.0.1',port),timeout=1);s.close();time.sleep(.2)
        except OSError:break
    else:raise AssertionError('Remote server survived disconnect')
    print('PASS: disconnect removes the session listener',flush=True)
