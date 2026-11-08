#!/usr/bin/env python3
"""Click an open VS Code Quick Input on the real tablet; no IME/extra keys may appear.

Requires adb on PATH, websocket-client, and the WebView CDP socket forwarded to
localhost:19223. Open the command palette first. An alphabetic physical keyboard
must be attached. Does not change Android settings or type into user files.
"""
import argparse
import json
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
import websocket


def shell(*args):
    return subprocess.check_output(['adb', 'shell', *args], text=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--detached', action='store_true', help='Expect the keyboard disconnected and touch UI restored')
args = parser.parse_args()
physical = bool(re.search(r'Classes:.*ALPHAKEY.*EXTERNAL', shell('dumpsys', 'input')))
assert physical != args.detached, 'Physical keyboard state does not match the requested check'
pages = json.load(urllib.request.urlopen('http://127.0.0.1:19223/json', timeout=5))
page = next(p for p in pages if p.get('type') == 'page')
ws = websocket.create_connection(page['webSocketDebuggerUrl'], suppress_origin=True, timeout=5)
seq = 0


def call(method, params):
    global seq
    seq += 1
    ws.send(json.dumps(dict(id=seq, method=method, params=params)))
    while True:
        reply = json.loads(ws.recv())
        if reply.get('id') == seq:
            assert 'error' not in reply, reply.get('error')
            return reply['result']


try:
    result = call('Runtime.evaluate', dict(expression='''(() => {
        const input = document.querySelector('.quick-input-box input');
        if (!input || !input.getBoundingClientRect().width) return null;
        const r = input.getBoundingClientRect();
        return {x:r.x+r.width/2, y:r.y+r.height/2};
    })()''', returnByValue=True))
    point = result['result'].get('value')
    assert point, 'Open the command palette before running this check'
    for event in ('mousePressed', 'mouseReleased'):
        call('Input.dispatchMouseEvent', dict(type=event, button='left', clickCount=1, **point))
    time.sleep(1)
    display = shell('dumpsys', 'window', 'displays')
    ime_visible = bool(re.search(r'InsetsSource type=ITYPE_IME .*visible=true', display))
    dump_path = '/sdcard/vscodroid-keyboard-check.xml'
    try:
        shell('uiautomator', 'dump', dump_path)
        root = ET.fromstring(shell('cat', dump_path))
        extra_keys = any(n.get('package') == 'com.vscodroid.debug' and n.get('text') == 'tab'
                         for n in root.iter('node'))
    finally:
        shell('rm', '-f', dump_path)
    print(json.dumps(dict(physical_keyboard=physical, ime_visible=ime_visible, extra_keys_visible=extra_keys)))
    if args.detached:
        assert ime_visible and extra_keys, 'Disconnected: software keyboard and extra key row did not return'
        print('PASS: text focus after disconnect restores IME and extra keys')
    else:
        assert not ime_visible and not extra_keys, 'Physical keyboard connected: software keyboard or extra key row appeared'
        print('PASS: mouse focus with attached keyboard keeps IME and extra keys hidden')
finally:
    ws.close()
