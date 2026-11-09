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

The Phase A table below is covered by these runs, except its rows that name a command not run here: the Pages build in pages.yml, and the `unpack` import check in `web/python-bundle.js`. The pip-lock row names the source the witness reads after 18403ed (see the vendor-pyodide section below). The Blocked section and the open decisions stay open. `scripts/vendor-pyodide.mjs` was retired in 18403ed.

Push gate: do not push the Phase A commits listed below before Phase B. `pages.yml` checks the wasm against the pin `a9812524...`, which is still the pinned build. The page now calls `tjs_browser_set_deadline` (5eafce5) and the shell program uses the `__thebirdBridge` native (this series), and the pinned wasm exports neither, so every engine-backed builtin fails until the wasm is rebuilt and the pin is moved.

## Phase A table (rows covered by the runs above)

| Commit | File | Group | Check needed |
| --- | --- | --- | --- |
| 6943688 | scripts/build-pages.mjs | Pages build | `node scripts/build-pages.mjs` completes without calling `vendorPyodide`, after `vendorBashkit` and the txiki wasm are in place. The pages.yml build job runs it. |
| 6943688 | scripts/witness.mjs | pip lock | Superseded by 18403ed: the witness reads the Pyodide 314.0.7 lock from `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json`, checks its SHA-256 `5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010`, then reads micropip from it. The Chromium witness passes the pip-refusal check against that lock. |
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

## Phase A: Ctrl-C on the txiki node path (code only, not built)

Where the abort was dropped, at 50edc12:

- `web/txiki-in-page.js:284` runs the whole program in `callInput(exports, exports.tjs_browser_eval, source)` with no abort check. The page signal is only read in `nextEvent` (listener at line 248), and the loop at line 285 is entered only when fetch controllers or events exist. A timer-only program never enters it, so the abort is never seen.
- `scripts/txiki/browser/entry.c:43` runs `uv_run(loop, UV_RUN_DEFAULT)` to the end of every timer, with no flag check.
- `scripts/txiki/browser/uv-browser.c:202` busy-waits for a timer (`while (now_ms() < until) {}`), so the main thread stays inside wasm and the Ctrl-C message cannot run until the timer fires.
- `web/node-in-txiki.js:62` reports status 130 as `node exited with status 130`, not as `cancelled`.

The bash side is intact: `web/pty-adapter.js:170` `client.cancel()`, then `web/shell-client.js` `cancel()`, then `web/shell-worker.js` `shell.cancel()`, then `web/bash-shell.js` `cancel()`, which calls `abort.abort()`. That signal is the one `nodeBuiltin` receives.

Changes:

- `scripts/txiki/browser/entry.c`: `pump` is one turn. It checks `cancel_requested`, drains jobs, runs `uv_run` with `UV_RUN_NOWAIT`, drains again, and returns 2 (`TJS_BROWSER_WAITING`) while timers are pending, 130 (`TJS_BROWSER_CANCELLED`) after a cancel, otherwise 0. New exports: `tjs_browser_cancel` and `tjs_browser_tick`. `tjs_browser_eval` clears the flag.
- `scripts/txiki/browser/uv-browser.c`: `tjs_browser_stop_timers` stops every pending timer when a run is cancelled.
- `web/txiki-in-page.js`: `runTjs` attaches the signal to `tjs_browser_cancel`, ticks while status is 2 with a 5 ms pause, and returns status 130 on a cancel. `TJS_CANCELLED` is exported. `tjs -e` throws `cancelled`.
- `web/node-in-txiki.js`: status 130 throws `cancelled`, so the shell reports `cancelled` and exit 130.
- `scripts/vendor-txiki.mjs`: `BROWSER_EXPORTS` adds `tjs_browser_tick` and `tjs_browser_cancel`, so the link keeps them and `REQUIRED_EXPORTS` checks them.
- Not changed in Phase A: the pin, and `web/vendor/txiki/tjs.wasm`. The local wasm predates these exports. With it, a timer-only run completes as before, but an abort raises a TypeError in the listener, because `tjs_browser_cancel` is missing. Phase B rebuilds the wasm and moves the pin.

Witness entry (Phase B, Chromium on the local relay and on the public site):

- Type `node -e "await new Promise((r) => setTimeout(r, 8000)); console.log('late')"` and press Enter.
- Press Ctrl-C two seconds later.
- Expected: `^C` is echoed at about 2 s; a line `cancelled` appears; the prompt returns about 1 s after Ctrl-C, well before the 8 s mark; `late` is never printed; `echo $?` then prints `130`.
- The run of this entry is recorded in this file with its output lines.

## Phase A: links on the txiki path (code only, not built)

The owner decided to implement symlinks. The txiki fs binding had no link operations, and the txiki shell had no `ln`, `readlink` or `test -L`. Changed:

- `scripts/txiki/browser/fs-browser.c`: host imports `tjs_fs_symlink`, `tjs_fs_readlink` and `tjs_fs_lstat`. The natives `__thebirdFs.symlink`, `.readlink` and `.lstat` are installed. `lstat` reports kind 3 for a link. `fs_stat` and `fs_lstat` share `stat_object`.
- `web/txiki-in-page.js`: the three host imports, over `web/shims/fs.js` (`symlinkSync`, `readlinkSync`, `lstatSync`).
- `web/shell-program.js`: the host adapter gains `lstat`, `readlink` and `symlink`. `remove` uses `lstat`, so a link is unlinked and never recursed into.
- `web/shell-core.js`: `ln -s [-f] TARGET [LINK]`, `readlink NAME`, `test -L` and `test -h`, `ls -l` arrows (`l SIZE NAME -> TARGET`), `rm` of a link leaves its target, and `ls` lists a dangling link. `ls` of a directory follows a link to it.
- `web/shell-in-txiki.js`: `flushFs()` after each run, so a link made by the txiki shell survives a reload. The terminal already flushes after each command in `web/shell-worker.js`.
- `scripts/witness-shell.mjs`: the Node host keeps a link table (`symlink`, `readlink`, `lstat`, and `follow` for every other operation). The group `links: ln -s, readlink, test -L, ls -l arrows, rm of a link, and links across a restart` covers it.

Witness, to run in Phase B:

- `npm run witness:shell`: the group prints these PASS lines: `links: ln -s creates a link and exits 0`, `links: readlink prints the target as stored`, `links: cat follows a link to its target`, `links: test -L is true for a link and false for its target`, `links: ls -l shows each link with an arrow to its target` (the exact stdout is `d 0 dir`, `l 3 dirlink -> dir`, `l 10 link.txt -> target.txt`, `- 6 target.txt`), `links: rm removes the link and leaves its target in place`, `links: a link survives a new shell over the same store`, and `links: rm of a link is still in effect after a restart, and the directory it pointed at is untouched`.
- Txiki path, in the browser through the page runner: `runShellInTxiki('cd notes && ln -s target.txt link.txt && readlink link.txt && test -L link.txt && echo yes', { cwd: '/workspace' })` must give stdout `target.txt\nyes\n`. After a page reload, `runShellInTxiki('cd notes && readlink link.txt && rm link.txt && (test -L link.txt || echo gone)', { cwd: '/workspace' })` must give `target.txt\ngone\n`. The browser check is not yet in `scripts/witness.mjs`; add it in Phase B with the rebuilt wasm.
- Terminal path (bashkit, unchanged): the existing witness checks `in-page ln -s makes a link that readlink reports, and a read and a stat follow it` and `in-page symlinks survive a browser restart, ls -l shows them, and rm removes only the link` still apply.
- Until Phase B rebuilds `tjs.wasm`: `shell-program.js` calls `__thebirdFs.lstat`, which the current wasm does not export. Every txiki shell run fails with a missing-function error until the rebuild. That is expected for this pass and is fixed by the Phase B build.

## Phase A: Pyodide vendor script retired (18403ed, not built)

The owner decision was to retire `scripts/vendor-pyodide.mjs` and the vendored Pyodide tree. Changed in one commit:

- `scripts/vendor-pyodide.mjs`: deleted. Its `.gitignore` line is removed.
- `scripts/witness.mjs`: the micropip check reads the pinned lock URL above and checks its SHA-256 before it reads micropip.
- `scripts/lint-architecture.mjs`: a `pyodideNotVendored` record replaces the vendored-tree checks.
- `ARCHITECTURE.md`, `AGENTS.md`, `README.md` (the fresh-clone step now runs only `vendor-bashkit`), and `web/vendor/PYODIDE-NOTICE.md`: rewritten to match.
- The local directory `web/vendor/pyodide/` is untracked and stale. It was left in place, not deleted.

Witness, to run in Phase B: `npm run lint:architecture` passes the `pyodideNotVendored` record; `npm run witness` passes the micropip check against the pinned lock.

## Phase A: interrupt handler for synchronous loops (5eafce5, not built)

A loop with no `await` never returns to the page, so the cancel flag cannot be set during it. The engine now installs a JS interrupt handler (`JS_SetInterruptHandler` in `scripts/txiki/browser/entry.c`). It stops the running job when the cancel flag is set or the deadline has passed. A stop reports 130 (cancelled) or 124 (timed out), and the pump stops the timers.

- The page sets the deadline per run with `tjs_browser_set_deadline` (a new export, in `BROWSER_EXPORTS`). `runTjs` takes `timeoutMs`. `bash-shell.js` passes `COMMAND_TIMEOUT_MS` (300000) to `tjs`, `node` and `qjs`. `runShellInTxiki` forwards its `timeoutMs`.
- `tjs`, `node` and `qjs` map 124 to `timeout: command timed out`. `tjs`, `node` and `qjs` map 130 to `cancelled`. `qjs` previously reported a cancel as an empty error. `tjs` now takes the abort signal too.
- `shell-in-txiki.js` and `qjs-in-txiki.js` pass the timeout and signal through.

Witness, to run in Phase B (`npm run witness`, the block after the txiki shell check): `runTjs('while (true) {}', ..., { timeoutMs: 1000 })` returns status 124 with no `Uncaught` line in under 5 s; `runTjs('setTimeout(() => {}, 60000);', ..., { timeoutMs: 1000 })` returns 124 in under 5 s; an abort at 500 ms on a waiting run returns 130 in under 5 s; `tjsBuiltin` and `qjsBuiltin` on `while (true) {}` throw `timeout: command timed out`. The four checks are in `scripts/witness.mjs`.

Limit, superseded by 140e437: a Ctrl-C could not reach a loop that never yields, because the engine ran inside the shell worker. The cancel word (140e437) closes that on an isolated page; the Pages site has no isolation, so the restart path applies there. See the Ctrl-C section below and the Blocked section.

## Phase A: Ctrl-C reaches a loop that never yields (140e437, not built)

- `scripts/txiki/browser/entry.c`: the interrupt handler and the per-turn check read `tjs_cancel_requested` (a new host import) as well as the page's cancel. A loop with no await stops inside the job and the run returns 130.
- `web/txiki-in-page.js`: `setCancelWord` and `clearCancel` manage a shared `Int32Array` over a `SharedArrayBuffer`. `tjs_cancel_requested` reads it.
- `web/shell-client.js`: on an isolated page (`crossOriginIsolated`) the client creates the shared word and sets it on Ctrl-C at once. On any page it arms a 1.5 s grace after a cancel of a running command. If the run has not answered by then, the client terminates the worker, rejects the other pending calls, resolves the run with `cancelled` and status 130, and starts a new worker. The new worker runs `(exit 130)` so the next prompt's `$?` is 130. The directory and variables do not carry over.
- `web/shell-worker.js`: takes the word from its `init` message and clears it before each run.

Witness, to run in Phase B (`scripts/witness.mjs`, after the txiki shell check):

- `node -e "while (true) {}"` in `loop-check`, Ctrl-C after 1.5 s: the output has `^C` and a `cancelled` line, `echo status=$?` prints `status=130`, and the cancel took under 10 s.
- The same run on an isolated page: the `pwd` after the cancel is `/workspace/loop-check`. On a page that is not isolated the check expects `/workspace`, which is the restart. The check is conditional on `self.crossOriginIsolated`.
- Phase B runs the first on the local relay (isolated) and the second on the built site (not isolated).

## Phase A: engine instance pool (acc03f4, not built)

`web/txiki-in-page.js` now takes an engine instance from a pool for each `runTjs` call and returns it at the end. Each instance keeps its own cwd, stdio buffers, bridge session and memory. The compiled module is shared. Before this, `cwd`, `session` and the stdio buffers were module-level, so a builtin that started a second engine run reset the outer run's directory and output. The pool removes that. The Phase B rebuild also needs `tjs_cancel_requested` and `tjs_browser_set_deadline` in the wasm.

## Phase A: every builtin through the bridge (6eed9b4, not built)

`web/builtins.js` (`BUILTIN_NAMES`, `runBuiltin`) is the one dispatch for the nine builtins. `web/bash-shell.js` builds its custom builtins from it. `web/shell-in-txiki.js` passes `runBuiltin` as the bridge's `builtin` option with the run's timeout. The txiki shell no longer refuses any builtin.

## Phase A: licence (ab32804)

`package.json` has no `license` field: thebird is unlicensed by owner decision. No LICENSE file was added for thebird's own code. The vendored notices stay (`web/vendor/brotli/`, `web/vendor/tte-js/` with its LICENSE and LICENSES folder, `web/vendor/xterm/`, `web/vendor/acorn.mjs` with `ACORN-LICENSE`, `web/vendor/isomorphic-git.mjs` with `ISOMORPHIC-GIT-LICENSE`). The Pyodide bundle licence stays deferred, as before.

## Phase A: host-call bridge for builtins on the txiki path (not built)

Before this change the txiki shell could not run an external builtin at all: `shell-core.js` knew the names for `which` and `type` but had no way to call them. The engine now posts a request with `__thebirdBridge.send` (a native in `scripts/txiki/browser/fs-browser.c`, installed by `tjs_browser_bridge_install`). The page's `tjs_bridge_send` takes `op: 'builtin'` and runs the builtin through the `builtin` option of `runTjs`. The result comes back as an event of kind `bridge` through `tjs_browser_resume`. `scripts/txiki/browser/http-client.js` routes it to `__thebirdBridge.onResult` before the HTTP client lookup. The run stays alive while a bridged call is pending. A run's abort reaches each pending call.

How each builtin is served:

| Builtin | Served by | On the txiki shell | Why |
| --- | --- | --- | --- |
| `python3` | Page: the Pyodide worker, bridged | Served through the bridge | The worker is separate from the engine. |
| `pip` | Page: the Pyodide worker, bridged | Served through the bridge | As `python3`. |
| `git` | Page: its own txiki run, on its own engine instance | Served through the bridge | Each run takes an instance from the pool (see the pool section), so a nested run does not free the outer one. |
| `sqlite3` | Page: its own txiki run, on its own instance | Served through the bridge | As `git`. |
| `curl`, `wget` | Page: their own txiki run, on its own instance | Served through the bridge | As `git`. |
| `qjs`, `tjs`, `node` | Page: their own txiki run, on its own instance | Served through the bridge | As `git`. |

The refusal was removed in 6eed9b4: `web/builtins.js` is now the one dispatch, and the txiki shell calls it for all nine names. The bash page calls the same dispatch. `which`, `command -v` and `type` answer the same for all nine names in both paths.

Witness, to run in Phase B (through `runShellInTxiki`, with the rebuilt wasm):

- `python3 -c "print(1+2)"`: stdout `3\n`, exit 0.
- `python3 -c "import time; time.sleep(30)"` with an abort at 500 ms: rejects with `status 130`, in under 5 s.
- `pip install six` (needs network to PyPI): exit 0.
- `runShellInTxiki('git init nest-check >/dev/null && echo git-ok && node -e "console.log(2 + 2)" && qjs -e "1 + 2" && python3 -c "print(7 * 6)" && echo done')`: stdout `git-ok\n4\n3\n42\ndone\n`, exit 0. This is the witness entry in `scripts/witness.mjs` (commit d5e3cf5).
- `sqlite3 x.db "select 1"` inside the txiki shell: stdout `1\n`, exit 0. `curl http://127.0.0.1:1/` inside the txiki shell: a stderr line from the page, a non-zero exit, and the next command still runs.

## Blocked (not coded, named blocker)

| Group | Blocker | What it needs |
| --- | --- | --- |
| Ctrl-C on the Pages site (not cross-origin isolated) while a loop never yields (`node -e "while (true) {}"`) | No shared cancel word exists without cross-origin isolation, so the engine cannot see the Ctrl-C. The client replaces the shell worker after 1.5 s (commit 140e437): the command reports `cancelled` with 130, but the shell's directory and variables are lost. | Owner decision: accept the restart on Pages, or serve the site with cross-origin isolation (a service worker that adds the headers), which the owner has not chosen. |

## Process model: a deliberate deviation

The brief asked for the process list and signals to come from the txiki runtime own process and /proc access. The browser build of txiki does not provide them: `scripts/txiki/stubs.tsv` excludes `mod_process` (`tjs__mod_process_init`), and stubs `uv_os_getpid` and `uv_os_getppid` as having no host process information. There is no /proc in the page. So the process model is emulated inside `web/shell-core.js`: a table of jobs with PIDs, where the shell is PID 100 and jobs start at 101. Signals are delivered by aborting the job AbortController with a `Signalled` reason. This is the only model the browser can run. Confirm it in Phase B, and revisit only if the txiki build gains a process binding.

## Phase A: pip, boot splash, bundle and wget (74e0b7d, 43258cb, f7cdc6c, 482c0fd, f825d17, 6131631, not built)

Each row names the file, the place in it, and the witness that must pass in Phase B. The witness names are the `check(...)` labels in `scripts/witness.mjs`.

| Commit | File | Row | Witness |
| --- | --- | --- | --- |
| 74e0b7d | web/python-worker.js | `ensureMicropip` (memoised, reset on failure) and the `version` handler, which reads micropip's version from `importlib.metadata` | `pip --version and pip -V print the micropip version the page loads` |
| 74e0b7d | web/python-worker.js | `install` calls `ensureMicropip` before it installs | `in-page pip installs a pure package from PyPI, and python3 imports it in the same page` |
| 74e0b7d | web/python-in-page.js | `PIP_USAGE`, `UsageError` (`exitCode = 2`), and the `pipBuiltin` branches for no verb, `--help`/`-h`/`help`, `--version`/`-V`, an unknown verb, and `install` with no names | `pip --help prints usage and exits 0`; `bare pip, an unknown pip command and pip install with no names exit 2 with a message`; `a bare pip prints its usage to stderr only, and exits 2`; `pip --help prints its usage to stdout, so it survives 2>/dev/null` |
| 74e0b7d, f825d17 | web/python-in-page.js | `pipBuiltin` names check: a bad name throws `UsageError`; the empty-install message is worded as an instruction | `in-page pip refuses version specifiers, Pyodide-bundled packages and unknown names with a message and no URL` |
| 74e0b7d | web/bash-shell.js | `builtinExit`: a builtin's `err.exitCode` becomes `$?` (the custom-builtin wrapper records it, and `run` applies it) | `bare pip, an unknown pip command and pip install with no names exit 2 with a message` (the `bare-rc=2`, `unknown-rc=2`, `install-rc=2` values) |
| 74e0b7d | web/txiki-in-page.js | `startBuiltin` settles a builtin error with `code: err?.exitCode ?? 1` (a cancelled builtin is 130) | No witness yet covers a pip usage error through the txiki shell. The pip rows above run in the page shell. Phase B must add a txiki-shell check of `pip frobnicate` (exit 2) or record it as not covered. |
| 43258cb | web/splash.js | `loading(text = LOADING)`: the text reaches the effect and the plain fallback | `the boot splash is a tte-js effect on a canvas, and the loading text is never printed to the terminal` |
| 43258cb | web/terminal.js | `splash.loading('loading the shell')` replaces the `pty.writeOutput('loading the shell\n')` line; `splash.done()` after `client.ready`; `splash.failed` in the catch | `the boot splash is hidden once the engine is ready`; `the cold python3 call shows the tte-js splash while the bundle loads, then hides it` |
| 43258cb | scripts/witness.mjs | the `loading the shell` filter is removed from the terminal-line comparison (its line was 191) | `the boot splash is a tte-js effect on a canvas, and the loading text is never printed to the terminal` |
| f7cdc6c | web/curl-in-page.js | `if (opts.output === '/dev/null') return '';` before the file write | `wget -O /dev/null fetches from a CORS host and discards the body without an error` |
| 482c0fd | scripts/build-pages.mjs | `build` from esbuild bundles `_site/web/terminal.js` into `_site/web/terminal.bundle.js` (`esm`, `es2022`), and `_site/index.html` is rewritten to load the bundle | `the built page loads one bundled script that has no relative module imports, and runs` |
| 482c0fd | package.json, package-lock.json | `esbuild` `0.28.2` as an exact devDependency, with its lockfile | `node scripts/build-pages.mjs` completes (Phase B); the bundle check above |
| 482c0fd | .github/workflows/pages.yml | `npm ci` before `node scripts/build-pages.mjs` in the build job; no witness is added to CI | `npm ci` installs the pinned esbuild in the Pages build (Phase B) |
| 6131631 | scripts/witness.mjs | the pip CLI block, the quiet and stdout `--help` checks, the splash probe, the bundle check and the `wget -O /dev/null` run in the `fetched` list | the checks named in the rows above; `devnull-wget-ok` |

Also in Phase A: `web/terminal.html` still loads `web/terminal.js` for the dev relay. Only the built `_site/index.html` loads the bundle.

Phase B must also confirm that `web/python-in-page.js` line 35 (`new URL('./python-worker.js', import.meta.url)`) still resolves in the bundle. The worker is a separate file in `_site/web/`, so the bundle does not move it.

Open defect, found in the local Chromium witness run (117 PASS, 1 FAIL, `WITNESS-EXIT 1`) and not fixed here: the python warm-call timing check (178 ms over 30 calls against a 5 ms budget). Measured cause: each call walks the workspace on both sides (`shimPaths` and `outbound` in `web/python-in-page.js`, `workspaceTree` and `collect` in `web/python-worker.js`). An empty workspace costs 3.4 ms, 300 files cost 9.6–13.3 ms, the page walk 1.7 ms, and the worker reads every file on each call. The fix path is a change journal (the page records writes and the worker keeps a revision per file), so a warm call touches only changed paths. The threshold is not moved.

## Phase A: fixes found by the first Phase B run (uncommitted until this pass, not built, witness not run)

Found while the Phase B public-site checks and the local Chromium witness ran. Each row is one commit.

| Commit | File | Row | Witness |
| --- | --- | --- | --- |
| fix(shell) | web/bash-shell.js | `builtinStatus` replaces `builtinExit`: a failed builtin records 130 for cancelled, else `err.exitCode ?? 1`. The end-of-run override is removed; only the cancel override stays. A `thebird_status` custom builtin returns the recorded value. | `bare pip, an unknown pip command and pip install with no names exit 2 with a message` (`bare-rc=2`, `unknown-rc=2`, `install-rc=2`); `Ctrl-C stops a node loop that never yields` (`status=130`). |
| fix(shell) | web/shell-lookup.js | `lookupPrologue` adds one function per in-page builtin: `NAME() { command NAME "$@" || return "$(thebird_status)"; }`. A function sets `$?` inside a line, which the old end-of-run override could not. `which`, `command -v` and `type` still answer by name (`type pip` = `pip is a shell builtin`). | The same pip rows; `a bare pip prints its usage to stderr only, and exits 2` (`quiet-rc=2`). |
| fix(pip) | web/python-in-page.js | `pipBuiltin` messages no longer repeat `pip:`, because bashkit adds the command name to stderr: `unknown command 'NAME'`, `install needs at least one package name`, and `NAME is not a package name (...)`. | `bare pip, an unknown pip command and pip install with no names exit 2 with a message`, which expects `pip: install needs at least one package name` (scripts/witness.mjs line 729 was changed to match). |
| fix(pip) | web/txiki-in-page.js | `startBuiltin` prefixes a builtin's error text with `message.name`, as bashkit does on the page shell. The no-bridge error drops its own prefix. | No witness yet covers a pip usage error through the txiki shell. Phase B must add `runShellInTxiki('pip frobnicate; echo rc=$?')` (stderr `pip: unknown command 'frobnicate'`, `rc=2`) or record it as not covered. |
| fix(shell) | web/shell-client.js | `request` and `replaceWorker` post only after the worker's `ready` message (`online` promise). The init and the `(exit 130)` reset go out after ready, in order. | `Ctrl-C stops a node loop that never yields` and `after Ctrl-C on a cross-origin isolated page the shell keeps its directory` type straight after the cancel, so they exercise this. Phase B must read their output. |
| fix(shell) | web/shell-worker.js | Run messages go through a queue (`queue = queue.then(() => answer(data))`). `init`, `cancel` and `resize` are handled at once, so a cancel still reaches a running command. | As the row above. A second run posted while the first runs (the reset run, then a user command) no longer overlaps on one bashkit instance. |

Observed before this pass, not a witness result for these commits: on the built site without COOP/COEP (non-isolated), `pip --version` printed `pip 0.11.1 (micropip, in-page)`; bare `pip`, `pip frobnicate` and `pip install` with no names exit 2 after the fix (`bare-rc=2`, `unknown-rc=2`, `install-rc=2`); after Ctrl-C of `node -e "while (true) {}"` the shell printed `cancelled`, and the next command ran in 609 ms with `status=130` in `/workspace`. Before the client fix, a command typed in the restart window never ran. `runTjs` with `timeoutMs: 1000` returned 124 for a busy loop and for a pending timer, and 0 for a normal run. The local Chromium witness with these fixes stopped at 105 PASS and 0 FAIL, with no summary line, when its process ended; it must be run again in Phase B.

Known in this set: `thebird_status` is a bashkit builtin, so it shows in `compgen -c` and `command -v thebird_status`. Nothing else depends on it.

## Phase B run 3: restart persistence and the command limit (final tree, not pushed until the witness is green)

| Change | File | Cause and evidence | Witness |
| --- | --- | --- | --- |
| Files loaded from OPFS get a revision when the tree is hydrated | web/shims/fs.js (`loadTree`) | After a reload nothing had a revision, so the python journal (`changedSince(0)`) never sent those files to a new worker. `cat` read them, and python raised `FileNotFoundError`. The witness run before this fix failed `in-page python3 files survive a browser restart`. | `in-page python3 files survive a browser restart — PY-HELLO / PY-HELLO` (the python process reads the file after the reload) |
| `COMMAND_TIMEOUT_MS` 300000 to 600000 | web/bash-shell.js, web/shell-core.js, scripts/witness.mjs (expiry check now twelve 55 s sleeps, `tick10` in and `tick11` out), scripts/witness-shell.mjs, scripts/lint-architecture.mjs, ARCHITECTURE.md, AGENTS.md, README.md | Cause: the first cold `python3` call on this link idles at about 290 s (5 MB bundle at about 80 KB/s, then Pyodide start and the micropip wheel). With the 300 s limit the first `pip --version` was cut: `error: resource limit exceeded: execution timeout (300s)`. bashkit's `execute()` ignores a per-call `timeoutMs` (probe: a constructor limit of 2 s cut `sleep 5` although the call asked for 10 s), so the limit cannot apply to the cold call alone. 600 s is about twice the measured load. | `timeout: the production limit is 600000 ms`; `a command past 600 s is cut at the limit with the expiry message`; `in-page pip installs a pure package from PyPI, and python3 imports it in the same page` |

Pip on the warm page, built site (`_site`, served without COOP/COEP), typed into the page's terminal after a cold `python3 -c "print(1)"` that finished inside the limit. Each command wrote its stdout and stderr to files and echoed the exit code:

```
thebird /workspace> pip --version: rc=0 / OUT: pip 0.11.1 (micropip, in-page) / ERR: (empty)
thebird /workspace> pip -V:        rc=0 / OUT: pip 0.11.1 (micropip, in-page) / ERR: (empty)
thebird /workspace> pip --help:    rc=0 / OUT: usage: pip install <package>... / pip --version / pip --help / ERR: (empty)
thebird /workspace> pip:           rc=2 / OUT: (empty) / ERR: pip: usage: pip install <package>... / pip --version / pip --help
```

Architecture lint, run alone: `258 claims: 258 pass, 0 fail, 0 unverified; 39 prose lines with NO_CLAIM`, exit 0. The hang recorded earlier printed nothing for more than fifteen minutes. Its cause is set out in Phase B run 4 (driver group kill, relay keep-alive close, streamed claims, live check in its own bounded process).

Full witness on this tree (`CHROME_BIN=/usr/bin/chromium npm run witness`): 134 PASS, 0 FAIL, `WITNESS-EXIT=0`, including the restart check, the 600 s expiry check and the pip rows. `npm run witness:shell`: 108 PASS, 0 FAIL. `npm run check`, `npm run lint:comments` (0 comments) and `node scripts/build-pages.mjs` pass.

## Phase B run 4: lint hang cause, command limit, restart checks through playwriter (final tree)

### Architecture lint hang: cause established

The lint printed nothing until its end and ran its live check (headless Chromium) in the same process, so an earlier hang left no step in its log. The mechanism below was reproduced one step at a time.

1. The driver's Chromium wrapper (`/usr/bin/chromium`, a bash script) was killed with SIGKILL, so `chromium.real` survived as an orphan with PPID 1. HEAD left 10 processes after a run; the fixed driver leaves 0 (group kill).
2. `relay.close()` called `server.close()` without closing keep-alive sockets. With a half-sent request in flight, HEAD's close took 10002 ms; the fixed close (`closeAllConnections()` then `close()`) took 1 ms.
3. Lint reproduction with a delayed wasm response and a 20 s limit, HEAD: `live: closing relay` at 04:12:47.5 and `live: relay closed` at 04:14:39.1, 112 s, waiting on the orphan's in-flight wasm request. It would not return if that response never completed. Fixed driver and relay: `live: closing relay` at 04:15:16.336, `live: relay closed` at 04:15:16.337. Repeated twice, clean, no orphan.
4. An unbounded `once(child, 'exit')` after a signal exit hung 8000 ms in a test. The fixed branch skips the wait when `signalCode` is set.

Caveat: the earlier hang was not logged step by step, so the exact step that waited in that run is not observed directly. Its conditions (a parallel run, shutdown with live Chromium) match steps 1 to 3, and each step is reproduced on its own.

### Fixes for the hang

| File | Change |
| --- | --- |
| scripts/browser-driver.mjs | `runTerminal` takes `onProgress`; the browser is spawned with `detached: true`; `finally` kills the whole process group (`killGroup`) and waits at most 10 s for exit unless a signal already ended it. Every CDP call is bounded by `withTimeout` at 60 s. |
| src/relay.js | `close()` calls `server.closeAllConnections()` before `server.close()`. |
| scripts/lint-architecture.mjs | Each claim is streamed as it starts and ends (`add`). The live check runs in its own process, `scripts/lint-live.mjs`, bounded by `LIVE_TIMEOUT_MS = 900000`. On timeout the child is killed and the last streamed line is reported. |
| scripts/lint-live.mjs (new) | The live probes. Streams `live probe <id> started` and `finished`, `live: closing relay`, `live: relay closed`, then prints `LIVE-RESULT <json>`. |

### Command limit: 900 s

`COMMAND_TIMEOUT_MS` is 900000 in `web/bash-shell.js` and `web/shell-core.js`. Evidence: the architecture lint's cold `python3 -c` probe, run beside the witness, was cut at `error: resource limit exceeded: execution timeout (600s)` (03:42:04 to 03:52:04). The same cold call took 210 s run alone and 546 s beside the witness. 900 s is about 1.5 times the slowest measured cold call. The witness expiry check runs seventeen 55 s ticks, expects `execution timeout (900s)`, `tick16` present and `tick17` absent, in a 1500000 ms terminal wait.

### Browser restart checks, through playwriter (invariant 11)

Setup ran in the profile's default context, `context.browser().contexts()[0]` of this project's browser (profile `/workspace/thebird/.playwriter/browser-profile`). Each command printed its marker:

```
thebird /workspace> mkdir -p notes/links && echo restart-ok > notes/a.txt && echo S1-OK
S1-OK
thebird /workspace> echo link-target > notes/links/target.txt && ln -s target.txt notes/links/alias.txt && echo S2-OK
S2-OK
thebird /workspace> sqlite3 notes/restart.db "create table t(x); insert into t values (1),(2),(3)" && echo S3-OK
S3-OK
thebird /workspace> python3 -c "open('notes/pyr.txt','w').write('py-ok')" && echo S4-OK
S4-OK
```

Then `gm.browser_close_machine({ confirm: true })` closed this project's browser (pid 41276), and jayzee's browser (pid 12638) kept running. After the reopen, the default context was listed again and the four checks ran in it:

```
R1-BEGIN
restart-ok
R1-END
R2-BEGIN
target.txt
link-target
lrw-r--r--        0 2026-11-09 04:28 alias.txt -> target.txt
-rw-r--r--        0 2026-11-09 04:28 target.txt
R2-END
R3-BEGIN
3
R3-END
R4-BEGIN
py-ok
R4-END
```

| Check | Result |
| --- | --- |
| R1 OPFS file survives the restart | PASS: `restart-ok` |
| R2 symlink survives the restart | PASS: `readlink` gives `target.txt`, `cat` gives `link-target`, `ls -l` shows `alias.txt -> target.txt` |
| R3 sqlite3 database survives the restart | PASS: `select count(*) from t` gives `3` |
| R4 python3 file survives the restart | PASS: `py-ok` |

A first attempt in the run's own context failed: `cat: notes/a.txt: ENOENT` (R1), `sqlite3: Uncaught Error: unable to open database file` (R3), and R2 printed nothing. That was a fault in the test path, not in the app. A probe showed that the run context's OPFS root held `thebird-workspace` while the profile's default context's root was empty for the same origin, so a run context's storage is separate from the profile's and does not survive the browser close. The restart checks must use `contexts()[0]`.

Repeated on the final tree in a later session (gm run `2026-11-09-04-49-57-7fa949`): setup in the default context of the browser pid 103980, `browser_close_machine({confirm: true})` closed only that pid (the witness browser on `/tmp/thebird-profile-hPmCXI` kept running), and the checks ran in the relaunched browser pid 104720 on the same profile:

| Check | Result |
| --- | --- |
| R1 OPFS file | PASS: `restart-ok-run2` |
| R2 symlink | PASS: `readlink` and `cat` give `target.txt` and `link-target-run2`; `ls -l` shows `alias.txt -> target.txt` |
| R3 sqlite3 table | PASS: `select count(*) from t` gives `3` |
| R4 python3 file | PASS: `py-ok-run2` |

Run `2026-11-09-04-48-59-ff0fa0` was partial: the relaunched browser listed no default context to that run, so it ran no check. Its witness says so. Two steps later the checks above ran in the new run.

### Browser checks: what moved and what did not

- The four restart checks run through playwriter, in the profile's default context. Their results are above.
- The node witness (`scripts/witness.mjs`) keeps its other browser checks on CDP through `scripts/browser-driver.mjs`. The blocker: playwriter verbs are reachable only as gm verbs inside a gm `run_code` body, not from a node process. The failing call, from inside a run: `gm.browser_close_machine({})` returned `browser_close_machine needs confirm true: it closes the whole project browser, with every run's tabs in it`.

### Phase B run 4 totals (final tree, witness and lint run to a clean end)

| Command | Result |
| --- | --- |
| `npm run check` | exit 0 |
| `npm run lint:comments` | 69 repo-owned files checked: 0 comments; exit 0 |
| `npm run witness:shell` | `RESULT PASS=108 FAIL=0`, exit 0 |
| `CHROME_BIN=/usr/bin/chromium npm run witness` (log `/tmp/p14-witness.log`) | 134 PASS, 0 FAIL, `WITNESS-EXIT=0` |
| `npm run lint:architecture` run alone (log `/tmp/p14-lint.log`) | `259 claims: 259 pass, 0 fail, 0 unverified; 39 prose lines with NO_CLAIM`, `LINT-EXIT=0`; the cold `python-c` live probe finished in 45 s, and `live: closing relay` and `live: relay closed` followed |

The first witness and lint runs of this pass were stopped with the previous session and were not counted. Both were run again from the start.

### Process note

Two node processes on this machine are not from this session and were not stopped: `node bin/thebird-relay.js --port 8877` (pid 3051450) and `node scripts/groundy-replay-witness.mjs` (pid 54546).

## Phase A: licence removal (chore(license), not built, not run, not witnessed)

Each row is one change in this pass. Phase B is the run that checks them.

| File | Row | Check that must pass in Phase B |
| --- | --- | --- |
| web/vendor/ACORN-LICENSE, web/vendor/ISOMORPHIC-GIT-LICENSE | deleted (`git rm`) | `npm run lint:comments` lists `acorn.mjs` and `isomorphic-git.mjs` as VENDORED with the upstream named, and no tracked file is a licence or notice file |
| web/vendor/PYODIDE-NOTICE.md | deleted (`git rm`); its open question is recorded under Open decisions | same lint run |
| web/vendor/xterm/XTERM-LICENSE, FIT-LICENSE, WEBGL-LICENSE, UNICODE11-LICENSE | deleted (`git rm`) | same lint run; `xterm.mjs`, `xterm.css`, `addon-fit.mjs`, `addon-webgl.mjs`, `addon-unicode11.mjs` report VENDORED |
| web/vendor/brotli/LICENSE-MIT.txt, LICENSE-Apache.txt | deleted (`git rm`) | same lint run |
| web/vendor/tte-js/LICENSE, LICENSES/terminaltexteffects-MIT.txt, LICENSES/ttfx-MIT.txt, LICENSES/ttfx-NOTICE.txt, THIRD_PARTY_NOTICES.md | deleted (`git rm`) | same lint run; `git ls-files | grep -i 'licen\|notice'` prints nothing |
| scripts/lint-comments.mjs | `NO_COMMENT_SYNTAX` drops `LICENSE\|NOTICE`; `MIT_GRANT` and the licence paths are removed; `PROVENANCE` maps a vendored file to its upstream name; `provenanceProblem` checks only that the upstream name appears in the file; the VENDORED line reads `upstream <name> named (third-party, not edited)`; the unused `existsSync` import is removed | `npm run lint:comments` exits 0 and prints `69 repo-owned files checked: 0 comments` |
| scripts/witness.mjs (line 835) | the provenance check is now `every vendored bundle with comments has a provenance witness (upstream name)` and matches `named (third-party, not edited)` | not in the Phase B list; the next full witness run covers it. Until then this row is recorded as not run. |
| AGENTS.md (vendored section) | the acorn and isomorphic-git bullet and the xterm bullet name no licence files and no MIT; the unicode11 SHA-256 for its licence file is removed; the Pyodide bundle bullet no longer states the licence sentence | docs only; `npm run lint:architecture` (not in the Phase B list) would check cited claims, and it is run in Phase B |
| DESIGN.md (line 15) | "committed with their licence files" becomes "committed unmodified" | docs only |
| ARCHITECTURE.md (lines 105, 106, 108, 114) | the bundle lines name no licence file; the Pyodide notice sentence is removed; the brotli and tte-js licence names and the MIT label are removed; the lint-comments line reads "when their upstream is recorded" | docs only |
| package.json | no `license` field (removed earlier in ab32804); no change in this pass | `npm run check` |
| package-lock.json | the root package has no `license` field; the `"license": "MIT"` lines are the upstream dependency fields and are left alone | none |
| README.md | no licence mention; no change | none |
| web/vendor/pyodide/ | untracked, not added | `git status` shows it untracked |

Effect on the MIT notice: MIT asks that the copyright notice and permission notice travel with copies of the software or substantial portions of it. Deleting the MIT texts from `web/vendor` removes the copies of those notices from this repository, and the repository has no top-level LICENSE file. The owner has asked for the removal, so it is done. The owner needs to decide whether the notices go back in another form before the next release.

### Phase B results for the licence removal (on 049b7b3)

| Command | Result |
| --- | --- |
| `npm run check` | exit 0 |
| `npm run lint:comments` | `VENDORED` for `acorn.mjs` (993 comments kept), `isomorphic-git.mjs`, `xterm/addon-fit.mjs`, `addon-unicode11.mjs`, `addon-webgl.mjs`, `xterm.css`, `xterm.mjs`, each with `upstream <name> named (third-party, not edited)`; `70 repo-owned files checked: 0 comments; 85 tracked files, 7 vendored files with comments`; exit 0. The count is 70 because `scripts/lint-live.mjs` is tracked now. |
| `npm run witness:shell` | `RESULT PASS=108 FAIL=0`, exit 0 |
| `npm run lint:architecture` | `255 claims: 255 pass, 0 fail, 0 unverified; 39 prose lines with NO_CLAIM`, `ARCH-EXIT=0`. The count was 259 before this pass. The four claims that went were on the sentences that named licence files and were reworded to drop them; the rest pass. |
| The `scripts/witness.mjs` line 835 predicate, run over the real `lint:comments` output | `true` (7 VENDORED lines, each with `named (third-party, not edited)`, no FAIL). The full witness was not run in this pass. |

No defect surfaced in Phase B, so none was fixed. Nothing was pushed in Phase A.

## Open decisions

- `scripts/vendor-pyodide.mjs`: retired in 18403ed, with its references in ARCHITECTURE.md, AGENTS.md, README.md and `scripts/lint-architecture.mjs` changed in the same commit. The stale local directory `web/vendor/pyodide/` is untracked and was not deleted; remove it by hand when convenient.
- Pyodide bundle licence: held by the owner, and not confirmed. The stripped bundle at `https://anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br` is not changed by this pass. The licence notice file `web/vendor/PYODIDE-NOTICE.md` was removed in the licence removal above, so this question is recorded only here.
- Licence notices for the vendored bundles: removed in the licence removal above. Whether they return in another form is the owner's decision.
