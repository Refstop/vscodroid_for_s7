#!/usr/bin/env python3
"""Check the installed AssetManager name and every remote-tool byte in an APK."""
from pathlib import Path
import io
import sys
import tarfile
import zipfile

root = Path(__file__).resolve().parents[2]
with zipfile.ZipFile(sys.argv[1]) as apk:
    # AAPT transparently expands *.gz and strips the suffix. Use a .bin asset
    # so the native caller receives the same gzip bytes this check inspects.
    payload = apk.read('assets/remote-compat.bin')
    assert payload[:2] == b'\x1f\x8b', 'Compatibility asset lost its gzip encoding'
    count = 0
    with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
        for member in archive:
            if not member.isfile():
                continue
            name = member.name.removeprefix('./')
            source = root / ('scripts/codex-extension/' + name[len('codex/'):] if name.startswith('codex/') else 'scripts/remote-workspace/' + name)
            assert archive.extractfile(member).read() == source.read_bytes(), f'Stale packaged tool: {name}'
            count += 1
    assert count >= 10, 'Incomplete compatibility payload'
    for name in ['remote-workspace.sh', 'remote-workbench.js', 'hardware-keyboard.js', 'server.js',
                 'extensions/vscodroid.vscodroid-saf-bridge-1.13.1/extension.js']:
        assert apk.read('assets/' + name) == (root / 'android/app/src/main/assets' / name).read_bytes(), name
    assert apk.read('assets/NOTICE.md') == (root / 'NOTICE.md').read_bytes()
print(f'PASS: APK asset name, gzip encoding, {count} remote tools, bootstrap/UI sources and notices')
