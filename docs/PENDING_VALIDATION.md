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
- The local directory `web/vendor/pyodide/` was untracked and stale. It was left in place here, and removed later (see the queue pass entry below, which records the removal).

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

## Phase A: queue pass (python journal, sqlite witness, pip row, stale pyodide directory)

| Commit | File | Row | Witness that must pass in Phase B |
| --- | --- | --- | --- |
| 547b55d | web/python-worker.js | Change journal. The worker installs a `sys.addaudithook` once per runtime (`JOURNAL`). It records the absolute path of every workspace file Python opens for writing (`open` with a write mode or write flags), removes or renames (`os.remove`, `os.rmdir`, `os.rename`, `os.replace`), and `sqlite3.connect`. `drainJournal` returns and clears the record before and after each run. `collect` stats and reads only those paths, so the full `scanStats` walk and `signature` are gone. `reconcile` takes `put`, `drops` and `keep`: `keep` is sent only on a full resync, and `lastCollect` is removed. | `python3 warm calls are timed in-page over 300 files and average under 5 ms`; `in-page python3 sees a shell rewrite made after its last call`; `in-page python3 removes a file it deletes and the shell sees it gone`; `in-page python3 files survive a browser restart` |
| 547b55d | web/python-in-page.js | `outbound` walks only the page's changed paths (`fs.changedSince(synced)`), where `isFile` is `lstatSync(...).isFile()` so a link never syncs as a copy. A changed path that is no longer a file becomes a `drops` entry. A full resync (`synced === 0`) sends the workspace list as `keep`. `runPython` sends `put`, `drops` and `keep`; the `paths` argument is gone. | the same rows as above; the sqlite row below |
| 28da1ec | scripts/witness.mjs | Incremental block: a `python3` run creates `notes/inc.db` with sqlite3 and the shell reads its row. The check `in-page python3 writes a sqlite3 database through the write journal, and the shell reads its row` expects the output line `5`. This guards the one write the audit hook sees only through `sqlite3.connect`. | `in-page python3 writes a sqlite3 database through the write journal, and the shell reads its row` |
| (unchanged at HEAD) | scripts/witness.mjs, txiki block | The txiki-shell `pip frobnicate` check from the earlier row is already in the witness: `the txiki shell names an unknown pip command on stderr and exits 2`, with `rc=2` and `pip: unknown command 'frobnicate'`. No change in this pass. | `the txiki shell names an unknown pip command on stderr and exits 2` |
| (untracked, deleted) | web/vendor/pyodide/ | Removed with `rm -rf`. Checked first: nothing in code, scripts, workflows or the build references the directory (the only hits are the lint's `.gitignore` string check, which does not read it, and historical notes in this file). Its `pyodide-lock.json` is version 2.4.0, not the pinned 314.0.7 core. `scripts/build-pages.mjs` copies all of `web/` into `_site`, so a local build would have shipped it. It was untracked and not ignored. | `git status` no longer lists it; `npm run check` |

Known limit of the journal: a write that reaches the Emscripten file system without a Python audit event (a C extension writing a file directly, other than through `sqlite3`) is not journaled. It reaches the page only when the page changes that path. Python's `open`, `os` and `shutil` writes are covered by the audit events.

Phase B must also confirm the warm-call figure. The 178 ms over 30 calls recorded above was measured before this change, and the 5 ms budget is unchanged.

Scope left out of this pass: the `scripts/witness.mjs` peer hunks for `fx` and `pinMismatches`, the uncommitted `scripts/vendor-fx.mjs`, `web/fx-in-page.js`, `web/builtins.js`, `scripts/build-pages.mjs`, `scripts/lint-architecture.mjs`, `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `.gitignore` and `.github/workflows/pages.yml`. These are another peer's uncommitted work in the shared checkout. They are not committed or pushed by this pass.

## Phase B: queue pass witness (final tree, not pushed: witness not green)

| Step | Command | Result | Wall time |
| --- | --- | --- | --- |
| Lint | `npm run check` | exit 0 | not timed |
| Comments | `npm run lint:comments` | 70 repo-owned files checked: 0 comments; exit 0 | not timed |
| Shell witness | `npm run witness:shell` | RESULT PASS=108 FAIL=0; exit 0 | not timed |
| Full witness | `CHROME_BIN=/usr/bin/chromium npm run witness` | PASS=133, FAIL=4, WITNESS-EXIT 1 | 2026-11-10T00:48:35Z to 01:08:01Z, 19 min 26 s (1166 s) |

Phase A rows in the full witness: `python3 warm calls are timed in-page over 300 files and average under 5 ms` PASS, measured 43 ms for 30 calls (about 1.4 ms per call; the 178 ms over 30 calls baseline is replaced). `in-page python3 sees a shell rewrite made after its last call` PASS. `in-page python3 removes a file it deletes and the shell sees it gone` PASS. `in-page python3 writes a sqlite3 database through the write journal, and the shell reads its row` PASS (output `5`). `the txiki shell names an unknown pip command on stderr and exits 2` PASS (`rc=2`, `pip: unknown command 'frobnicate'`). `in-page python3 files survive a browser restart` PASS.

The four FAIL lines, all from the peer's uncommitted hunks in the shared checkout and none from this pass's commits:

- `in-page fx reports its bundled WASM version and passes its offline check`: the check was added to `scripts/witness.mjs` by the uncommitted peer hunk; `web/fx-in-page.js` and `scripts/vendor-fx.mjs` are untracked.
- `pages.yml SHAs match the AGENTS.md Hosting mapping (local, no network)`, `every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)` and `gh unavailable with every pin matching gives UNVERIFIED and no FAIL`: the peer's uncommitted `.github/workflows/pages.yml` adds a second `actions/checkout@11d5960...` (the gmfx checkout), so the pinned count is 4 and the recorded count in AGENTS.md is 3. HEAD's `pages.yml` pins 3 actions.

Not rerun, by instruction (the witness runs once after the last change). The peer's changes are left uncommitted and unpushed. Because the run is not green, nothing is pushed in this pass; the Phase A commits 547b55d, 28da1ec and 606d969 are local on main.

Known limit: the witness ran on the working tree, which includes the peer's hunks, so it does not prove HEAD alone is green. HEAD's own witness has not been run.

## Phase A: fx vendoring finished (queue pass 2)

| Commit | File | Row | Witness that must pass in Phase B |
| --- | --- | --- | --- |
| feat(fx) | web/vendor/fx/ (fx-core.wasm, the ten libfx SDK modules, manifest.json), web/fx-in-page.js, web/builtins.js, scripts/vendor-fx.mjs, scripts/build-pages.mjs, scripts/lint-comments.mjs | The libfx core and SDK are committed as generated by scripts/vendor-fx.mjs, and fx is a builtin (--version, --help, check, ask). The comment lint accepts each SDK module because manifest.json lists it, and no provenance name is needed inside the file. The generator no longer tries a /tmp zig path. | `in-page fx reports its bundled WASM version and passes its offline check`; `npm run lint:comments` (the fx modules report as listed in the manifest) |
| ci(pages) | .github/workflows/pages.yml | The build job checks out gmfx main, builds fx-core.wasm with the pinned Zig 0.17.1 (the same download and sha256 as txiki.yml), and checks the manifest before the page build. | `pages.yml builds fx core WASM from latest gmfx main before the page build`; not run in CI here (the owner asked for no CI check) |
| test(witness) | scripts/witness.mjs, scripts/lint-architecture.mjs | The site checks fx --version, fx check, which fx and type -t fx. The pin check counts each pinned SHA once, so the checkout pin used twice is one row. | `pages.yml SHAs match the AGENTS.md Hosting mapping (local, no network)`; `lint:architecture` (258 claims, 0 fail) |
| docs(agents) | AGENTS.md, ARCHITECTURE.md, README.md | The mapping names web/vendor/fx/ as committed and generated, and fixes the merged bullet in ARCHITECTURE.md. AGENTS.md is 17945 bytes after the edit, 17654 before; the audit removed no line, because lint-architecture pins each of them to a claim. | `npm run lint:architecture` |

Item 3 (the witness through the project browser): not run that way. scripts/browser-driver.mjs launches its own Chromium with --remote-debugging-port=0 and has no option to attach to an existing endpoint. The restart checks would also stop the project browser that other runs share. The witness ran on its own Chromium, as in the last pass.

Item 5 (lint:architecture): run after the witness, not under its load.

## Phase B: fx witness run 1 on clean HEAD 0134617, and the witness fix 48749d8

| Step | Command | Result | Wall time |
| --- | --- | --- | --- |
| Full witness, run 1 | `CHROME_BIN=/usr/bin/chromium npm run witness` on clean HEAD 0134617 | PASS=135, FAIL=2, WITNESS-EXIT 1 | 2026-11-10T01:12:31Z to 01:31:20Z, 18 min 49 s (1129 s) |

Both FAILs were witness defects. The product ran: the page printed `fx-core.wasm 1c894cb9b15f libfx SDK 2`, `fx ready: JSPI available; core application/wasm`, `builtin`.

- `in-page fx reports its bundled WASM version and passes its offline check`: the check read `existsSync(fxArtifact)` after `rmSync(pagesDir)` had removed the built site, so it was false by construction. Fixed in 48749d8 by reading it before the removal.
- `every vendored bundle with comments has a provenance witness (upstream name)`: the witness required `named (third-party, not edited)` on every vendored line, but the fx modules print `listed in web/vendor/fx/manifest.json`. Fixed in 48749d8 to accept either.

Run 2 on a clean HEAD after 48749d8 is not yet run. The shared checkout holds another peer's uncommitted gm work (web/gm-in-page.js, scripts/vendor-gm.mjs, scripts/gm/, web/vendor/gm/, DESIGN.md, and edits to .github/workflows/pages.yml, AGENTS.md, ARCHITECTURE.md, README.md, scripts/build-pages.mjs, web/builtins.js, web/fx-in-page.js). A witness on a clean tree needs that work committed or removed by its owner. This pass does not commit or revert it, and nothing is pushed.

## Phase A: gm addition accepted (queue pass 3)

| Commit | File | Row | Witness that must pass in Phase B |
| --- | --- | --- | --- |
| feat(gm) | scripts/gm/ (json.cpp, sha256.cpp, compact.cpp, internal.hpp, include/gm/json.hpp, include/deoxidene/result.hpp, generated include/gm/mcp.hpp, bridge.cpp) | The C++ sources of the gm wasm core. Each copy is byte-identical to /workspace/gm at HEAD 6b3ee4d (sha256 checked for each one). The one comment in bridge.cpp is removed, because scripts/ is repo-owned. | `npm run lint:comments` (82 repo-owned files, 0 comments); the in-page gm check in scripts/witness.mjs |
| feat(gm) | scripts/vendor-gm.mjs | The generator takes GM_REPO or ../gm and Zig from ZIG. The /tmp/verify Zig candidate and the unused `skills` list are removed. The manifest records the gm commit (6b3ee4d). | Two builds in a row gave the same gm-core.wasm, 6a1c46ef3ffd4387f0a92b635e33b37d01f7acd7a077c0816ea76cd9eaa7c3b4 (deterministic on this path). |
| feat(gm) | web/vendor/gm/ (gm-core.wasm, gm-core.js, manifest.json) | The vendored core is rebuilt, because the manifest's hash for web/gm-in-page.js was stale (f5613b8c, now 7559625e). web/vendor/gm/skills/ held copies that no code reads, so it is removed. | the in-page gm check in scripts/witness.mjs |
| feat(gm) | web/gm-in-page.js, web/stream-hub.js, web/builtins.js, scripts/build-pages.mjs, .github/workflows/pages.yml | gm is a builtin (--version, check, serve, tools, call, stdio). The pages build vendors gm. The pages workflow checks out AnEntrypoint/gm on main and builds gm-core.wasm with the pinned Zig. web/stream-hub.js has no importer yet. | the in-page gm check in scripts/witness.mjs; `lint:architecture` (269 claims, 0 fail) |
| fix(lint) | scripts/lint-comments.mjs | .cpp and .hpp get the C comment rule. Before, a tracked C++ file failed with "no comment rule for this file type". | `npm run lint:comments` exits 0 |
| docs(agents) | AGENTS.md, ARCHITECTURE.md, README.md, DESIGN.md | The gm mapping, the gm builtin and the gm build. | `npm run lint:architecture` (269 claims, 0 fail) |

Known: commit 48749d8 (the fx witness fix) also committed the other agent's gm check lines in scripts/witness.mjs, because it staged the whole file. Those lines are in HEAD with that commit. Nothing was pushed, so the history was not rewritten.

## Phase B: gm addition witness run 2 on HEAD e930fe8

| Step | Command | Result | Wall time |
| --- | --- | --- | --- |
| Full witness, run 2 | `CHROME_BIN=/usr/bin/chromium npm run witness` on HEAD e930fe8, started on a clean tree | PASS=138, FAIL=1, WITNESS-EXIT 1 | 2026-11-10T01:35:43Z to 01:55:09Z, 19 min 26 s (1166 s) |

The one FAIL was `in-page gm reports its bundled WASM version, passes its offline check and serves MCP methods`. The check required `browser-mcp` anywhere in the site output, but the run only called `gm call write_file`, which returns `{path, bytes}` and not the content. Fixed by a witness-only commit: the run now reads the file back with `cat gm-note.txt`, and the check matches the line `^browser-mcp$`. The fix is staged through the index on top of HEAD's file, so the other agent's working-tree hunks were not committed.

Caveat for run 2: the other agent's uncommitted floosie and gm changes (web/gm-in-page.js, web/vendor/floosie/, scripts/vendor-floosie.mjs, scripts/witness.mjs) appeared in the working tree during the run, between about 03:40 and 03:55 local. The pages-site check reads the copy built at the start of the run. The in-page checks read live files. A clean-tree run 3 has not been done.

## Phase A: gm decoupled from floosie, gm vendor regenerated (queue pass 4)

Floosie is held for its owner. `web/gm-in-page.js` no longer imports `web/vendor/floosie/browser.js`, so the gm builtin loads without floosie. `web/builtins.js` still imports `gmBuiltin` unchanged. `scripts/vendor-floosie.mjs` and `web/vendor/floosie/` stay untracked and unstaged. The floosie rows are in the uncommitted section at the end of this file, which is not committed here.

| File | Row | Witness |
| --- | --- | --- |
| `web/gm-in-page.js` | Decoupled from floosie. The hub, `gmHub`, the `gm attach` command and the `hub` field of server/discover are removed. `gmRpc` answers each `rpc` line itself, one message or a batch, through `handle`. HELP and USAGE no longer name floosie. | `node --check web/gm-in-page.js` passes. `git grep -i floosie` finds nothing in tracked code. Browser behaviour is witness run 3 below. |
| `scripts/vendor-gm.mjs` | The `/tmp/verify` zig candidate is removed again. The generator writes `skills.js`, copies the three served skills and records them in the manifest. | `node --check scripts/vendor-gm.mjs` passes. The regeneration row below. |
| `scripts/gm/bridge.cpp`, `web/vendor/gm/gm-core.js`, `gm-core.wasm`, `manifest.json`, `skills.js`, `skills/` | Regenerated with `GM_REPO=/workspace/gm ZIG=/workspace/tools/zig-x86_64-linux-0.17.1/zig node scripts/vendor-gm.mjs`. `gm-core.wasm` is 399.1 KB with C ABI 2 and starts `b8ff314844e3`. | Every manifest entry (wasm, modules, skills, skillsModule) matches its file's SHA-256: 7 of 7 MATCH. |
| `scripts/witness.mjs` | The floosie import, the floosie vendor call, the floosie artifact check, the `gm attach` run, the floosie clauses of the gm check and the pages.yml floosie check are removed. The gm checks stay. | `node --check scripts/witness.mjs` passes. Witness run 3 below. |
| `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `DESIGN.md` | Floosie text is removed and gm text stays. The AGENTS browser list keeps `web/stream-hub.js` as in HEAD. | `node scripts/lint-architecture.mjs --static`: 275 claims pass, 0 fail. |
| `.github/workflows/pages.yml`, `scripts/build-pages.mjs` | Restored to HEAD, so the floosie checkout and build steps are not committed. | `git diff HEAD` on both files is empty. |

`npm run check` exits 0. `npm run lint:comments` reports 0 repo-owned comments and exits 0 (the untracked floosie bundle is not in `git ls-files`, so it is not checked).

`web/stream-hub.js` has been tracked since a383315 and nothing imports it. Its chunk codec (`rpc`, `ndjson`, `json`, `text`) looks like the floosie hub's, so whether it leaves is the owner's decision. It is not removed in this pass.

## Phase B: gm witness run 3 on clean HEAD 6beb1d1, and the architecture lint after it

Witness run 3 ran on the clean tracked tree: HEAD 6beb1d1, with no tracked code change. The only tracked change at the start was another agent's uncommitted section at the end of this file. The run was `CHROME_BIN=/usr/bin/chromium npm run witness`, started 04:26:24 and ended 04:45:44 (19 min 20 s). It printed 139 PASS lines and 0 FAIL, then `all checks passed` and `WITNESS-EXIT 0`. The gm rows that passed are "in-page gm reports its bundled WASM version, passes its offline check and serves MCP methods", "the built GitHub Pages site runs bash and python3 without COOP/COEP headers" and "pages.yml builds gm core WASM from latest gm main before the page build". The witness used the untracked `web/vendor/floosie/` that is on disk. Nothing tracked imports it.

`npm run lint:architecture` ran after the witness, not under load, from 04:46:00 to 04:47:34. Its live probes started 15 and finished 15. The result was 286 claims pass, 0 fail, 0 unverified, exit 0.

Deviation kept: the witness drives its own Chromium through `scripts/browser-driver.mjs`. It does not attach to the project browser. The driver cannot attach, and restart checks would shut down the browser that other runs share.

## Phase A: gm_txiki browser exports, and the floosie restore (queue pass 5)

Phase A changes code, docs and vendored files only. Nothing here has been built, gated or witnessed yet. Phase B builds the new `tjs.wasm`, sets its pin, runs witness run 4 and pushes once.

Two facts about the state at the start of this pass. The floosie restore was committed by another session as `ea62485` and already pushed to `origin/main` (its reflog entry is `update by push`), so this pass did not push it and did not witness it. The floosie bundle in that commit is the same file this pass vendored from floosie `main` at `5417a536…` (SHA-256 `588f159d…`, 92,828 bytes), and its manifest matches.

| File | Row | Witness it needs |
| --- | --- | --- |
| `scripts/txiki/browser/entry.c` | Includes `private.h`. Initialises the engine once through `ensure_initialized`, which `tjs_browser_eval` now also uses. Exports the seven functions of gm's `txiki_shim.h`: `gm_txiki_new`, `gm_txiki_free`, `gm_txiki_context`, `gm_txiki_loop_alive`, `gm_txiki_loop_turn`, `gm_txiki_load_builtin`, `gm_txiki_refresh_loop_time`. `gm_txiki_new` unreferences the stop handle, as gm's native shim does. | Phase B: `vendor-txiki.mjs` compiles every listed file with zero undefined symbols, and the link check finds the seven exports. |
| `scripts/vendor-txiki.mjs` | The seven names are in `BROWSER_EXPORTS`, so they are linked with `--export` and required by `REQUIRED_EXPORTS`. The pin `TXIKI_WASM_SHA256` is still `cc37307b…`. It can only be set from the built artifact, so Phase B sets it after the build. | Phase B: the new pin, the same hash in `pages.yml` and in AGENTS, and the vendor gate. |
| `web/vendor/gm/manifest.json` | The `gm-in-page.js` entry is the file's SHA-256 after the floosie restore (`70c7dd2f…`, was `3c24eccf…`). The other six entries are unchanged, and the gm core was not rebuilt. | Phase B: the manifest check, or `vendor-gm.mjs` writing the same hashes. |
| `scripts/lint-comments.mjs` | A vendored file with comments passes when its basename is listed in its generated manifest. The rule now covers `web/vendor/fx/` and `web/vendor/floosie/`, and the fx wording is unchanged. | Phase B: `npm run lint:comments` exits 0 with the floosie bundle present. |
| `scripts/witness.mjs` | The provenance check accepts the fx or floosie manifest line. The rest of the witness is the floosie restore in `ea62485`. | Witness run 4: the provenance row passes. |
| `AGENTS.md` | A bullet describes the gm exports and their link check. The comment rule names the floosie manifest as well as the fx manifest. | Phase B: `npm run lint:architecture` (claims) and `npm run lint:comments`. |
| Floosie restore, `ea62485` | `web/gm-in-page.js` (hub, `gm attach`), `scripts/witness.mjs` (floosie checks), `scripts/build-pages.mjs` and `.github/workflows/pages.yml` (floosie vendor and build steps), `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `DESIGN.md` (floosie text), `web/vendor/floosie/`, `scripts/vendor-floosie.mjs`. | Witness run 4, and its pages.yml floosie check. |

Upstream issue, not fixed here. floosie `main` at `5417a536…` runs `scripts/build-browser.mjs`, which imports `esbuild`, but `esbuild` is not in its `package.json`. A clean `npm ci` there fails the build. So the Pages floosie step (`npm ci`, then `vendor-floosie.mjs`) will fail until floosie declares `esbuild` as a dev dependency. The local vendor used `npm install --no-save esbuild` in the floosie checkout, which did not change floosie's files.

## Phase B: txiki build and pin, and witness run 4 (queue pass 5)

The txiki gate ran on the working tree in this pass: `ZIG=/workspace/tools/zig-x86_64-linux-0.17.1/zig node scripts/vendor-txiki.mjs`. It compiled 39 of 39 files for wasm32-wasi, and the link left 0 undefined symbols and all required exports, including the seven `gm_txiki_*` functions. The wasm is 14,177,014 bytes with SHA-256 `dcd3a434…`. The first run stopped at the old pin, which is why the pin was set from that digest in `scripts/vendor-txiki.mjs`, `.github/workflows/pages.yml` and AGENTS.md. Two later runs failed on a connect timeout to `codeload.github.com` before the pass succeeded. The pass that succeeded used a foreground run with a 500 s timeout.

`npm run check` exits 0. `npm run lint:comments` exits 0 and lists the floosie bundle as `listed in web/vendor/floosie/manifest.json`.

Witness run 4 has not run. The tracked tree was not clean at that point: another session had uncommitted edits to `web/builtins.js` (a `playwriter` builtin) and `web/gm-in-page.js` (an import of `playwriter-in-page.js`), and it had untracked `web/playwriter-in-page.js` and `web/vendor/birdman/`. Those edits are not part of this request, so the witness was not run against them. It is still to run once the tree is clean, and the push is still to do.

Upstream issue, still open: the Pages floosie step needs floosie `main` to declare `esbuild`, as noted in the Phase A section.

## Shared-tree validation: playwriter, birdman, and the floosie and txiki pass (queue pass 6)

The witness ran once on the shared tree, with another session's uncommitted playwriter and birdman work in place: `CHROME_BIN=/usr/bin/chromium npm run witness`, started 05:22:03 and ended 05:40:56 (18 min 53 s), log `/tmp/p23-witness2.log`. It printed 140 PASS, 0 FAIL, 0 UNVERIFIED, 0 SKIP, `all checks passed` and `WITNESS-EXIT 0`. The witness has no playwriter or birdman check. Its gm check shows the hub with the `playwriter` endpoint registered, which is the extent of its coverage of that feature.

Before this run, another session ran the witness on the same tree (`/tmp/push-witness.log`, exit 1). Its micropip check read an empty Pyodide lock, whose SHA-256 is the empty-input hash `e3b0c442…`, so the CDN fetch failed during that run. Its provenance check failed on the lint as it stood then. `scripts/lint-comments.mjs` changed on disk during that run, and the current lint passes.

Collision defects, each fixed at its cause:
- `web/vendor/gm/manifest.json`: the `gm-in-page.js` hash was stale after the playwriter edit to `web/gm-in-page.js`. It is now `12a0a00e…`.
- `AGENTS.md`: the builtin list omitted `playwriter`, which `BUILTIN_NAMES` in `web/builtins.js` includes. It now names it. `web/shell-lookup.js` gets its names from `lookupPrologue(BUILTIN_NAMES)`, so `which`, `command -v` and `type` already agree for it.
- `scripts/lint-comments.mjs`: the manifest reader knew only `modules` and `browser`. The birdman manifest uses a `client` entry, so a commented birdman bundle would have failed once tracked. The reader now takes every named entry.

Hunk attribution. Both groups were committed in this pass, path-limited, after the run above.
- Other session (playwriter and birdman): `web/playwriter-in-page.js`, `scripts/vendor-birdman.mjs`, `web/vendor/birdman/` (`client.js` SHA-256 `c98ed24b…`, which matches its manifest), `web/builtins.js` (the `playwriter` builtin), `web/gm-in-page.js` (the playwriter import, the verbs scope, and `hub.attach('playwriter', …)`), `AGENTS.md` (the Browser list and the birdman line), `ARCHITECTURE.md` (the builtin list, the twelve builtins, the playwriter row, and the gm row), `README.md` (the playwriter usage line), and the birdman entry in `scripts/lint-comments.mjs`.
- This pass: `web/vendor/gm/manifest.json`, the `playwriter` name in the AGENTS builtin list, and the manifest reader in `scripts/lint-comments.mjs`.

Validation on the same tree. `npm run check` exits 0. `npm run lint:comments` exits 0, and its 17 vendored bundles are each named or listed. `node scripts/lint-architecture.mjs --static` reports 299 claims pass, 0 fail, 0 unverified. The full live architecture lint was not run in this pass.

## Live architecture lint and the playwriter and birdman witness checks (queue pass 7, open)

Live architecture lint, in the foreground: `CHROME_BIN=/usr/bin/chromium npm run lint:architecture`, which spawns `scripts/lint-live.mjs` with a 900000 ms limit. The first call omitted the Bash timeout, so the harness moved it to the background, and it was then blocked on its PID. Output: `310 claims: 310 pass, 0 fail, 0 unverified; 39 prose lines with NO_CLAIM`, exit 0. All 15 live probes finished. The live terminal ran from 03:48:03.889 to 03:52:10.840 UTC, 246.9 s.

Witness checks added to `scripts/witness.mjs`:
- In the first terminal run: `playwriter --version`, `which`, `command -v` and `type` on `playwriter` (it must name a shell builtin), and `playwriter frobnicate; echo after-frobnicate`, which must report the unknown command and let the shell go on.
- Node side, near the end: the vendored `web/vendor/birdman/client.js` matches its manifest `client.sha256`, and `web/playwriter-in-page.js` imports that client.

The witness ran once in the foreground: `CHROME_BIN=/usr/bin/chromium timeout 590 npm run witness`, started 03:53:08 UTC. The timeout cut it at 04:02:58 UTC (590 s, exit 124), before it finished. Counts at the cut: `PASS 120 FAIL 0 UNVERIFIED 0`. The three playwriter checks passed in that run. The birdman check is near the end, so the run never reached it. Run on its own, it passes (sha256 `08435ff1381c…`, matching the manifest).

Why the run did not finish: the witness takes about 19 minutes (18 min 53 s in queue pass 6), and a foreground tool call is limited to 10 minutes. The run was not split and was not backgrounded, so the witness is not validated as a whole. The cut run's Chromium tree (profile `thebird-profile-LLXUTH`) was stopped by PID after the cut. Other actors' Chromium processes were left running.

Validation: `npm run check` exits 0. `npm run lint:comments` exits 0, with 0 comments in 86 repo-owned files.

Outcome: open. Nothing was pushed. The next step is one full witness run that is not limited by the 10-minute foreground call.

## Phase A: floosie vendor step pins esbuild (queue pass 8)

`scripts/vendor-floosie.mjs` no longer runs floosie's `build:browser` script, which imports `esbuild` without declaring it in floosie's `package.json`. The vendor step now installs `esbuild@0.28.2` (`ESBUILD_VERSION`) into `os.tmpdir()/thebird-esbuild-0.28.2` with `npm install --no-save`, and bundles `src/browser.ts` with the same options as floosie's `scripts/build-browser.mjs`. The bundle is written straight to `web/vendor/floosie/browser.js`. The manifest gains `builder.esbuild`. The step fails early when floosie has no `node_modules`; `pages.yml` already runs `npm ci` in the floosie checkout before the step.

Result: `node scripts/vendor-floosie.mjs` exits 0. The bundle SHA-256 is `588f159dd6ea35184516001f68d8010b8b34341d9584f1fb97e9a95b7ab801f9`, the same as before, so the bundle is byte-identical; only the manifest changed. npm reports that esbuild's postinstall script is blocked by its allow-scripts setting. Bundling works without it.

Validation: `npm run check` exits 0. `npm run lint:comments` exits 0, with 0 comments in 86 repo-owned files. `node scripts/lint-architecture.mjs --static` reports 299 claims pass, 0 fail, 0 unverified.

Not done in this phase: the checkpoint runner. See the next section for why it cannot finish the witness.

## Phase B: witness is not runnable as sequential foreground calls (queue pass 8, open)

The witness has a command-expiry check (`scripts/witness.mjs`, the `expiry` terminal run) that runs one command, `for i in 1 … 17; do sleep 55; echo tick$i; done`, in one browser session. It needs to run past the 900 s `COMMAND_TIMEOUT_MS` to show the cut, so it takes about 935 s. A foreground Bash call is capped at 600000 ms, and a browser session cannot continue across calls. So no sequence of foreground calls with a checkpoint can finish this check, and the witness cannot be green under the foreground rule. The checkpoint runner was not built, because it could not finish this group.

Options for the owner, none taken: (a) run only the expiry check as a separate process that is not backgrounded by this session; (b) witness the expiry in a different way, which needs an owner decision because AGENTS.md forbids lowering the timeout; (c) accept a witness run that excludes the expiry check, and say so in the ledger.

Nothing was pushed in this phase.

## Queue pass 9: live architecture lint passes; the expiry group is still blocked

Live architecture lint, in the foreground: `CHROME_BIN=/usr/bin/chromium npm run lint:architecture`, exit 0. Output: `310 claims: 310 pass, 0 fail, 0 unverified; 39 prose lines with NO_CLAIM`. The live terminal ran from 04:34:13 to 04:39:25 UTC, 312 s, with 15 probes.

Expiry experiment, outside the repo (`/tmp/p27/vt3.mjs`). The expiry command was typed after the page loaded, with CDP `Emulation.setVirtualTimePolicy` set to `advance`, to see whether the page clock could run the 900 s limit in a short real time. Result: the page clock moved forward by 5000 s, but the shell's `sleep 55` never completed in 400 s of real time, so there was no `tick1`. Virtual time pauses the worker timers the shell sleeps on. The approach is not usable.

The expiry group therefore has to keep one browser session alive for about 935 s, and a foreground call is capped at 600000 ms. Nothing can carry that session across calls without a process that outlives the call, which is the backgrounding the owner ruled out. The witness is not green, and nothing was pushed in this pass.

## Phase A: expiry through the component's own window, and a checkpointed witness (queue pass 10)

Code and tests only. Nothing was pushed.

The component change. `createShell` takes `commandTimeoutMs`, and defaults to `COMMAND_TIMEOUT_MS = 900000`. The page reads a `commandTimeoutMs` URL parameter (`web/terminal.js`), `web/shell-client.js` puts it on the worker URL, and `web/shell-worker.js` passes it to `createShell`. The same value goes to the bashkit `Bash` constructor and to the builtins, so the real expiry code path runs; only the window length changes. The production default is unchanged.

The witness. The expiry check runs `for i in $(seq 1 30); do sleep 1; echo tick$i; done` with `commandTimeoutMs=10000`. It passes when the output has `execution timeout (10s)`, has 5 to 29 tick lines, and has no `late-finish` line. A new check reads `web/bash-shell.js` and `web/shell-worker.js` and requires the shipped `COMMAND_TIMEOUT_MS = 900000` and the URL path to it.

The checkpoint, `scripts/witness-checkpoint.mjs`, with `THEBIRD_WITNESS_CHECKPOINT=<dir>`. Every browser run is recorded to `terminal-NNN.json`, with its interact trace and its state. A later call replays a recorded run without a browser: the same interact code runs against the trace, and every page step is checked against the recorded step, so a divergence fails. Node-side values the interact code reads (the hold server's request count, and the time of the cancel) go through `note`, so they are recorded too. Relay, pages and host ports are kept in the state file, so each page keeps the same origin between calls. The Chromium profile lives in the checkpoint directory, so OPFS and local storage survive. Each call stops before a new browser run once it passes 330 s (exit 75), and the next call resumes. The state file holds the check list, and the tree key (HEAD, the diff and the status) resets the checkpoint when the tree changes. Each call prints only the checks it adds.

Witness of this phase, the focused run (`/tmp/p28/focused.mjs`, the same `runTerminal` and page code, outside the repo):
- `EXPIRY timeout-line: true`, `EXPIRY ticks: 9`, `late-finish present: false`, `EXPIRY wall s: 11.0`. The output ends `error: resource limit exceeded: execution timeout (10s)`.
- `REPLAY steps: 6 kinds: type,press,eval,note`, `REPLAY observed equal: true {"note":42,"text":true}`, `REPLAY state equal: true`.

Other validation. `npm run check` exits 0. `npm run lint:comments` exits 0, with 0 comments in 86 repo-owned files. `node scripts/lint-architecture.mjs --static` reports `303 claims: 303 pass, 0 fail, 0 unverified`. The lint's expected strings and the ARCHITECTURE.md expiry paragraph are updated for the window change. The full witness has not run in this phase; that is Phase B.

## Phase B: full witness in two foreground calls, and the live architecture lint (queue pass 10)

The witness on the tree at `7f2f2c2` plus the ledger commit, run as sequential foreground calls with `THEBIRD_WITNESS_CHECKPOINT=/tmp/p28-witness CHROME_BIN=/usr/bin/chromium timeout 590 node scripts/witness.mjs`. Each call stops before a new browser run after 330 s.

Call 1: `CALL 1 PAUSED before terminal 25: checks this call PASS 60 FAIL 0`, exit 75, wall 04:54:06 to 04:59:37 UTC (331 s), log `/tmp/p28/call-1.log`.

Call 2: resumed from the checkpoint (25 browser runs replayed, the rest live). `checkpoint /tmp/p28-witness: call 2, 93 browser runs recorded`, `witness totals: PASS 144 FAIL 0`, `all checks passed`, exit 0, wall 04:59:43 to 05:03:02 UTC (199 s), log `/tmp/p28/call-2.log`. The replay diverged zero times. The two playwriter checks, the birdman sha check, the expiry window check (`9 ticks; error: resource limit exceeded: execution timeout (10s)`) and the production-value check all PASS. Wall time for the witness is 530 s across the two calls.

Live architecture lint, in the foreground: `CHROME_BIN=/usr/bin/chromium npm run lint:architecture`, exit 0, `314 claims: 314 pass, 0 fail, 0 unverified; 39 prose lines with NO_CLAIM`, log `/tmp/p28/lint-live.log`. The live terminal ran 05:03:12 to 05:09:36 UTC (384 s).

Defects found in this phase. None in the witness or the component. The change in Phase A broke three static architecture claims (the exact strings in the lint and the ARCHITECTURE.md expiry paragraph), and those were fixed in Phase A.

Final validation on the tree: `npm run check` exits 0. `npm run lint:comments` exits 0, with `87 repo-owned files checked: 0 comments`.

Push: `origin main`, once, after this ledger commit. The pushed range includes the esbuild pin (`fd3f297`), the playwriter and birdman checks (`944831b`, `fb27a52`), and the expiry window and checkpoint (`7f2f2c2`).

## Phase A: expiry decision, ledger ranking, and stale pyodide entries (queue pass 11)

Docs only. No build, test, gate or witness ran in this phase. Its witness is the Phase B list below.

Decision, recorded in `ARCHITECTURE.md` (Command timeout) and here. The live 900 s cut stays unexercised. A single browser session would need about 935 s for seventeen 55 s sleeps that pass the limit, and a witness call is capped at 600000 ms. Nothing can carry the session across calls without a process that outlives the call, which the owner ruled out. The accepted witness is the static check of the shipped 900 s value in `web/bash-shell.js`, plus the 10 s window through the same expiry path (`execution timeout (10s)`, 9 ticks, no `late-finish`, 11.0 s wall, recorded in the queue pass 10 Phase A entry).

Ranking of the reachable remaining items, done in this order:
1. Expiry decision: written to `ARCHITECTURE.md` and this ledger. Change only, docs. Witness: Phase B, the full witness's static 900 s check and the expiry window check.
2. Stale pyodide entries: the two ledger lines that said `web/vendor/pyodide/` was left in place now point to its removal, which the queue pass entry records. Docs only. Witness: Phase B static lint, which checks that `scripts/vendor-pyodide.mjs` is gone.
3. Process model confirmation: the ledger's "Confirm it in Phase B" item. No code change. Witness: Phase B runs `npm run witness:shell`, whose groups cover `ps`, `kill`, the job table and `$!` (`scripts/witness-shell.mjs`, the process group).

Not reachable in this pass, and why:
- Ctrl-C on the Pages site without cross-origin isolation (Blocked table above). The owner must choose between accepting the restart and isolating the site with a service worker.
- `web/stream-hub.js`: tracked and not imported by anything. Removing it is the owner's decision.
- Licences: thebird has no LICENSE for its own code, the Pyodide bundle licence is unconfirmed, and the vendored notices are the owner's call.
- Journal limit: a C extension that writes a file without a Python audit event is not journaled. This is documented, and it has no in-repo fix.
- Upstream floosie `esbuild` declaration: an external repo. The vendor step no longer depends on it (`fd3f297`).
- Shell on txiki (AGENTS.md, "assessed and not built"): needs a bash-subset parser, which is a separate project and is not a ledger item.

Changes in this phase: `ARCHITECTURE.md` (decision paragraph), `docs/PENDING_VALIDATION.md` (this section, and the two stale pyodide lines).

## Phase B: ranked ledger items, each witness and its wall time (queue pass 11)

Run on HEAD `d7494ba` (the Phase A commits), with no code change in this phase. Every witness below is a foreground call under the 600000 ms limit.

Full witness, `THEBIRD_WITNESS_CHECKPOINT=/tmp/p29-witness CHROME_BIN=/usr/bin/chromium timeout 590 node scripts/witness.mjs`, in three calls. Each call stops before a new browser run after 330 s.
- Call 1: `CALL 1 PAUSED before terminal 2: checks this call PASS 13 FAIL 1`, exit 75, wall 05:23:11 to 05:32:15 UTC (544 s). The FAIL was `the built GitHub Pages site runs bash and python3 without COOP/COEP headers`. The site's `python3 -c "print(6*7)"` printed `python3: Failed to fetch`, so the 42 line was missing. The cause is the network path to the Pyodide bundle, not the code: the bundle is 18216757 bytes (it was about 5 MB in earlier notes, and its `last-modified` is 2026-11-08). A 120 s curl fetched 10 MB, and a foreground curl then completed the full bundle in 288 s at 63 KB/s. The recorded failing run was moved to `/tmp/p29/discarded/terminal-001.failed-python-fetch.json`. The checkpoint was rewound to nine checks and one run, so that run is not replayed.
- Call 2 (after the rewind): the site run passed, and checks 10 to 14 PASS. `CALL 2 PAUSED before terminal 3: checks this call PASS 5 FAIL 0`, exit 75, wall 05:40:18 to 05:47:20 UTC (422 s).
- Call 3: `checkpoint /tmp/p29-witness: call 3, 71 browser runs recorded`, `witness totals: PASS 144 FAIL 0`, `all checks passed`, exit 0, wall 05:47:28 to 05:51:11 UTC (223 s). Replay diverged zero times.
- Total wall for the full witness: 1189 s across the three calls, 544 + 422 + 223, including the discarded run.

Node-side shell witness, `npm run witness:shell`, which is ranked item 3 (the process model): `RESULT PASS=108 FAIL=0`, exit 0. Its process group (`$!`, `ps`, `kill -TERM`, `kill` of an unknown PID, `wait`) PASSES. Wall 05:51:15 UTC, under a second by the shell clock.

Live architecture lint, `CHROME_BIN=/usr/bin/chromium npm run lint:architecture`: `314 claims: 314 pass, 0 fail, 0 unverified; 40 prose lines with NO_CLAIM`, exit 0. The live terminal ran 05:51:19 to 05:52:49 UTC (90 s, 15 probes). The prose count rose from 39 to 40 with the new decision paragraph in ARCHITECTURE.md.

Other validation on this HEAD. `npm run check` exits 0. `npm run lint:comments` exits 0, with 0 comments in 87 repo-owned files.

Ranked items, status:
1. Expiry decision: recorded in ARCHITECTURE.md and here. Witnessed by the full witness's static 900 s check and its 10 s window check, both PASS.
2. Stale pyodide entries: corrected. The lint's check that `scripts/vendor-pyodide.mjs` is gone PASSES in the live lint.
3. Process model: confirmed by `witness:shell`, 108 PASS.

Found and open, not a code defect: the Pyodide bundle is 18.2 MB, and on this link a cold `python3` on the Pages site must download it, which takes about 290 s. One Pages python3 fetch failed in call 1 and passed on the rerun. The 900 s command limit still covers the download. If the bundle or the link gets slower, the Pages python3 check will fail again. The fix would be on the bundle side, or in the page's fetch retry. That needs an owner decision, so it is recorded here and not changed.

Push: `origin main`, once, after this ledger commit.

## Open decisions

- `scripts/vendor-pyodide.mjs`: retired in 18403ed, with its references in ARCHITECTURE.md, AGENTS.md, README.md and `scripts/lint-architecture.mjs` changed in the same commit. The stale local directory `web/vendor/pyodide/` has been removed (see the queue pass entry that records its deletion).
- Pyodide bundle licence: held by the owner, and not confirmed. The stripped bundle at `https://anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br` is not changed by this pass. The licence notice file `web/vendor/PYODIDE-NOTICE.md` was removed in the licence removal above, so this question is recorded only here.
- Licence notices for the vendored bundles: removed in the licence removal above. Whether they return in another form is the owner's decision.
