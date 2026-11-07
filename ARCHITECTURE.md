# Architecture

```
bin/thebird.js -> src/cli.js -> src/runner.js -> src/commands.js
                       |
                       v
                  src/index.js (library) -> src/api.js
                       |
                       v
              src/gm.js -> gm createTools() -> gm verbs

browser: web/terminal.js -> src/runner.js -> src/api.js -> src/gm-remote.js
            -> HTTP -> src/relay.js -> src/gm.js -> gm verbs
```

The gm-backed CLI and library are present in `bin/` and `src/`. There is one
boundary: thebird owns argument parsing, command aliases and the REPL; gm owns
every real operation. The legacy browser runtime, vendored kits, service
workers, LLM gateways and per-instance virtual filesystems were deleted in
owner-approved commit `cc242f5`; none of them was on this CLI's execution path.

## Browser runtime

The default browser terminal runs gm in a Web Worker (`web/gm-worker.js`).
Its `node:` imports are rewritten to browser shims in `web/shims/` (see
`src/shim-map.js`), and its files live in OPFS (`web/shims/fs.js`: a sync
in-memory tree, hydrated from OPFS at start and flushed before each reply).
`?engine=relay` uses the host relay instead. `?gm=raw` loads gm without
rewriting, which is how the witness shows the "before" failure.

Measured in headless Chromium (`npm run witness`):

| Command | In-page result |
| `write`, `read`, `ls`, `stat`, `grep`, `search` | works; the file survives a browser restart |
| `memory write`, `memory search`, `prd add`, `prd list`, `log`, `config` | works |
| `shell` (bash builtins and pipelines, see below) | runs in-page through bashkit |
| `git init`, `add`, `status`, `log`, `diff` (shell, and gm `git_status`, `git_log`, `git_diff`, `git_add`) | works in-page through isomorphic-git over the OPFS tree |
| `git commit` (shell and gm `git_commit`) | runs the in-page gate (acorn syntax, ASCII, docs paths, scratch round trip), then commits as lanmower; refuses with the failing check names |
| `git push/fetch/pull`, `job start` | need the relay (`?engine=relay`) |
| `git branch`, `git checkout` (local branches) | in-page through isomorphic-git |
| `fetch` | fails for hosts without CORS headers (COEP `require-corp`) |

Child-process call sites in gm (from `import ... from 'node:child_process'`):

| gm module | Calls | Verbs | In-page replacement |
| `exec.mjs` | 4 `spawn` | `run_shell`, `job_*`, and every git verb through `runCommand` | blocked; bash-in-wasm covers builtins only |
| `tools.mjs` | 1 `spawnSync` | `run_shell` path | blocked |
| `git.mjs` | via `exec.mjs` | `git_*`, `ci_status` | partial: isomorphic-git answers `git_status`, `git_log`, `git_diff`, `git_add` |
| `search.mjs` | 1 `execFileAsync` (git file listing) | `search`, `wiki_search` | partial: list files from OPFS |
| `code-ast.mjs` | 1 `execFileAsync` (git file listing) + acorn | `callers`, `impact` | partial: vendored acorn and an emulated git file listing |
| `review.mjs` | 1 `spawnSync` | `review_*` | blocked |
| `gate.mjs` | 1 `spawnSync` and 1 `execFileSync` | gate checks | blocked |
| `body-worker.mjs` | 1 `spawnSync` (`node --check`) | `run_code` | partial: Web Worker runs code, syntax check needs host |
| `mcp-client.mjs` | 1 `spawn` | MCP servers | blocked |
| `bench.mjs` | 1 `spawnSync` | bench | blocked |

Known gaps in the browser shims:

- Symlinks are link nodes in the OPFS shim (`web/shims/fs.js`). Reads, writes,
  `stat`, `readdir`, `open` and `realpath` follow them, up to 40 levels; `lstat`,
  `readlink`, `unlink`, `rm` and `rename` act on the link itself. Link targets
  are stored as typed, and relative ones resolve from the link's directory. The
  table is kept in `/.thebird/links.json`, written with the rest of the tree.
  The browser witness checks `ln -s`, `readlink`, a read and a write through
  the link, `ls -l`, `rm` on the link, and a browser restart.
- `fs.watch` is a no-op, and there are no file modes or locks.
- Writes are write-behind, so each tool call is durable once it returns.
- One worker, one writer, and the whole tree is held in memory.
- `AsyncLocalStorage` only holds context for synchronous code.
- In-page git has local branches and checkout (`branch`, `checkout`,
  `checkout -b`, through isomorphic-git), but no remotes, stash or path
  checkout. `diff` compares the working tree with HEAD and prints no hunk headers.
- The in-page commit gate (`web/commit-gate.js`) is not gm's gate. It runs the
  syntax check with vendored acorn, the ASCII check, the docs path check for
  README, AGENTS, ARCHITECTURE and DESIGN, and a scratch round trip whose blob
  hash must match git's. A missing README, AGENTS, ARCHITECTURE or DESIGN in
  the commit fails the docs check and is named. It does not run gm's sources, wiki, skills, connect,
  workers, prompt or KEEP checks, or gm's agent smoke run. The relay's
  `git_commit` still runs the full Node gate, unchanged.
- The relay must send `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, because gm's `pending.mjs`
  uses `SharedArrayBuffer`. A static host needs the same headers.

## In-page bash

`shell` runs in-page through `@everruns/bashkit-wasm` 0.20.3 (MIT, a Rust
bash interpreter compiled to wasm, single-threaded). The package is fetched
and checked by `scripts/vendor-bashkit.mjs`, which verifies the wasm SHA-256
against the package's `build-info.json`. The output lands in
`web/vendor/bashkit/`, which is gitignored and is fetched on first witness run.
Its host filesystem is `web/shims/bashkit-host.js`, which wraps the same OPFS
tree that gm uses, so a write from bash is visible to gm and the reverse holds.

Probed coverage (Node, 0.20.3): bash syntax (variables, arithmetic, loops,
functions, command substitution, redirects, pipes, `&&`), and these
commands: echo, printf, test, seq, sed, awk, grep, sort, uniq, wc, head, tail,
cut, tr, find, xargs, tee, ls, cp, mv, rm, mkdir, touch, cat, basename,
dirname, date, env, export, type, jq, base64, md5sum, sha256sum, gzip and
gunzip, sleep. `ps`, `uname`, `hostname` and `tar` are emulated and report
sandbox values, not the host's. When a command names `uname`, `whoami`,
`hostname`, `id`, `ps`, `kill` or `tar`, the in-page shell appends a note saying so.
`tar --version` reports `tar (bashkit) 0.1`, bashkit's own build, which the witness checks.

Not covered: node and any host binary (exit 127). `sqlite3` and `python3` run
in-page, as described below.

`sqlite3 <database> <sql>` is a custom builtin (`web/sqlite-in-page.js`) over
sql.js 1.15.2 (MIT, `web/vendor/sqljs/`, licence `web/vendor/SQLJS-LICENSE`).
The database is a file on the OPFS tree. It is read at the start of each call
and written back at the end, so it survives a browser restart. Output is
sqlite's list mode, with `|` between columns. bashkit ships its own `sqlite3`
that fails in this build, but a custom builtin overrides it.

Relay-only items, ranked by what can run in the browser:

| Item | In-page option | Status |
| `sqlite3` | sql.js 1.15.2, MIT, about 670 KB of wasm | done, witnessed in headless Chromium |
| `python3` | Pyodide 314.0.7, MPL-2.0, about 14 MB unpacked | done, witnessed in headless Chromium |
| `node` | none verified: WebContainers is proprietary, and a JS subset is not Node | stays relay-only |

`python3 -c <code>` and `python3 <file>` are a custom builtin
(`web/python-in-page.js`) over Pyodide 314.0.7 (MPL-2.0, notice in
`web/vendor/PYODIDE-NOTICE.md`). The runtime is fetched by
`scripts/vendor-pyodide.mjs`, checks each file's pinned SHA-256, and is
gitignored. Pyodide loads on the first call. The `/workspace` tree is mirrored
into Pyodide's memory filesystem. Before each call, only files whose shim
revision changed are uploaded; the shim's per-file revision counter comes from
`mark()` in `web/shims/fs.js`. After the call, every Pyodide file is read and
compared with the mirror, and changed, new and deleted files are written back
to OPFS. The read-back is O(n) by design: detecting changes by timestamp could
miss a same-size write within one millisecond. Measured in headless Chromium,
over 300 files, a warm call takes 0.9 ms with this sync and 1.3 ms with the
full copy it replaced. Only the last line of a traceback is reported, and
printed output comes before it. The scheme is dropped from that text, because
bashkit cuts error text at `//`.

`pip install <package>...` runs in-page (`pipBuiltin` in `web/python-in-page.js`).
It loads micropip 0.11.1 from the jsDelivr CDN as a wheel, pinned to the same
Pyodide version (`v314.0.7`) as the vendored core, and micropip fetches pure
Python wheels from PyPI (JSON API and `files.pythonhosted.org`, both send
`Access-Control-Allow-Origin: *`). Nothing is vendored. Only plain names are
accepted: version specifiers and URLs are refused. Names in the vendored
Pyodide lock (`pyodide-lock.json`, 357 entries) are refused with a clear
message, because micropip would try to load them from the vendored index,
which has no wheels. Installed packages live in Pyodide's memory for the page
session, and are not written to OPFS. The witness checks that micropip's
wheel name matches the lock, that a pure package installs and imports in the
same page, and that refusals are readable and carry no URL.

`which`, `command -v` and `type` are shell functions defined at shell start
(`web/shell-lookup.js`). They answer from bashkit's own `builtin command -v` and
`builtin type`, except that the five in-page builtins report as builtins. A
witnessed loop checks that the three agree for every name Tab offers.
`shell` passes its text to bashkit raw, so quotes and parentheses survive. The
runner used to strip quotes from `shell` lines. bashkit resets `$?` on every
`execute()`, so each in-page run starts with `(exit N);` for the previous run's
status, and `$?` carries across terminal lines.
Shell output streams while a command runs. bashkit calls `onOutput` with stdout and
stderr chunks, the worker posts each one to the page, and the page appends it. The
final result carries only the notes and any cancel text, so nothing prints twice.
Output is plain text by default: `web/ansi.js` strips every escape sequence, including
across streamed chunks, so the page's text copies cleanly. `?ansi=color` renders
SGR colour and style (the 16 palette colours, bold, underline) as classed spans in
`web/terminal.html`; the copied text is the same either way.
Ctrl-L clears the output, Ctrl-U clears the line, and Ctrl-A and Ctrl-E move the
caret to the start and end of the line; each is handled in the page, not by the browser.
Lines typed while a command runs wait in a queue and run in order. Ctrl-C cancels
the running command and drops the queued lines.
The prompt shows the shell's working directory. The shell reads it back with
`pwd` after each run, and Tab completes relative to it. Relay mode shows the workspace in the prompt, because each host command starts in the workspace and `cd` does not carry over.
The terminal keeps history for the up and down arrows, in localStorage, and
stores only the submitted command lines (see AGENTS.md). Tab completes the first word after `shell` against the command names the shell
resolves (`compgen -c`, kept only where `command -v` succeeds), so a listed name runs.
Otherwise Tab completes the last word against the workspace tree, which the worker lists from the OPFS shim. A
unique match completes with a space or a slash, and several matches complete the
common prefix or list the candidates. Relay mode completes the same way: `src/gm-remote.js` answers command names with `compgen -c` through `run_shell`, and file names with `list_dir`, both over `/call`, so the relay surface is unchanged. Ctrl-C while a command runs
cancels it through bashkit's `cancel()`, which takes effect between commands and
sleeps, not inside one blocking step. Relay mode cancels the same way through `POST /cancel`, which aborts the in-flight
`/call` with that id; the relay's gm call receives an AbortSignal, which gm's run_shell stops by
killing the command's process group. `/cancel` answers 404 for an unknown id, 400 for a
non-JSON body and 405 for other methods, and it adds no CORS headers.
`curl` and `wget` (`web/curl-in-page.js`) run over fetch, for hosts that send
CORS headers to this page. A host without them is refused with a pointer to the
relay. The flags `-s`, `-S`, `-f`, `-L` and `-q` work for both, alone or combined (`-SL`); curl also takes `-o file` and wget `-O file`. Any other flag is refused with a pointer to the relay.
Background jobs
(`job start`, and a bare `&` in shell text, refused by `hasBackgroundOperator`
in `web/bash-shell.js`) need the relay. `head` after an early-closing pipe needs the
async `execute()` path, which the shell uses.

`git` is a bashkit custom builtin (`customBuiltins` in `web/bash-shell.js`)
backed by isomorphic-git 1.44.11 (MIT). The bundle is `web/vendor/isomorphic-git.mjs`,
built with esbuild, and its licence is `web/vendor/ISOMORPHIC-GIT-LICENSE`.
`--version` reports the in-page library version, not a host git.
`init`, `add`, `status`, `log [-n N]` and `diff` run over the OPFS tree, and
`status` prints porcelain v1 lines after a `## <branch>` header. `commit -m` runs the in-page gate
(`web/commit-gate.js`) and commits as lanmower; a failing gate refuses the
commit and names each failed check. The worker answers the gm verbs
`git_status`, `git_log`, `git_diff`, `git_add` and `git_commit` with the same
functions (`web/git-in-page.js`); `git_commit` refuses `paths` and `author`
arguments. `.thebird/` is excluded from the index. The browser witness commits
in-page and checks that the log HEAD matches the commit it printed, then
checks that broken syntax and non-ASCII are refused. A Node-side witness check
commits through the same builtin, then checks status, log and diff.

