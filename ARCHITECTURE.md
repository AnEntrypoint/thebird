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
| `shell`, `job start`, `git status` | `ENOSYS` (child processes) |
| `fetch` | fails for hosts without CORS headers (COEP `require-corp`) |

Child-process call sites in gm (from `import ... from 'node:child_process'`):

| gm module | Calls | Verbs | In-page replacement |
| `exec.mjs` | 4 `spawn` | `run_shell`, `job_*`, and every git verb through `runCommand` | blocked; bash-in-wasm covers builtins only |
| `tools.mjs` | 1 `spawnSync` | `run_shell` path | blocked |
| `git.mjs` | via `exec.mjs` | `git_*`, `ci_status` | partial: a JS git library could replace a subset |
| `search.mjs` | 1 `execFileAsync` (git file listing) | `search`, `wiki_search` | partial: list files from OPFS |
| `code-ast.mjs` | 1 `execFileAsync` (git file listing) + acorn | `callers`, `impact` | blocked: acorn is not bundled and git is needed |
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
- `acorn` is not bundled, so AST verbs fail.
- The relay must send `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, because gm's `pending.mjs`
  uses `SharedArrayBuffer`. A static host needs the same headers.

