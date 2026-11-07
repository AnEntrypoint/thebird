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
| `git push/fetch/pull/branch/checkout`, `job start` | need the relay (`?engine=relay`) |
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

- No symlinks: `lstat` is `stat`, and `realpath` is path normalization.
- `fs.watch` is a no-op, and there are no file modes or locks.
- Writes are write-behind, so each tool call is durable once it returns.
- One worker, one writer, and the whole tree is held in memory.
- `AsyncLocalStorage` only holds context for synchronous code.
- In-page git has no branches, remotes, checkout or stash. `diff` compares the
  working tree with HEAD and prints no hunk headers.
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
sandbox values, not the host's.

Not covered: node, python3, and any host binary (exit 127). `sqlite3` runs
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
| `python3` | Pyodide, MPL-2.0, npm package about 14 MB unpacked | not implemented; next candidate |
| `node` | none verified: WebContainers is proprietary, and a JS subset is not Node | stays relay-only |

`shell` passes its text to bashkit raw, so quotes and parentheses survive. The
runner used to strip quotes from `shell` lines.
`curl` and `wget` report "network access not configured". Background jobs
(`job start`) need the relay. `head` after an early-closing pipe needs the
async `execute()` path, which the shell uses.

`git` is a bashkit custom builtin (`customBuiltins` in `web/bash-shell.js`)
backed by isomorphic-git 1.44.11 (MIT). The bundle is `web/vendor/isomorphic-git.mjs`,
built with esbuild, and its licence is `web/vendor/ISOMORPHIC-GIT-LICENSE`.
`init`, `add`, `status`, `log [-n N]` and `diff` run over the OPFS tree, and
`status` prints porcelain v1 lines. `commit -m` runs the in-page gate
(`web/commit-gate.js`) and commits as lanmower; a failing gate refuses the
commit and names each failed check. The worker answers the gm verbs
`git_status`, `git_log`, `git_diff`, `git_add` and `git_commit` with the same
functions (`web/git-in-page.js`); `git_commit` refuses `paths` and `author`
arguments. `.thebird/` is excluded from the index. The browser witness commits
in-page and checks that the log HEAD matches the commit it printed, then
checks that broken syntax and non-ASCII are refused. A Node-side witness check
commits through the same builtin, then checks status, log and diff.

