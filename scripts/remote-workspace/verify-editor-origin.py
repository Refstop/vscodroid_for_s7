#!/usr/bin/env python3
"""Check the real tablet WebView through an adb-forwarded Chrome DevTools port.

Example: python3 scripts/remote-workspace/verify-editor-origin.py --origin http://127.0.0.1:13338
The SSH workspace must already be connected in the app.
"""
import argparse
import json
import urllib.request
from urllib.parse import urlsplit, parse_qs

parser = argparse.ArgumentParser()
parser.add_argument('--cdp', default='http://127.0.0.1:19223')
parser.add_argument('--origin', required=True)
args = parser.parse_args()
pages = json.load(urllib.request.urlopen(args.cdp + '/json', timeout=10))
pages = [page for page in pages if page.get('type') == 'page']
assert len(pages) == 1, 'SSH must use the existing editor, not a second WebView'
page = pages[0]
url = urlsplit(page['url'])
expected = urlsplit(args.origin)
assert (url.scheme, url.netloc) == (expected.scheme, expected.netloc), 'SSH replaced the local editor origin'
assert page['title'].endswith('VSCodroid'), 'SSH replaced the local editor product'
assert parse_qs(url.query).get('remote', [''])[0].startswith('ssh-remote+'), 'No stable SSH workspace identity'
print('PASS: one existing VSCodroid WebView, unchanged origin, stable SSH workspace identity')
