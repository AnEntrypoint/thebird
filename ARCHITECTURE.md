# Architecture

## Flow

```
web/terminal.js -> web/pty-adapter.js -> web/shell-client.js -> postMessage -> web/shell-worker.js
  -> web/bash-shell.js -> bashkit (web/vendor/bashkit/)
       -> custom builtins (git, sqlite3, python3, pip, curl, wget)
       -> web/shims/bashkit-host.js -> web/shims/fs.js (OPFS)
```

The worker posts each streamed output chunk as `{ output }`, and each reply as `{ id, ok, result }` or `{ id, ok: false, error }`. The page appends streamed chunks as they arrive. The final result carries only notes and cancel text, so output is not printed twice.

Lines typed while a command runs wait in a queue and run in order. Ctrl-C while busy drops the queue, sets the shared cancel word when the page is cross-origin isolated, posts a cancel, and bashkit's `cancel()` takes effect between commands and sleeps, not inside one blocking step. On an isolated page the engine's interrupt handler reads the word through `tjs_cancel_requested`, so a loop with no await stops inside the engine and the shell keeps its directory. On a page that is not isolated, `web/shell-client.js` gives a cancelled run 1.5 s to answer; if it does not, the client terminates the worker, reports `cancelled` with status 130, and starts a new worker at `/workspace` seeded with `(exit 130)`. Each run also gets an `AbortController` that `cancel()` aborts; `curl` and `wget` pass its signal to `fetch`, so a pending response is abandoned. `python3` and `pip` run in `web/python-worker.js`, a nested worker that holds Pyodide. Ctrl-C terminates that worker, which stops a busy script and abandons pip's requests. A cancel loses Python's in-memory state: globals, imports, packages installed by earlier `pip` runs, and files outside `/workspace`. Files a cancelled script wrote to `/workspace` are not kept, because the shell takes Python's writes only when a run finishes. The next `python3` starts Pyodide again.

The prompt shows the working directory, read back with `pwd` after each run. Each run starts with `(exit N);` for the previous status, because bashkit resets `$?` on every `execute()`.

## Component map

| File | Role |
| --- | --- |
| `bin/thebird-relay.js` | Node entry point; reads `--port` and `--host`, starts the server. |
| `src/relay.js` | Node static server on 127.0.0.1 (see Relay). |
| `web/terminal.html` | Page markup: the full-window `#terminal` element, the xterm stylesheet and an empty favicon. |
| `web/terminal.js` | Page logic: creates the xterm.js terminal with its fit and WebGL addons, connects it to the adapter, handles `?run`, and sets `data-engine`, `data-busy`, `data-done` and `data-renderer` on the body. |
| `web/pty-adapter.js` | PTY-style adapter: keystrokes and paste in, output bytes out. Keeps the input line, cursor, history, Tab, the Ctrl keys and the run queue; `resize` sends the column and row count to the shell as the COLUMNS and LINES shell variables. |
| `web/shell-client.js` | Page-side client for the worker: `run`, `complete`, `cwd`, `cancel`, `onOutput`, `ready`. Its `cancel` sets the shared cancel word on an isolated page and replaces the worker if a cancelled run does not answer within 1.5 s. |
| `web/shell-worker.js` | Web Worker: hydrates OPFS, creates the shell, refuses background jobs, flushes OPFS. |
| `web/bash-shell.js` | `createShell`, `hasBackgroundOperator`, the bashkit `Bash` with the twelve custom builtins from `web/builtins.js` and `COMMAND_TIMEOUT_MS`. |
| `web/builtins.js` | `BUILTIN_NAMES` and `runBuiltin`: the one dispatch for `git`, `sqlite3`, `python3`, `pip`, `qjs`, `tjs`, `node`, `curl`, `wget`, `fx`, `gm` and `playwriter`. The bash page and the txiki shell's bridge both call it. |
| `web/shell-lookup.js` | Shell prologue defining `which`, `command` and `type`. |
| `web/git-in-page.js` | `git` builtin: refuses remote verbs, then builds the git program from the texts below and runs it in the txiki engine with `runTjs`. |
| `web/git-program.js` | Git program that runs inside the txiki engine: the fs adapter over `__thebirdFs`, and each git command. |
| `web/commit-gate.js` | Gate run by `git commit` inside the txiki engine, loaded as text by `web/git-in-page.js`. |
| `web/sqlite-in-txiki.js` | `sqlite3` builtin: splits the statements and runs the static program `web/sqlite-program.js` through `web/txiki-in-page.js`, with the database path and statements passed as `args`. |
| `web/python-in-page.js` | `python3` and `pip` builtins: they forward to the Python worker, sync `/workspace` with it, and terminate it on cancel. |
| `web/python-worker.js` | Web Worker that holds Pyodide, runs `python3` scripts and installs pure packages with micropip. |
| `web/curl-in-page.js` | `curl` and `wget` builtins: generate a module that calls txiki.js `fetch`, run through `web/txiki-in-page.js`. |
| `web/fx-in-page.js` | `fx` builtin over `web/vendor/fx/fx-core.wasm`. |
| `web/gm-in-page.js` | `gm` builtin: gm's stdio MCP server over `web/vendor/gm/gm-core.wasm` and floosie's `rpc` hub. Three served tools (`next_context`, `run_code`, `finish`); other verbs are `gm.<name>` inside a `run_code` body. `gm stdio` takes one JSON-RPC line and answers one line. Its append-only run log resumes under `/workspace/.gm/runs`. The `playwriter_execute`, `playwriter_browsers`, `browser_tabs` and `browser_close_run` verbs come from `web/playwriter-in-page.js`. |
| `web/playwriter-in-page.js` | `playwriter` builtin and floosie `playwriter` endpoint: Birdman extension CDP transport, a Playwright-like browser/context/page facade, and execute bodies run inside txiki.js through `web/txiki-in-page.js`. State persists across execute calls; reset clears it. |
| `web/vendor/floosie/browser.js` | Bare JS browser build of floosie: chunks, codecs, processors and the browser stdio factory, which routes `rpc` chunks to named apps or the `*` default. |
| `web/shims/fs.js` | Synchronous in-memory tree hydrated from and flushed to OPFS. |
| `web/shims/fs-promises.js` | Promise wrappers over `fs.js`. |
| `web/shims/path.js` | `posix` path functions. |
| `web/shims/buffer.js` | `Buffer` over `Uint8Array`. |
| `web/shims/crypto.js` | `createHash` (sha1, sha256), `randomBytes`, `randomUUID`. |
| `web/shims/bashkit-host.js` | bashkit's host filesystem, over `fs.js`. |
| `web/vendor/acorn.mjs` | Vendored parser used by the commit gate. |
| `web/vendor/isomorphic-git.mjs` | Vendored git library, read as text and run inside the txiki engine. |
| `web/vendor/bashkit/` | Generated, gitignored runtime. |
| `scripts/vendor-bashkit.mjs` | Generates the runtime, checking SHA-256. |
| `scripts/browser-driver.mjs` | Drives headless Chromium for the witness. |
| `scripts/lint-comments.mjs`, `scripts/lint-architecture.mjs`, `scripts/witness.mjs` | Lints and the browser witness (see Checks). |

## Command timeout

`COMMAND_TIMEOUT_MS` in `web/bash-shell.js` is 900000 (900 s). It is passed as `timeoutMs` to bashkit's `Bash` constructor, and bashkit applies it to each `execute()` call, one command line. bashkit's `execute()` ignores a `timeoutMs` in its own options (probed: a constructor limit of 2 s cut a `sleep 5` even with `{ timeoutMs: 10000 }` on the call), so the limit cannot differ per call. The page shell and `web/shell-core.js` share the value.

bashkit's default is 30 s, which was too short. In one of seven recorded witness runs a cold `pip install` of tabulate failed with `execution timeout (30s)`. The first cold `python3` or `pip` call on the public site, on this link, took about 290 s to idle (5 MB stripped bundle at about 80 KB/s, then Pyodide start and the micropip wheel). With the former 300 s limit that call was cut: `pip --version` printed `error: resource limit exceeded: execution timeout (300s)`. Under contention the cold call took longer than 600 s: the architecture lint's live `python3 -c` probe, run while the witness ran, started at 03:42:04 and was cut at 03:52:04 with `error: resource limit exceeded: execution timeout (600s)`. Run alone, the same cold probe took 210 s, and run beside the witness it took 546 s. 900 s is about 1.5 times the slowest measured cold call. With 900 s, a cold tabulate install completes in about 19-28 s in the in-page shell, and `sleep 40` completes.

The witness checks the expiry through the component's own window: the terminal page takes a `commandTimeoutMs` URL parameter, the shell worker passes it to `createShell`, and one-second sleeps are cut at a 10 s window with `execution timeout (10s)`. The shipped window stays 900 s, and the witness checks that value in `web/bash-shell.js`. The expiry check takes a few seconds, so it fits in one foreground call.

## In-page builtins

| Builtin | Backing | Scope and limits |
| --- | --- | --- |
| `git` | isomorphic-git 1.44.11 (`web/vendor/isomorphic-git.mjs`), run in the txiki engine through `web/git-program.js` | `init`, `status` (porcelain v1 after a `## <branch>` line), `log [-n N]`, `diff` (working tree against HEAD, no hunk headers), `add`, `commit -m`, local `branch`, `checkout` and `checkout -b`. `--version` reports the library version. No remotes, `push`, `fetch`, `pull`, stash or path checkout. `.thebird/` is excluded from the index. |
| `sqlite3` | tjs:sqlite (txiki.js, `web/txiki-in-page.js`) | `sqlite3 <database> <sql>`. The database is a file under the shell's cwd. Its pages are read and written through a sqlite VFS over the `fs.js` tree, which OPFS holds, so nothing reaches the host filesystem. Each statement is prepared and read with `all()`, and rows print with `|`. The VFS takes no locks, because each worker runs one connection, and it omits WAL. Temporary files go in `/.thebird/`. |
| `python3` | Pyodide 314.0.7 core, unpacked in the page from the stripped bundle `pyodide-minimal.br` (`web/python-bundle.js`, brotli decoder `web/vendor/brotli/`) | `-c <code>` or `<file>`. The bundle is fetched and decoded on the first call, behind a tte-js splash (`web/splash.js`, `web/vendor/tte-js/`) that falls back to plain text. Each file's SHA-256 is checked against the bundle manifest and the core files against pins. Pyodide starts in `web/python-worker.js`. `/workspace` is mirrored into Pyodide's memory filesystem in that worker: before a call the shell sends the paths and the files whose revision (`revisionOf` in `web/shims/fs.js`) changed; after it the worker compares every Pyodide file with its mirror and returns the changed, new and deleted files, which the shell writes back. Errors show the output and summary with URLs removed. |
| `pip` | micropip 0.11.1 from the jsDelivr CDN, pinned to `v314.0.7` | `pip install <name>...`. Plain names only; version specifiers and URLs are refused. Names in the lock inside the bundle (`pyodide-lock.json`) are refused with `is part of the Pyodide package set`, because the bundle has no wheels for them. Pure wheels come from PyPI. Installed packages live in the Python worker's memory and are not written to OPFS. A cancel terminates that worker, so they are gone until installed again. |
| `curl`, `wget` | txiki.js fetch (`web/txiki-in-page.js`) | Flags `-s`, `-S`, `-f`, `-L`, `-q`, alone or combined. `curl -o file` and `wget -O file`. Other flags are refused. Only hosts that send CORS headers to the page are reachable. |
| `fx` | fx core WebAssembly (`web/vendor/fx/fx-core.wasm`), libfx browser SDK, and `web/fx-in-page.js` | `fx --version` reads the generated manifest, `fx --help` prints the command surface, `fx check` verifies the WASM asset and JSPI, and `fx ask <prompt>` streams one libfx turn. `ask` reads `window.THEBIRD_FX` for `apiKey`, optional `model`, and optional `gatewayChatUrl`; no credential is committed or written to OPFS. The WASM core needs WebAssembly JSPI. |

The page's shell functions `which`, `command -v` and `type` (`web/shell-lookup.js`) answer from bashkit's own `builtin command -v` and `builtin type`, except that each in-page builtin reports as a builtin, and `which` prints the name for it. Shell functions are visible to `type` and `compgen -c`; `type -a` is not handled.

`ps`, `uname`, `hostname`, `id`, `whoami`, `kill` and `tar` are emulations that report sandbox values. A command that names one of them gets a note saying so.

Background jobs are refused by `hasBackgroundOperator` in `web/bash-shell.js`, and the worker answers that a background job is not supported in the in-page shell. `node` is an alias for the txiki engine (see the txiki section), and a host binary that is not in the page, such as `ruby`, exits 127.

## Commit gate

`git commit -m` runs `web/commit-gate.js` before committing. Each check is named in the refusal:

- `index`: no staged copy differs from the working tree.
- `staged`: something is staged.
- `syntax`: each committed `.js`, `.mjs` or `.cjs` parses with the vendored acorn, as a module (`.cjs` as a script).
- `ascii`: each committed text file is ASCII. Binary files are skipped when a NUL byte appears in the first 8000 bytes.
- `docs`: `README.md`, `AGENTS.md`, `ARCHITECTURE.md` and `DESIGN.md` are in the commit, and each backticked repo path in them exists in the commit.
- `smoke`: a file round trip, and a git blob hash of a fixed payload that matches git's. A changed payload hashes differently. The scratch directory `.thebird/gate-smoke` is removed afterwards.

The gate does not judge meaning or behaviour, does not check doc claims beyond path existence, and does not check CommonJS-only constructs in `.js` files. It lists these in `NOT_COVERED`. The commit is made as the author set in `web/git-program.js`.

## OPFS shim

`web/shims/fs.js` is a synchronous in-memory tree. `hydrate()` loads it from OPFS at start, and `flushFs()` writes dirty files back after each worker message. Writes are write-behind, so each reply waits for the flush.

Symlinks are link entries. Reads, writes, `stat`, `readdir`, `open` and `realpath` follow them up to 40 levels. `lstat`, `readlink`, `unlink`, `rm` and `rename` act on the link itself. The link table is `/.thebird/links.json`.

`fs.watch` is a no-op, and there are no file modes or locks. `fs-promises.js` wraps the same calls in promises.

## Relay

`src/relay.js` is a static server. It binds `127.0.0.1` by default, and `--port` and `--host` change that. It answers GET and HEAD only; other methods get 405 with `Allow: GET, HEAD`. `/` serves `web/terminal.html`, `/web/*` serves files under `web/` (paths that leave `web/` are refused), and anything else is 404.

Every response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so the page is cross-origin isolated. A static host serving the page needs the same two headers.

## Vendored and generated files

- Committed bundles: `web/vendor/acorn.mjs`, `web/vendor/isomorphic-git.mjs` and the libfx modules in `web/vendor/fx/`. They keep their upstream comments and are not edited.
- Generated and gitignored: `web/vendor/bashkit/` from `scripts/vendor-bashkit.mjs` (`@everruns/bashkit-wasm` 0.20.3; the wasm SHA-256 is checked against `build-info.json`). Pyodide is not vendored or generated: the page fetches the stripped bundle at run time, and the witness reads the Pyodide 314.0.7 lock from its pinned jsDelivr URL (`https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json`) and checks its SHA-256 before it reads micropip from it.
- Committed and generated: `web/vendor/fx/` from `scripts/vendor-fx.mjs` (the libfx SDK modules and `fx-core.wasm`, from the sibling fx checkout or `FX_REPO`; Pages sets it to the latest gmfx `main`; `manifest.json` records each file's SHA-256). The WASM is rebuilt with Zig 0.17.1 only when it is missing or `FX_REBUILD=1`.
- Committed and generated: `web/vendor/gm/` from `scripts/vendor-gm.mjs`. `gm-core.wasm` is a Zig `wasm32-wasi` build of gm's portable C++ `json.cpp`, `sha256.cpp` and `compact.cpp`, with `scripts/gm/bridge.cpp` exposing JSON normalization, SHA-256, output clipping and digests, and the core ABI version. Built with `-Oz`, the artifact is about 400 KB. `gm-core.js` instantiates it through `web/shims/wasi-preview1.js`; `skills.js` embeds gm's three served skills. Pages rebuilds it from gm `main` on each deploy.
- Committed and generated: `web/vendor/floosie/` from `scripts/vendor-floosie.mjs`, a bare JS browser bundle from floosie `main` with no `node:` imports. `manifest.json` records the floosie commit and the bundle SHA-256. Pages rebuilds it from floosie `main` on each deploy.
- The bashkit generator needs network. The page builder runs each generator when its files are missing.
- Committed third-party, unmodified: `web/vendor/brotli/` holds `brotli-dec-wasm` 2.3.2 from npm (`brotli_dec_wasm.js` and `brotli_dec_wasm_bg.wasm`, byte-identical to the package's pkg directory). `web/vendor/tte-js/` is the tte-js project from github.com/flaviocopes at commit `9b120c2f65d48f996a027ef061712bb87ad467bb`. The `laseretch` effect is defined in `web/vendor/tte-js/src/builtin-effects.js`.
- pip fetches micropip at run time from the CDN. Nothing is vendored beyond the Pyodide core. Wheels are not added to `web/vendor/` without owner approval.

## Checks

- `npm run check` runs `node --check` on the server, the scripts and the web files.
- `npm run lint:comments` (`scripts/lint-comments.mjs`) lists each comment in repo-owned tracked files with its file and line, and exits non-zero when there are any. Vendored bundles with comments are reported as VENDORED when their upstream is recorded. A tracked file of an unknown type fails.
- `npm run lint:architecture` (`scripts/lint-architecture.mjs`) checks the claims in `ARCHITECTURE.md` and `AGENTS.md` against the code and records the `cc242f5` check. Its live checks need `web/vendor/bashkit/` present, because the lint does not generate it.
- `npm run witness` (`scripts/witness.mjs`) drives headless Chromium through `scripts/browser-driver.mjs`, using `CHROME_BIN`, and checks the in-page shell end to end.

## Fresh-tree notes

- A tree from `git archive` has no `.git`. The lints call git, so they cannot run there.
- The `cc242f5` record (the owner commit) reports PASS when the object resolves to a commit. It reports UNVERIFIED (no history) only when the object does not resolve and the tree has one commit. It FAILs when the object does not resolve on a tree with more history.

## txiki.js in the page

txiki.js is the primary goal, and the owner reversed the earlier rejection on 2026-11-08. `scripts/vendor-txiki.mjs` builds txiki.js v26.11.0 (QuickJS-ng and libuv 1.53) for wasm32-wasi with zig 0.17.1. Its libuv is replaced by `scripts/txiki/browser/uv-browser.c`: the loop, timers, handles, streams and tty are implemented there. Every other symbol the link needs is stubbed from `scripts/txiki/stubs.tsv`, one row per symbol with its reason. The same table records the modules excluded from the browser build (channel, dns, fswatch, hashing, httpserver, miniz, posix_socket, process, tls, udp and ws), and libwebsockets, which is not vendored. The native httpclient is excluded too, and `scripts/txiki/browser/httpclient-browser.c` replaces it, as described below. Webcrypto is excluded too, but `scripts/txiki/browser/webcrypto-browser.c` defines `core.webcrypto` with functions that throw a TypeError, so the crypto polyfill loads. `uv_os_uname` and `uv_os_homedir` are implemented in the browser libuv with fixed values.

The event loop runs in turns: each turn runs `uv_run` once in non-blocking mode, and while timers are pending the call returns to the page, which ticks it again (`tjs_browser_tick`) after 5 ms. A page abort reaches the engine through `tjs_browser_cancel`. A Ctrl-C on an isolated page reaches it through the shared cancel word, read by `tjs_cancel_requested`. Both are also checked inside a running job by the QuickJS interrupt handler, so a loop with no await stops there, and the run ends with 130. A deadline set per run (`tjs_browser_set_deadline`, from `timeoutMs`) stops a job the same way with 124. `TJS_Run` is not used, because it runs the file-based `run-main` bootstrap, which reads `tjs.exePath`. `scripts/txiki/browser/entry.c` evaluates the code as a module with `JS_Eval` and drains pending jobs before each `uv_run`. When the drain finishes with network requests still open, the runtime stays alive and returns to the host. The host answers each request, then calls `tjs_browser_resume` with one event, and the drain runs again. `tjs_browser_end` frees the runtime. `web/txiki-in-page.js` runs this loop as the `tjs -e "<code>"` builtin, with `qjs` kept alongside it. Each `runTjs` call takes an engine instance from a pool and returns it when the run ends. An instance keeps its own cwd, stdio, bridge session and memory, so a builtin that starts an engine run from inside another run (the txiki shell's bridged `git`, for example) gets an instance of its own. The page serves bridged builtins through the `builtin` option of `runTjs`, and `web/builtins.js` is the one dispatch for all nine builtins.

txiki's own `fetch` is the one used in the page. Its polyfill, in the txiki.js source tree, sits on the native `HttpClient`, which `scripts/txiki/browser/http-client.js` implements in JavaScript and `scripts/txiki/browser/httpclient-browser.c` installs as `core.HttpClient`. That class sends `open` and `abort` messages through the `tjs_bridge_send` import. The host performs each request with the browser's `fetch` and returns the status, headers, body chunks and completion as events. The browser follows redirects itself, and cookies and the allow-insecure option have no effect in the page. A request body is sent in full when the stream ends. `curl` and `wget` generate a module that calls `fetch`, so their requests use this path. A cancel from Ctrl-C aborts the open requests and ends the runtime.

git runs in the same engine. `web/git-in-page.js` refuses `clone`, `fetch`, `pull` and `push` before `runTjs` is called, so no request is made. For the other verbs it builds one code string: a `const native = globalThis.__thebirdFs` capture (`scripts/txiki/browser/fs-browser.c`, installed by `entry.c` on each runtime), then `web/git-program.js`, then isomorphic-git, acorn and the commit gate as function-wrapped text, then the call to `gitMain`. The engine's loader cannot import `tjs:internal/*` from a user module, so the sources travel in the string. The native fs object reads and writes through `tjs_fs_open`, `tjs_fs_read`, `tjs_fs_write`, `tjs_fs_truncate`, `tjs_fs_size`, `tjs_fs_delete`, and the added `tjs_fs_stat`, `tjs_fs_readdir`, `tjs_fs_mkdir` and `tjs_fs_rmdir`, which `web/txiki-in-page.js` implements over `web/shims/fs.js`. Errors reach isomorphic-git with `ENOENT`, `EEXIST` and the other codes it tests.

The gate counts as passing only when the wasm links with zero undefined symbols. Node stays only as the static server.

sqlite is built into the same wasm. `scripts/vendor-txiki.mjs` compiles the sqlite3 amalgamation that the txiki.js source tree ships, with SQLITE_OS_OTHER=1, and txiki's mod_sqlite3 registers tjs:sqlite when the build passes -DTJS_HAVE_SQLITE (set in `flagsFor`). `scripts/txiki/browser/sqlite-vfs.c` supplies `sqlite3_os_init`, a VFS named `thebird` that calls the `tjs_fs_*` host imports, and `tjs_random` and `tjs_now_ms`. Those imports are implemented in `web/txiki-in-page.js` over `web/shims/fs.js`, and the file tree is the one the in-page shell uses for `/workspace`. The gate requires the exports `_initialize`, `malloc`, `free`, `tjs_browser_eval`, `tjs_browser_resume` and `tjs_browser_end`, and fails on any undefined symbol.

`tjs -e` evaluates its code as an ES module, so `import { Database } from 'tjs:sqlite'` works. A module that rejects reports `Uncaught ...` and exits non-zero.

The earlier gm-backed CLI and library were removed at `0538b2c`; the gm builtin added here is gm's stdio MCP server in the page over a C++ WebAssembly core, not a return of that CLI.
