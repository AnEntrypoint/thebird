# Pending validation

Phase A changes. Validated in Phase B below; the rows that name commands not run here are listed under that section. Before Phase B, none of these had been run through `npm run check`, `npm run lint:comments`, `npm run lint:architecture`, `npm run witness`, `npm run witness:shell`, a build, Pages, or a browser. Each row names the file, the group, and the check that must pass before the change is trusted.

## Phase B validation (2026-11-08, pushed as dc3d558)

Run on `dc3d558` in this checkout. Each line is the output that proves the check.

- `npm run check`: exit 0.
- `npm run lint:comments`: `68 repo-owned files checked: 0 comments; 97 tracked files, 7 vendored files with comments`, exit 0.
- `npm run witness:shell`: `RESULT PASS=100 FAIL=0`, exit 0. Covers ls, mkdir, rm, find, wc, date, uname, whoami, grep, hostname, id, tar, sed, jq, awk, `$!`, ps, kill, wait and the saved core state.
- `npm run lint:architecture`: `247 claims: 247 pass, 0 fail, 0 unverified; 38 prose lines with NO_CLAIM`, exit 0.
- `npm run witness` (headless Chromium): `PASS=111 FAIL=0`, exit 0, `all checks passed`, `WITNESS-EXIT 0`. The node per-command lines are:
  - `PASS which node names node`
  - `PASS command -v node names node`
  - `PASS type node reports node as a shell builtin`
  - `PASS node -v prints a version`, value `v26.11.0`
  - `PASS node <script> runs through the txiki engine and prints its marker`, value `txiki-runtime 26.11.0`
  - `PASS node -e exposes typeof process and process.version`, value `object v26.11.0`
  - `PASS a node script reads process.argv and fs.readFileSync`, value `args hello\nread true`
  - `PASS the txiki shell runs a script on the engine, and the saved state carries the directory and variables to the next run`
- The txiki runner hang came from `entry.c`, which ran `uv_run` before the pending module jobs. A cleared timer kept the page blocked until it fired. The pump now drains jobs first. The wasm pin moved to `a9812524063e39ed98b592dda4c5af6ad91dcbb0f3c89720a276260ee7f9dae2`.
- Pyodide: the micropip check reads the vendored `web/vendor/pyodide/pyodide-lock.json`, which pins micropip 0.11.1. The bundle lock does not list micropip.

The Phase A table below is covered by these runs, except its rows that name a command not run here: the Pages build in pages.yml, and the `unpack` import check in `web/python-bundle.js`. The pip-lock row names the bundle lock, which is no longer the source the witness reads (see above). The Blocked section and the open decisions stay open. `scripts/vendor-pyodide.mjs` is unchanged.
## Phase A table (rows covered by the runs above)

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
| process model commit | web/shell-core.js | &, $!, ps, kill, wait | Background jobs: `cmd &` starts a pipeline with its own AbortController, `$!` is its PID, `wait` returns its status, `kill` aborts it with a signal number (code 128 + signal), `ps` prints the table. The witness group `process: ...` in scripts/witness-shell.mjs must pass: PIDs start at 101, the shell is PID 100, `ps` header and shell row are exact, `kill` of an unknown PID exits 1, `kill -l` lists HUP INT KILL TERM. Jobs still running at the end of a run receive SIGHUP (129). |
| process model commit | web/shell-core.js | sink signal | Each sink carries its signal (`sink.signal`) instead of a module-level `runSignal`. `sleep` takes the signal from dispatch. Every inner sink (group, subshell, if, for, function, command substitution) copies it. The coreutils and Ctrl-C groups must still pass, since abort now travels through the sink. |
| sed commit | web/shell-sed.js | sed | `sed: ...` group in scripts/witness-shell.mjs: s with g, -n with a numeric address and p, a regex range with d, & and \\1 \\2 replacements, -i then cat, a missing file exits 2 with `can't read`, an unknown command exits 1 with `char 1: unknown command`. The module is JavaScript RegExp, not POSIX. Hold space, branching, q, a, i, c, y, w, r and the `!` negation are not supported. |
| tar commit | web/shell-tar.js | tar | `tar: ...` group: create then list in order, a directory tree archived in sorted order and extracted with -C, combined -cvf and -xvf with verbose names, a missing member (Cannot stat, exit 2), a missing archive (Cannot open, exit 2), no mode (exit 2), and `tar -cf -` piped into `tar -tf -`. The archive is ustar with real headers and checksums. Append, update, links, compression and binary content are not supported. -tv prints names only. |
| jq commit | web/shell-jq.js | jq | `jq: ...` group: -r on a string field, negative index and iterate with -c, a pipe, select with a comparison, a pretty-printed object with exact indentation, -nc with add and length, a runtime error at mixed.json:2 with exit 5 and the other inputs still printed, a missing file with exit 2, and a syntax error with exit 3. Not supported: variables, reduce, foreach, if-then-else, try-catch (only a trailing ?), def, paths, update operators, string interpolation, -e, -j, -S, -a. Object key order follows JS object rules, so integer-like keys sort first. |
| awk commit | web/shell-awk.js | awk | `awk: ...` group: default whitespace split, -F with OFS join, a regex pattern alone, a numeric comparison pattern, BEGIN and END with a sum and NR, printf through ctx.format without ORS, toupper, length and substr, division by zero (exit 2), and a missing file (exit 2 with the rest read). Extras beyond the spec: C-style for, break, continue and # comments in the program text. Not supported: arrays and split, user functions, getline, output redirection, sub, gsub, match, math functions, range patterns. printf is limited to what ctx.format supports. |

## Blocked (not coded, named blocker)

| Group | Blocker | What it needs |
| --- | --- | --- |
| Symlinks (`ln -s`, `readlink`, `test -L`, `ls -l` arrows, `rm` of a link surviving a restart) | The txiki fs binding has no link or readlink host import. | A C change in `scripts/txiki/browser/fs-browser.c`, a zig rebuild, a new `tjs.wasm` pin in `scripts/vendor-txiki.mjs` and `.github/workflows/pages.yml`, and the txiki workflow. |
| External builtins from the txiki run (`git`, `sqlite3`, `python3`, `pip`, `qjs`, `tjs`, `node`, `curl`, `wget`) | The engine run is synchronous and cannot call page-side workers or fetch. | A host-call bridge, or a stepwise design. Owner decision. |
| Ctrl-C and `COMMAND_TIMEOUT_MS` in the txiki path | The page's abort signal does not reach the engine. Only timeouts inside the program via `setTimeout` exist. | An engine-side abort event. |

## Process model: a deliberate deviation

The brief asked for the process list and signals to come from the txiki runtime own process and /proc access. The browser build of txiki does not provide them: `scripts/txiki/stubs.tsv` excludes `mod_process` (`tjs__mod_process_init`), and stubs `uv_os_getpid` and `uv_os_getppid` as having no host process information. There is no /proc in the page. So the process model is emulated inside `web/shell-core.js`: a table of jobs with PIDs, where the shell is PID 100 and jobs start at 101. Signals are delivered by aborting the job AbortController with a `Signalled` reason. This is the only model the browser can run. Confirm it in Phase B, and revisit only if the txiki build gains a process binding.

## Open decisions

- `scripts/vendor-pyodide.mjs`: kept for now. Its retirement is a Phase B decision. In Phase A the references in ARCHITECTURE.md and AGENTS.md to `web/vendor/pyodide/` and `scripts/vendor-pyodide.mjs`, and the checks in `scripts/lint-architecture.mjs`, are left unchanged. No build or witness calls `vendorPyodide` any more (6943688). In Phase B, once the build and witnesses run, decide whether to keep or retire the script, then update the docs and the lint in the same change.
- The owner has not yet confirmed the licence of the stripped Pyodide bundle.
