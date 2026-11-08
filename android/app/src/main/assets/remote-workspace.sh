#!/bin/sh
# Start the same Code OSS agent as the local workbench, over authenticated SSH.
set -eu
umask 077
IFS= read -r token
case "$(uname -s):$(uname -m)" in
 Linux:x86_64) arch=amd64; native_digest=53029be6c5781b7bca49b815fcc9a2a3fc111813ad8c9965b2c0f0d2985a0674 ;;
 Linux:aarch64|Linux:arm64) arch=arm64; native_digest=0edb4b60d9c4744b2dd14b0911e3c2e6dd8c6f3c13bd58bda23ae744e59e7df1 ;;
 *) echo 'The remote host must run Linux x64 or ARM64 with glibc.' >&2; exit 1 ;;
esac
version=1.139.1
base="$HOME/.cache/vscodroid-remote"
agent="$base/code-oss-$version-linux-$arch-r1"
mkdir -p "$base/downloads"
run=$(mktemp -d "$base/session.XXXXXX")
pid=
cleanup() {
 if [ -n "$pid" ]; then /bin/kill -TERM -- "-$pid" 2>/dev/null || true; fi
 rm -rf "$run"
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM
# The APK supplies its reviewed setup tools over the authenticated SSH stdin.
# Keep this out of the exec command: even small archives can exceed ARG_MAX.
IFS= read -r compat_digest
IFS= read -r compat_data
case "$compat_digest" in *[!0-9a-f]*|'') echo 'Invalid compatibility digest' >&2; exit 1 ;; esac
[ "${#compat_digest}" -eq 64 ] || exit 1
printf '%s' "$compat_data" | base64 -d > "$run/compat.tar.gz"
unset compat_data
printf '%s  %s\n' "$compat_digest" "$run/compat.tar.gz" | sha256sum -c - >/dev/null
compat="$base/compat-$compat_digest"
if [ ! -f "$compat/.complete" ]; then
 mkdir "$run/compat"
 tar -xzf "$run/compat.tar.gz" -C "$run/compat"
 touch "$run/compat/.complete"
 mv -T "$run/compat" "$compat" 2>/dev/null || [ -f "$compat/.complete" ]
fi
fetch() {
 file="$base/downloads/$1"
 if ! printf '%s  %s\n' "$2" "$file" | sha256sum -c - >/dev/null 2>&1; then
  curl --fail --location --silent --show-error --connect-timeout 20 --max-time 360 "$3" -o "$run/download"
  printf '%s  %s\n' "$2" "$run/download" | sha256sum -c - >&2
  mv "$run/download" "$file"
 fi
}
if [ ! -f "$agent/.complete" ]; then
 echo 'VSCODROID_STATUS=Installing the matching Code OSS remote agent…'
 oss="vscode-reh-web-linux-arm64-$version.tar.gz"
 native="code-server-4.139.1-linux-$arch.tar.gz"
 fetch "$oss" 0f2b21a01cbcf59de700278c95ff585987aa1cf0c70250531b4fbdecee8631e5 "https://github.com/rmyndharis/VSCodroid/releases/download/server-$version/$oss"
 fetch "$native" "$native_digest" "https://github.com/coder/code-server/releases/download/v4.139.1/$native"
 mkdir "$run/agent" "$run/native"
 tar -xzf "$base/downloads/$oss" -C "$run/agent" --strip-components=1
 tar -xzf "$base/downloads/$native" -C "$run/native" --strip-components=1
 # The frontend/agent JavaScript and extensions are exactly VSCodroid's build.
 # Use matching Linux Node/native dependencies, never Android or wrong-CPU addons.
 rm -rf "$run/agent/node_modules"
 mv "$run/native/lib/vscode/node_modules" "$run/agent/node_modules"
 cp "$run/native/lib/node" "$run/agent/node"
 "$run/agent/node" -e 'const p=require(process.argv[1]+"/package.json"); if(p.version!=="1.139.1")process.exit(1)' "$run/agent"
 touch "$run/agent/.complete"
 if [ ! -d "$agent" ]; then mv "$run/agent" "$agent"; fi
fi
# Android's worker-thread extension host shares the server's native addons.
# On Linux those addons can segfault when a worker unloads during window reload.
# Keep the identical protocol/build, but restore desktop process isolation.
"$agent/node" --input-type=commonjs - "$agent" <<'NODE'
const fs = require('fs');
const file = process.argv[2] + '/out/server-main.js';
const source = fs.readFileSync(file, 'utf8');
const spawn = /this\._extensionHostProcess=([\w$]+)\(!([01]),([\w$]+)\.fork,/g;
const matches = [...source.matchAll(spawn)];
if (matches.length !== 1) throw Error('Unsupported Code OSS extension host bootstrap');
if (matches[0][2] === '0') {
 const patched = source.replace(spawn, 'this._extensionHostProcess=$1(!1,$3.fork,');
 fs.writeFileSync(file + '.tmp', patched);
 fs.renameSync(file + '.tmp', file);
}
NODE
printf '%s' "$token" > "$run/token"
unset token
mkdir -p "$HOME/.local/share/vscodroid-remote/oss-data" "$HOME/.local/share/vscodroid-remote/oss-extensions"
# Open VSX packages use the same verification policy as VSCodroid's local agent.
machine="$HOME/.local/share/vscodroid-remote/oss-data/data/Machine"
mkdir -p "$machine"
if [ ! -f "$machine/settings.json" ]; then
 printf '%s\n' '{"extensions.verifySignature":false}' > "$machine/settings.json"
fi
echo 'VSCODROID_STATUS=Preparing bundled remote development features…'
setsid "$agent/node" "$compat/setup-remote.cjs" "$agent" &
pid=$!
if ! wait "$pid"; then echo 'VSCODROID_WARNING=Remote feature setup did not finish. Reconnect to retry.'; fi
pid=
# Validate and open webview resources on the host. One authenticated HTTP request
# replaces several serialized SFTP realpath requests per module in a webview graph.
cat > "$run/resources.cjs" <<'RESOURCE_NODE'
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const tokenArg = process.argv.find(arg => arg.startsWith('--connection-token-file='));
if (tokenArg) {
 const expected = fs.readFileSync(tokenArg.slice('--connection-token-file='.length));
 const emit = http.Server.prototype.emit;
 const inside = (file, root) => file === root || file.startsWith(root === '/' ? '/' : root + '/');
 const mime = {'.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2',
  '.ttf':'font/ttf', '.wasm':'application/wasm', '.txt':'text/plain', '.mp4':'video/mp4', '.webm':'video/webm'};
 async function resource(req, res, url) {
  const deny = status => { res.writeHead(status, {'Cache-Control':'no-store'}); res.end(); };
  const supplied = Buffer.from(url.searchParams.get('tkn') || '');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return deny(403);
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405);
  let handle;
  try {
   const requested = url.searchParams.get('path');
   const roots = JSON.parse(url.searchParams.get('roots'));
   if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0') ||
       !Array.isArray(roots) || roots.length === 0 || roots.length > 258 ||
       roots.some(root => typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0'))) return deny(400);
   // Roots come from the authenticated native transport, never from a webview URL.
   const canonical = await fs.promises.realpath(requested);
   const bases = (await Promise.all(roots.map(root => fs.promises.realpath(root).catch(() => null)))).filter(Boolean);
   if (!bases.some(root => inside(canonical, root))) return deny(403);
   handle = await fs.promises.open(canonical, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
   const stat = await handle.stat();
   // Check the object actually opened, closing the rename/symlink race between
   // realpath and open. NONBLOCK prevents a FIFO from hanging a request worker.
   const opened = await fs.promises.readlink('/proc/self/fd/' + handle.fd);
   if (!stat.isFile() || !bases.some(root => inside(opened, root))) return deny(403);
   const type = mime[path.extname(canonical).toLowerCase()] || 'application/octet-stream';
   const gzip = stat.size > 1024 && /^(text\/|application\/(json|wasm))/.test(type) &&
       /\bgzip\b/.test(req.headers['accept-encoding'] || '');
   const headers = {'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'};
   if (gzip) { headers['Content-Encoding']='gzip'; headers.Vary='Accept-Encoding'; }
   else headers['Content-Length']=stat.size;
   res.writeHead(200, headers);
   if (req.method === 'HEAD') return res.end();
   const stream = handle.createReadStream(); handle = null;
   res.once('close', () => stream.destroy());
   stream.once('error', () => res.destroy());
   if (gzip) {
    const compressed = zlib.createGzip();
    compressed.once('error', () => res.destroy());
    res.once('close', () => compressed.destroy());
    stream.pipe(compressed).pipe(res);
   } else stream.pipe(res);
  } catch (error) {
   if (res.headersSent) res.destroy();
   else deny(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 403);
  } finally { await handle?.close(); }
 }
 http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
   const [req, res] = args;
   let url;
   try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return emit.call(this, event, ...args); }
   if (url.pathname === '/vscodroid-webview-resource') {
    resource(req, res, url).catch(() => res.destroy());
    return true;
   }
  }
  return emit.call(this, event, ...args);
 };
}
RESOURCE_NODE
echo 'VSCODROID_STATUS=Starting the remote extension host…'
setsid "$agent/node" --require "$run/resources.cjs" "$agent/out/server-main.js" --host=127.0.0.1 --port=0 \
 --connection-token-file="$run/token" --accept-server-license-terms --disable-telemetry \
 --server-data-dir="$HOME/.local/share/vscodroid-remote/oss-data" \
 --extensions-dir="$HOME/.local/share/vscodroid-remote/oss-extensions" > "$run/server.log" 2>&1 &
pid=$!
count=0
while [ "$count" -lt 300 ]; do
 port=$(sed -n 's/.*Extension host agent listening on \([0-9]*\).*/\1/p' "$run/server.log" | head -n 1)
 [ -z "$port" ] || break
 if ! kill -0 "$pid" 2>/dev/null; then sed 's/[?&]tkn=.*/?tkn=<redacted>/' "$run/server.log" >&2; exit 1; fi
 count=$((count + 1)); sleep 0.2
done
[ -n "$port" ] || { echo 'Remote agent startup timed out' >&2; exit 1; }
printf 'VSCODROID_AGENT=%s\n' "$agent"
printf 'VSCODROID_EXTENSIONS=%s\n' "$HOME/.local/share/vscodroid-remote/oss-extensions"
printf 'VSCODROID_READY=%s\n' "$port"
while IFS= read -r message; do
 [ "$message" != close ] || break
 kill -0 "$pid" 2>/dev/null || exit 1
done
