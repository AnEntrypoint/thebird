# Pending validation

Phase A changes. None of these has been run through `npm run check`, `npm run lint:comments`, `npm run lint:architecture`, `npm run witness`, `npm run witness:shell`, a build, Pages, or a browser. Each row names the file, the group, and the check that must pass before the change is trusted.

## Committed locally, not pushed

| Commit | File | Group | Check needed |
| --- | --- | --- | --- |
| 6943688 | scripts/build-pages.mjs | Pages build | `node scripts/build-pages.mjs` completes without calling `vendorPyodide`, after `vendorBashkit` and the txiki wasm are in place. The pages.yml build job runs it. |
| 6943688 | scripts/witness.mjs | pip lock | The witness reads the pip lock from `BUNDLE_URL` via `unpack(...).lock`. Chromium witness passes the pip-refusal check against the lock. |
| 6943688 | web/python-bundle.js | `unpack` export | `unpack` is importable from Node (the brotli wasm glue loads under Node). Run `node -e "import('./web/python-bundle.js').then(m => console.log(typeof m.unpack))"`. |
| c7ea6e7 | web/shell-core.js | coreutils: ls, mkdir, rm, find, wc, date, uname, whoami | `npm run witness:shell` coreutils groups pass. Expected strings: `ls` one-per-line, `mkdir -p` and the "File exists" error, `rm -r` / `rm -f` messages, `find -name/-iname/-type`, `wc -l/-w/-c` number formats, `date +%s/%N/%Y/%m/%d/%H/%M/%S/%%`, `uname` = Linux, `whoami` = user. |
| c7ea6e7 | web/shell-core.js | `Array.prototype.findLastIndex` | Used by `globField`; confirm it exists in the txiki engine (quickjs-ng) or replace it. |
| b43e3b8 | scripts/witness-shell.mjs | memoryHost, coreutils tests | `npm run witness:shell` exits 0 with `RESULT PASS=n FAIL=0`. Memory host `remove(path, recursive)` behaves as the coreutils groups expect. |
| f76f96f | web/node-in-txiki.js | existsSync | Per-command node witness: `existsSync` returns false for a missing path and true for an existing one (`stat` returns null when missing). |
| f76f96f | scripts/witness.mjs | per-command node block | The Chromium witness runs the node block (`which node`, `command -v node`, `type node`, `node -v`, `node node-marker.js`, `node -e ...`, `node node-check.js hello`) and every check passes. |
| bf7849f | web/shell-core.js | saved state, `snapshot()` | `npm run witness:shell` checks that `createShell({ saved })` restores cwd, status, vars and functions. Run the snapshot round trip in Node. |
| bf7849f | scripts/witness-shell.mjs | saved-state runner | Groups that exercise `saved` pass. |
| 1f37724 | web/shell-program.js | txiki static program | Runs under the txiki engine with `__thebirdFs` installed. Check that `TextEncoder`, `TextDecoder`, `console.log` and `Array.prototype.findLastIndex` are present in the engine. Check that `JSON.stringify` of the `\u0001` marker payload round trips. |
| 1f37724 | web/shell-in-txiki.js | txiki runner | Runs the core through `runTjs` and the static program. Checked by the browser check in 64179b3. |
| 64179b3 | scripts/witness.mjs | txiki runner check | Browser check after the node block: `first-7\n` and `second-7\n/workspace/notes/txiki\n` across a saved-state run (`runShellInTxiki`), through `globalThis.__txikiShellRuns`. |
| this series (see git log) | web/shell-core.js | grep, hostname, id | `npm run witness:shell` group `coreutils: grep, hostname and id`: `grep -in` numbering, `grep -v`, `grep -c` on piped input, several files prefixed, missing file exit 2, no match exit 1, `hostname` = thebird, `id` string, and `command -v` resolves all three to `/bin/...`. `grep` uses a JavaScript RegExp, not POSIX BRE/ERE; patterns that differ between the two are not covered. |
| this series (see git log) | scripts/witness-shell.mjs | grep, hostname, id | Same group as above. |

## Blocked (not coded, named blocker)

| Group | Blocker | What it needs |
| --- | --- | --- |
| Symlinks (`ln -s`, `readlink`, `test -L`, `ls -l` arrows, `rm` of a link surviving a restart) | The txiki fs binding has no link or readlink host import. | A C change in `scripts/txiki/browser/fs-browser.c`, a zig rebuild, a new `tjs.wasm` pin in `scripts/vendor-txiki.mjs` and `.github/workflows/pages.yml`, and the txiki workflow. |
| External builtins from the txiki run (`git`, `sqlite3`, `python3`, `pip`, `qjs`, `tjs`, `node`, `curl`, `wget`) | The engine run is synchronous and cannot call page-side workers or fetch. | A host-call bridge, or a stepwise design. Owner decision. |
| Ctrl-C and `COMMAND_TIMEOUT_MS` in the txiki path | The page's abort signal does not reach the engine. Only timeouts inside the program via `setTimeout` exist. | An engine-side abort event. |
| `tar`, `ps`, `kill` | Not implemented in `web/shell-core.js`. `ps` and `kill` need a process table the txiki run does not have. | Implementation and witness groups; `ps` and `kill` need a design decision first. |
| `sed`, `awk`, `jq` | bashkit provides them today; not in the core. Each is a parser of its own. | One group each, with its own witness. |

## Open decisions

- `scripts/vendor-pyodide.mjs`: kept for now. Its retirement is a Phase B decision. In Phase A the references in ARCHITECTURE.md and AGENTS.md to `web/vendor/pyodide/` and `scripts/vendor-pyodide.mjs`, and the checks in `scripts/lint-architecture.mjs`, are left unchanged. No build or witness calls `vendorPyodide` any more (6943688). In Phase B, once the build and witnesses run, decide whether to keep or retire the script, then update the docs and the lint in the same change.
- The owner has not yet confirmed the licence of the stripped Pyodide bundle.
