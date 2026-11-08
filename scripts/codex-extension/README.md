# Codex webview compatibility build

The Linux remote extension `openai.chatgpt` 26.1021.22027 starts its engine, but its
webview exceeds the 30-second renderer readiness deadline on the tested SM-T870.
The initial graph contains over 3,000 JavaScript files. VSCodroid's authenticated
resource transport avoids serialized SFTP checks and compresses text responses;
this script additionally consolidates the startup modules while retaining lazy
imports, shared module identity, CSS, and the original asynchronous entry order.

The integrated APK (versionCode 18+) ships these scripts and runs them automatically
before the remote agent starts. It also installs the pinned Codex/HTML Viewer when
missing. The commands below are for manual repair or development.

For manual preparation, run on the **SSH host** with Node 22+ and enough free
memory for the one-time bundle build:

```sh
cd scripts/codex-extension
npm ci
node bundle.cjs "$HOME/.local/share/vscodroid-remote/oss-extensions/openai.chatgpt-26.1021.22027-linux-x64"
```

Reload the VSCodroid editor. The original webview JavaScript and CSS files are
unchanged; `webview/index.html` selects the generated bundles. The extension host's
HTML opener is also patched, with its original saved for rollback. Version,
entry-file hashes, preload-helper hash and startup graph size are checked before
writing. Re-running verifies an existing build and applies keyboard compatibility
updates without rebuilding the startup graph. Dependencies are pinned in the
lockfile. Generated extension code is not included in this repository.

To restore the original webview and HTML opener, run the same command with `--restore`, then reload.
The original HTML and generated-file checksums are kept in the extension's
`.vscodroid-webview-backup` directory. Restore retains generated files so an already
open view can finish using them. An extension update needs a fresh compatibility
check; this script deliberately refuses other versions. This is a local
compatibility modification, not an official OpenAI build.

HTML links in Codex normally call `showTextDocument`, bypassing custom editor
associations. The HTML opener patch uses `vscode.open` for `.html`/`.htm` so the
user's default editor is respected. Configure `workbench.editorAssociations` to
`simpleHtmlViewer.preview` for both patterns, with Simple HTML Viewer installed.
Other source files retain their original line selection; Reveal in File Manager
is unchanged. This patch requires **Reload Window** or an app restart to reload
the extension host, not merely closing the Codex sidebar.

The generated composer also reads VSCodroid's existing physical-keyboard flag.
Codex otherwise treats every coarse-pointer Android screen as touch-only and
inserts a newline on Enter even with a keyboard attached. The adjustment keeps
Codex's normal keymap, Shift+Enter, IME composition guards and explicit newline
preference. Detaching the keyboard restores its original touch behavior.

The 2026-11-08 update also fixes the ProseMirror Android DOM listener: it skipped
Enter before the normal keymap could see Shift+Enter. With a physical keyboard
attached, non-composing Enter events now reach the existing keymap. Shift+Enter
inserts a newline and Enter sends; no new Ctrl+Enter binding is introduced.
Composing events and detached touch input keep the original Android fallback.
The earlier direct-keymap check missed this outer DOM listener, so the regression
test now includes the actual DOM path and browser-generated Shift+Enter input.

Queue admission also sends follower clients through the existing owner-forwarding
path. Direct app-server enqueue rejects followers with "Queued follow-up changed
before dispatch"; the patch preserves that ownership check instead of bypassing
it. Device validation on 2026-11-06/07 confirmed queue insertion, removal and automatic
execution after the running turn completed. After an extension upgrade, recheck
that behavior on the new version.

## Verification

With the Codex sidebar open and the Android WebView DevTools socket forwarded to
localhost:19223, use an installed Playwright runtime:

```sh
NODE_PATH=/path/to/playwright/node_modules node verify-codex.cjs --reload
```

The check fails on an unregistered sidebar command, renderer startup error or a
missing interactive UI. For an end-to-end check, ask Codex to reply with a fixed
string without modifying files or running commands, then verify the reply.
Authenticated resource transport tests are in `../remote-workspace/test-bootstrap.py`.

Keyboard checks (no app reload or chat submission):

```sh
node test-keyboard.cjs
node test-html-preview.cjs /path/to/openai.chatgpt-26.1021.22027-linux-x64
NODE_PATH=/path/to/playwright/node_modules node test-composer-dom.cjs /path/to/openai.chatgpt-26.1021.22027-linux-x64
node test-queue.cjs /path/to/openai.chatgpt-26.1021.22027-linux-x64
NODE_PATH=/path/to/playwright/node_modules node verify-enter.cjs
```

`test-composer-dom.cjs` runs the installed composer in an isolated headless browser
with an Android user agent. It never connects to a chat backend. Set
`CHROMIUM_PATH` if the Chromium executable is outside Playwright's default cache.
`--preview-patch` tests the compatibility change before modifying installed files.

`verify-enter.cjs --hardware` additionally exercises a real Android key/IME path
in a temporary composer. Set `ADB`, `ADB_SERIAL` and `KEYBOARD_DEVICE_ID`, and
install the debug helper from `../keyboard/HardwareKeys.java` as documented there.
The check counts submit events locally and preserves the user's draft.
