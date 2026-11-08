# Architecture

## Flow

```
web/terminal.js -> web/shell-client.js -> postMessage -> web/shell-worker.js
  -> web/bash-shell.js -> bashkit (web/vendor/bashkit/)
       -> custom builtins (git, sqlite3, python3, pip, curl, wget)
       -> web/shims/bashkit-host.js -> web/shims/fs.js (OPFS)
```

The worker posts each streamed output chunk as `{ output }`, and each reply as `{ id, ok, result }` or `{ id, ok: false, error }`. The page appends streamed chunks as they arrive. The final result carries only notes and cancel text, so output is not printed twice.

Lines typed while a command runs wait in a queue and run in order. Ctrl-C while busy drops the queue, posts a cancel, and bashkit's `cancel()` takes effect between commands and sleeps, not inside one blocking step. Each run also gets an `AbortController` that `cancel()` aborts; `curl` and `wget` pass its signal to `fetch`, so a pending response is abandoned.

The prompt shows the working directory, read back with `pwd` after each run. Each run starts with `(exit N);` for the previous status, because bashkit resets `$?` on every `execute()`.

## Component map

| File | Role |
| --- | --- |
| `bin/thebird-relay.js` | Node entry point; reads `--port` and `--host`, starts the server. |
| `src/relay.js` | Node static server on 127.0.0.1 (see Relay). |
| `web/terminal.html` | Page markup and the colour classes used by `?ansi=color`. |
| `web/terminal.js` | Page logic: output, prompt, run queue, history, keys, Tab, `?run` and `?ansi`. |
| `web/shell-client.js` | Page-side client for the worker: `run`, `complete`, `cwd`, `cancel`, `onOutput`, `ready`. |
| `web/shell-worker.js` | Web Worker: hydrates OPFS, creates the shell, refuses background jobs, flushes OPFS. |
| `web/bash-shell.js` | `createShell`, `hasBackgroundOperator`, the bashkit `Bash` with the six custom builtins and `COMMAND_TIMEOUT_MS`. |
| `web/shell-lookup.js` | Shell prologue defining `which`, `command` and `type`. |
| `web/git-in-page.js` | `git` builtin over isomorphic-git. |
| `web/commit-gate.js` | In-page gate run by `git commit`. |
| `web/sqlite-in-page.js` | `sqlite3` builtin over sql.js. |
| `web/python-in-page.js` | `python3` and `pip` builtins over Pyodide. |
| `web/curl-in-page.js` | `curl` and `wget` builtins over fetch. |
| `web/ansi.js` | ANSI parser: strips escapes, or classes them for `?ansi=color`. |
| `web/shims/fs.js` | Synchronous in-memory tree hydrated from and flushed to OPFS. |
| `web/shims/fs-promises.js` | Promise wrappers over `fs.js`. |
| `web/shims/path.js` | `posix` path functions. |
| `web/shims/buffer.js` | `Buffer` over `Uint8Array`. |
| `web/shims/crypto.js` | `createHash` (sha1, sha256), `randomBytes`, `randomUUID`. |
| `web/shims/bashkit-host.js` | bashkit's host filesystem, over `fs.js`. |
| `web/vendor/acorn.mjs` | Vendored parser used by the commit gate. |
| `web/vendor/isomorphic-git.mjs` | Vendored git library. |
| `web/vendor/sqljs/` | Vendored sql.js. |
| `web/vendor/bashkit/`, `web/vendor/pyodide/` | Generated, gitignored runtimes. |
| `scripts/vendor-bashkit.mjs`, `scripts/vendor-pyodide.mjs` | Generate the runtimes, checking SHA-256. |
| `scripts/browser-driver.mjs` | Drives headless Chromium for the witness. |
| `scripts/lint-comments.mjs`, `scripts/lint-architecture.mjs`, `scripts/witness.mjs` | Lints and the browser witness (see Checks). |

## Command timeout

`COMMAND_TIMEOUT_MS` in `web/bash-shell.js` is 300000 (300 s). It is passed as `timeoutMs` to bashkit's `Bash` constructor, and bashkit applies it to each `execute()` call, one command line.

bashkit's default is 30 s, which was too short. In one of seven recorded witness runs a cold `pip install` of tabulate failed with `execution timeout (30s)`. With 300 s, a cold tabulate install completes in about 19-28 s in the in-page shell, and `sleep 40` completes.

The witness checks the expiry: six 55 s sleeps in a loop are cut at 300 s with `execution timeout (300s)`. That check takes about five and a half minutes.

## In-page builtins

| Builtin | Backing | Scope and limits |
| --- | --- | --- |
| `git` | isomorphic-git 1.44.11 (`web/vendor/isomorphic-git.mjs`) | `init`, `status` (porcelain v1 after a `## <branch>` line), `log [-n N]`, `diff` (working tree against HEAD, no hunk headers), `add`, `commit -m`, local `branch`, `checkout` and `checkout -b`. `--version` reports the library version. No remotes, `push`, `fetch`, `pull`, stash or path checkout. `.thebird/` is excluded from the index. |
| `sqlite3` | sql.js (`web/vendor/sqljs/`) | `sqlite3 <database> <sql>`. The database is a file on OPFS, read at the start of each call and written back at the end. |
| `python3` | Pyodide 314.0.7 (`web/vendor/pyodide/`) | `-c <code>` or `<file>`. Pyodide loads on the first call. `/workspace` is mirrored into Pyodide's memory filesystem: before a call only files whose revision (`revisionOf` in `web/shims/fs.js`) changed are uploaded; after it every Pyodide file is compared with the mirror, and changed, new and deleted files are written back. Errors show the output and summary with URLs removed. |
| `pip` | micropip 0.11.1 from the jsDelivr CDN, pinned to `v314.0.7` | `pip install <name>...`. Plain names only; version specifiers and URLs are refused. Names in the vendored lock (`pyodide-lock.json`) are refused, because the vendored index has no wheels for them. Pure wheels come from PyPI. Installed packages live in Pyodide's memory for the page session and are not written to OPFS. |
| `curl`, `wget` | fetch | Flags `-s`, `-S`, `-f`, `-L`, `-q`, alone or combined. `curl -o file` and `wget -O file`. Other flags are refused. Only hosts that send CORS headers to the page are reachable. |

The page's shell functions `which`, `command -v` and `type` (`web/shell-lookup.js`) answer from bashkit's own `builtin command -v` and `builtin type`, except that each in-page builtin reports as a builtin, and `which` prints the name for it. Shell functions are visible to `type` and `compgen -c`; `type -a` is not handled.

`ps`, `uname`, `hostname`, `id`, `whoami`, `kill` and `tar` are emulations that report sandbox values. A command that names one of them gets a note saying so.

Background jobs are refused by `hasBackgroundOperator` in `web/bash-shell.js`, and the worker answers that a background job is not supported in the in-page shell. `node` and host binaries exit 127.

## Commit gate

`git commit -m` runs `web/commit-gate.js` before committing. Each check is named in the refusal:

- `index`: no staged copy differs from the working tree.
- `staged`: something is staged.
- `syntax`: each committed `.js`, `.mjs` or `.cjs` parses with the vendored acorn, as a module (`.cjs` as a script).
- `ascii`: each committed text file is ASCII. Binary files are skipped when a NUL byte appears in the first 8000 bytes.
- `docs`: `README.md`, `AGENTS.md`, `ARCHITECTURE.md` and `DESIGN.md` are in the commit, and each backticked repo path in them exists in the commit.
- `smoke`: a file round trip, and a git blob hash of a fixed payload that matches git's. A changed payload hashes differently. The scratch directory `.thebird/gate-smoke` is removed afterwards.

The gate does not judge meaning or behaviour, does not check doc claims beyond path existence, and does not check CommonJS-only constructs in `.js` files. It lists these in `NOT_COVERED`. The commit is made as the author set in `web/git-in-page.js`.

## OPFS shim

`web/shims/fs.js` is a synchronous in-memory tree. `hydrate()` loads it from OPFS at start, and `flushFs()` writes dirty files back after each worker message. Writes are write-behind, so each reply waits for the flush.

Symlinks are link entries. Reads, writes, `stat`, `readdir`, `open` and `realpath` follow them up to 40 levels. `lstat`, `readlink`, `unlink`, `rm` and `rename` act on the link itself. The link table is `/.thebird/links.json`.

`fs.watch` is a no-op, and there are no file modes or locks. `fs-promises.js` wraps the same calls in promises.

## Relay

`src/relay.js` is a static server. It binds `127.0.0.1` by default, and `--port` and `--host` change that. It answers GET and HEAD only; other methods get 405 with `Allow: GET, HEAD`. `/` serves `web/terminal.html`, `/web/*` serves files under `web/` (paths that leave `web/` are refused), and anything else is 404.

Every response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so the page is cross-origin isolated. A static host serving the page needs the same two headers.

## Vendored and generated files

- Committed bundles: `web/vendor/acorn.mjs` (licence `web/vendor/ACORN-LICENSE`), `web/vendor/isomorphic-git.mjs` (`web/vendor/ISOMORPHIC-GIT-LICENSE`) and `web/vendor/sqljs/` (`web/vendor/SQLJS-LICENSE`). They keep their upstream comments and are not edited. Each licence file carries the MIT grant.
- Generated and gitignored: `web/vendor/bashkit/` from `scripts/vendor-bashkit.mjs` (`@everruns/bashkit-wasm` 0.20.3; the wasm SHA-256 is checked against `build-info.json`). `web/vendor/pyodide/` from `scripts/vendor-pyodide.mjs` (Pyodide 314.0.7; each file's SHA-256 is pinned in the script). Its licence notice is `web/vendor/PYODIDE-NOTICE.md`.
- Both generators need network. The witness runs the bashkit script when its files are missing.
- pip fetches micropip at run time from the CDN. Nothing is vendored beyond the Pyodide core. Wheels are not added to `web/vendor/` without owner approval.

## Checks

- `npm run check` runs `node --check` on the server, the scripts and the web files.
- `npm run lint:comments` (`scripts/lint-comments.mjs`) lists each comment in repo-owned tracked files with its file and line, and exits non-zero when there are any. Vendored bundles with comments are reported as VENDORED when their licence and upstream are recorded. A tracked file of an unknown type fails.
- `npm run lint:architecture` (`scripts/lint-architecture.mjs`) checks the claims in `ARCHITECTURE.md` and `AGENTS.md` against the code and records the `cc242f5` check. Its live checks need `web/vendor/bashkit/` and `web/vendor/pyodide/` present, because the lint does not generate them.
- `npm run witness` (`scripts/witness.mjs`) drives headless Chromium through `scripts/browser-driver.mjs`, using `CHROME_BIN`, and checks the in-page shell end to end.

## Fresh-tree notes

- A tree from `git archive` has no `.git`. The lints call git, so they cannot run there.
- The `cc242f5` record (the owner commit) reports PASS when the object resolves to a commit. It reports UNVERIFIED (no history) only when the object does not resolve and the tree has one commit. It FAILs when the object does not resolve on a tree with more history.

## Decision: txiki.js rejected

txiki.js was evaluated as an in-page runtime and rejected. It is a native runtime (QuickJS-ng and libuv) with no browser or WebAssembly build, so it cannot run the in-page code. Node stays only as the static server.

The before-state of the gm removal is commit `6b060f7`. `git diff --name-status 6b060f7 0538b2c` lists the 29 paths of that change.
