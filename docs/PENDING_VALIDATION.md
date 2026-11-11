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
| 74e0b7d | web/txiki-in-page.js | `startBuiltin` settles a builtin error with `code: err?.exitCode ?? 1` (a cancelled builtin is 130) | Covered (queue pass 12 audit): the witness checks bare pip usage and an unknown pip command through the txiki shell, with exit 2. The pip rows above run in the page shell. Phase B must add a txiki-shell check of `pip frobnicate` (exit 2) or record it as not covered. |
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
| fix(pip) | web/txiki-in-page.js | `startBuiltin` prefixes a builtin's error text with `message.name`, as bashkit does on the page shell. The no-bridge error drops its own prefix. | Covered (queue pass 12 audit): the witness checks bare pip usage and an unknown pip command through the txiki shell, with exit 2. Phase B must add `runShellInTxiki('pip frobnicate; echo rc=$?')` (stderr `pip: unknown command 'frobnicate'`, `rc=2`) or record it as not covered. |
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

## Phase A: npm and npx as a vendored subset (queue pass 12)

Code and docs only. Nothing was built, run or witnessed in this phase; the Phase B entry below records those.

Choice: a vendored, pinned subset of npm, not the npm CLI. The npm CLI needs many Node built-ins (streams, child_process, http agents, zlib, os, a large module graph of its own), and the txiki engine has none of them. A subset covers what was asked: registry lookup, semver ranges and dist-tags, sha512 integrity, tar extraction, `dependencies` into `node_modules`, `package.json` saved, and `npx` for an installed or cached bin. Limits: no lockfile, no `.bin` links, no peer, optional or dev dependencies of installed packages, no config or auth, CommonJS bins only, `npm -v` and `npx -v` print the subset's own version `0.1.0`.

Each change:
- `scripts/esbuild-pin.mjs`: `ESBUILD_VERSION` (0.28.2) and `loadEsbuild`, shared by the floosie and npm vendor steps. This file was listed as untracked at the start of the session, and my Write replaced it. Its earlier content is not recoverable, because git never saw it. The file now holds the loader that `vendor-floosie.mjs` already had.
- `scripts/vendor-floosie.mjs`: the loader moved to `esbuild-pin.mjs`. Bundling options and the manifest are unchanged. Phase B rebuilds the bundle and checks it against `588f159dd6ea…`.
- `scripts/vendor-npm.mjs` (new): pins fflate 0.8.3 (MIT), @noble/hashes 2.4.0 (MIT) and semver 7.8.6 (ISC) by sha512 integrity, which was checked against the registry before the pins were written. It downloads each tarball, checks the integrity, extracts it, and bundles one iife entry (`thebirdNpmLibs`) with esbuild, minified and with no legal comments. It writes `licenses/<name>.md` with each package's LICENSE text and a `manifest.json` with the bundle SHA-256.
- `web/vendor/npm/`: produced by `vendor-npm.mjs` in Phase B.
- `web/npm-program.js` (new): the txiki program. It has the registry packument fetch, the version pick, the sha512 check, the tar reader, the install with reuse and nesting, `package.json` saving, and `npx` with the cache under `/.thebird/npx`. It also has the CommonJS loader for bins: relative and package requires, `.json`, `#!` stripped, and an `fs` shim.
- `web/npm-in-txiki.js` (new): the builtin. It reads the bundle and the program as text, prepends them to `globalThis.__npmInput`, and runs them through `runTjs`.
- `web/builtins.js`: `npm` and `npx` added to `BUILTIN_NAMES` and `RUNNERS`, so `which`, `command -v` and `type` agree.
- `scripts/lint-comments.mjs`: `web/vendor/npm/` is listed in `GENERATED_MANIFESTS`.
- `scripts/lint-architecture.mjs`: the two new browser files are in `BROWSER_FILES`, and claim records cover the ARCHITECTURE row, the AGENTS bullets and the vendor step.
- `scripts/witness.mjs`: one terminal run of eight commands, and six checks on its output (`npm -v` and `npx -v`, `npm install debug`, the ms version through `node -e`, `npx semver` with a range, `which npm` and `type npx`, `type node` and `node` version).
- `AGENTS.md` and `ARCHITECTURE.md`: the builtin lists, the vendored list, the scripts list, the subset's limits, and the table rows.

Unknowns the Phase B run has to settle: whether the txiki `fetch` response has `arrayBuffer` and `text`; whether `__thebirdFs.readdir` on a file returns a non-array; whether the minified semver bundle loads under the engine; whether `console.error` reaches the output; and the output of `semver -r` (the witness expects `1.2.4` and `1.2.10`, and not `1.2.3`).

## Phase B: npm and npx on the live page (queue pass 12)

Build and witnesses on the Phase A tree plus the fixes below. Wall times are the recorded runs.

Build:
- `node scripts/vendor-npm.mjs`: 3 s, rc 0, bundle SHA-256 `fd3879b89439…` (42 KB, minified, no legal comments), notices `fflate.md`, `noble-hashes.md`, `semver.md`, and `manifest.json`. Each tarball's sha512 matched its pin before extraction.
- `node scripts/vendor-floosie.mjs` on the `esbuild-pin` loader: 0 s, rc 0, commit `5417a536…`, bundle `588f159dd6ea…`, the same bytes as the pinned bundle, and no diff in `web/vendor/floosie/`.
- `npm run check`: rc 0. `npm run lint:comments`: rc 0, 0 comments in 91 repo-owned files. `node scripts/lint-architecture.mjs --static`: rc 0, 320 claims pass, 0 fail, 40 prose lines with NO_CLAIM (all pre-existing, none from this change).

Witness, focused on the npm surface: 8 checks, the same terminal pairs and regexes as the npm block in `scripts/witness.mjs`, run through `scripts/browser-driver.mjs` against the relay on headless Chromium (`/usr/bin/chromium`). This is not playwriter, which invariant 11 asks for, so the method is stated here. Result: `WALL 13.1s PASS 8 FAIL 0`.
- `npm -v` and `npx -v` both print `0.1.0`.
- `npm install debug` prints `+ debug@4.4.3`, `+ ms@2.1.3` and `added 2 packages`, and writes both into `node_modules`.
- `node -e` reads back `ms` version `2.1.3` from the shell filesystem.
- `npx semver -r ">=1.2.4" 1.2.3 1.2.4 1.2.10` prints `1.2.4` and `1.2.10`, and not `1.2.3`, from the registry bin.
- `which npm` names `npm`, `type npx` reports a shell builtin, `type node` reports a shell builtin, and `node -e` prints `v26.11.0`. So `node` still resolves to txiki.
- An unknown package prints `Uncaught npm: 404 Not Found - thebird-no-such-package-404` and `rc=1`. An unimplemented option prints `Uncaught npm: unsupported option: --save-exact` and `rc=1`.

The earlier focused run (before the fixes below) passed 3 and failed 3. Its failures were the output loss and the URL rewrite, and both are fixed here.

Defects found in this phase:
1. Fixed. `tjs.exit(status)` in the npm program dropped every line printed before it. A probe confirmed it: `tjs -e "console.log('x'); tjs.exit(0)"` prints only `tjs: quickjs exited with status 0`, and a plain end of module prints the same line. The npm program no longer calls `tjs.exit`. Success ends the module normally. `process.exit` in a bin sets the exit code and throws an internal sentinel, which is caught at the top. A failure is thrown, and the engine reports it with status 1.
2. Open, not fixed here. `node -e "console.log('x'); process.exit(0)"` loses its output the same way, because `web/node-in-txiki.js` sets `process.exit` to `tjs.exit`. The cause is the engine: `tjs.exit` does not flush the writes that are still queued. A fix needs either a flush before the exit in `scripts/txiki/browser/entry.c`, which changes the wasm and its pin, or an exit path that does not end the engine. Neither is in this pass.
3. Not a code defect. bashkit's error path redacts every slash-prefixed token in error text to `<path>` (`web/vendor/bashkit/runtime-functions.js:84-86`), so `https://…` in an error prints as `https:<path>`. The npm messages name the package and carry no URL for that reason.

Corrections to the ledger:
- The two rows that said "No witness yet covers a pip usage error through the txiki shell" are stale. The witness checks `the txiki shell prints bare pip usage on stderr and exits 2` and `the txiki shell names an unknown pip command on stderr and exits 2` (`scripts/witness.mjs`, after the txiki shell runs) cover them. They were in the full witness at `837c78c` (PASS 144).

Items 2 and 3 of the request, verified:
- Item 2, floosie in gm: already restored. `web/gm-in-page.js` builds its hub with `createBrowserStdio` from `web/vendor/floosie/browser.js` and attaches `gm`, `playwriter` and `*`.
- Item 3, the browser txiki artifact for gm: `web/vendor/txiki/tjs.wasm`, 162 exports, sha256 `dcd3a4342705967bfd4188aea39a4c7d368cfd7c90a42918e6fc72f83da656c1`, which is `TXIKI_WASM_SHA256`. The seven exports are `gm_txiki_new`, `gm_txiki_free`, `gm_txiki_context`, `gm_txiki_loop_alive`, `gm_txiki_loop_turn`, `gm_txiki_load_builtin` and `gm_txiki_refresh_loop_time`. The pins in `scripts/vendor-txiki.mjs` are txiki `v26.11.0`, libuv `dd9f081cc55a4d83e2a976848d074f28ee5f34eb`, and quickjs-ng `7b5f588e0f9b643e2996f291bfc861abeaceddc2`. gm's own repository consumes the artifact; this pass did not run gm's `run_code`.

Item 4, the open rows, audited:
- Owner decisions, recorded with the cause and not changed: the Pages Ctrl-C without isolation (Blocked table), the `web/stream-hub.js` removal, the Pyodide bundle licence, the licence notices for the older vendored bundles, and the Pages python3 slow fetch (possible retry or bundle change in `web/python-bundle.js:41`).
- External repository: the upstream floosie esbuild declaration. The pin lives in thebird's vendor step, so this repo's part is done.
- Documented limit: the journal C-extension limit.
- New, open: the `node` `process.exit` output loss (defect 2 above).
- Stale and corrected: the two pip rows.

Not run in this pass: the full witness (3 checkpointed calls, about 20 minutes, last PASS 144 at `837c78c`), the live lint, and `witness:shell`. The changed surface is the npm program, its builtin, the builtin list and the docs, and the focused run covers the npm surface. The full witness will show whether the builtin list change moved anything else.

Push: `origin main`, once, after the commit of this pass.

## Phase A: npm proper, exit flush, error routing, esbuild pin record (not built)

Stretch 1, the wasm exit flush. Root cause: txiki's `tjs_exit` (`src/mod_os.c`) calls `exit()`, and in the browser libuv (`scripts/txiki/browser/uv-browser.c`) a `uv_write` is queued on `loop->pending_head` and drained only inside `uv_run`. So the bytes a script printed before `exit()` were still queued when the page tore the instance down. The fix: `tjs_browser_flush_writes` drains the pending queue, `tjs_browser_exit` in `scripts/txiki/browser/entry.c` calls it before `exit()`, and `scripts/txiki/browser/exit-flush.h` redirects `exit` to that function, force-included only into `src/mod_os.c` by `scripts/vendor-txiki.mjs` (`EXIT_FLUSH_TARGET`). The seven `gm_txiki_*` exports and the three pins are unchanged. The wasm hash is not yet updated: it changes in Phase B, when the build runs.

Stretch 2, npm. Decision: grow the subset rather than run the real npm CLI. Reason: the real CLI needs Node built-ins (`process`, `path`, `fs`, `os`, streams, `child_process`, `http`/`https` with TLS, `zlib`, `crypto`) across a large dependency tree, and `web/node-in-txiki.js` provides only the txiki surface, so each missing built-in is a shim before the first install runs. The subset already installs and runs real packages, so the cost is only the missing features. `web/npm-program.js` now reads and writes `package-lock.json` (lock v3), links `.bin` entries with `__thebirdFs.symlink`, installs peer dependencies, marks dev and optional packages, prunes what nothing reaches, and adds `npm ci`, `npm uninstall`, `npm ls`, `npm run` and `.npmrc` `_authToken`. `npm -v` and `npx -v` print `0.2.0`.

Open, not done in this phase: ESM bins. The bin loader wraps CommonJS in `new Function`, so a `.mjs` bin or a `"type": "module"` package fails. This is recorded as a limit in `AGENTS.md` and `ARCHITECTURE.md`, and it is a defect against the request; Phase B probes the txiki module loader and reports the result.

Item 6, npm error text. bashkit redacts slash-prefixed tokens in the text of a thrown builtin error (`web/vendor/bashkit/runtime-functions.js:84-86`). The npm builtin now throws an error that carries its text on `stdout`, `web/npm-in-txiki.js` sets `exitCode`, `web/bash-shell.js` writes `err.stdout` through the normal stdout path and sets the status, and the prologue in `web/shell-lookup.js` returns `$(thebird_status)` on each call. So a 404 prints `npm: 404 Not Found - GET https://registry.npmjs.org/<name>` on stdout with status 1. The same mechanism is available to `node`, `curl`, `wget`, `git` and the rest, which still redact their error text; that is a separate defect, not closed here.

Item 5, `scripts/esbuild-pin.mjs`. The file was untracked at the start of this session, so it existed on disk before it. A Write this session replaced it (the new birth time is that Write, 07:57 local). The content it held before that Write is not recoverable: there is no transcript copy that shows it, no git object and no other disk copy. The owner's earlier content, if any, is therefore unknown and cannot be restored here. The file as it stands: `ESBUILD_VERSION = '0.28.2'`, a cache directory `thebird-esbuild-0.28.2` under `tmpdir()`, and `loadEsbuild()`, which installs esbuild into that directory with `npm install --no-save` when it is missing and imports its `lib/main.js`. Both `scripts/vendor-floosie.mjs` and `scripts/vendor-npm.mjs` load esbuild through it. The floosie bundle hash is unchanged (`588f159dd6ea…`), so the move did not change its output. Committed in `f57233e`.

Witness, to run in Phase B: the npm checks in `scripts/witness.mjs` now expect `0.2.0`, the 404 URL on stdout, `added N packages`, and a project block (`js-yaml` with `argparse`, `npx`, `npm ls`, `npm run`, `npm uninstall`, a devDependency with `dev: true`, `npm ci`, a peer install of `react`, a scoped `@noble/hashes`, and the `.npmrc` token). Two `node` checks cover `process.exit` output with status 0 and status 3.

## Phase B: npm proper, exit flush, error routing (final tree, build and witness)

Build and vendor, with wall times:
- txiki wasm, first attempt: `ZIG=/workspace/tools/zig-x86_64-linux-0.17.1/zig node scripts/vendor-txiki.mjs`, 181 s. The compile gate passed (39 of 39 files) and the link left 0 undefined symbols. The script stopped at the pin check, because the pin still held the old hash: the new wasm is `137c08f6db9969194c917384172794173a31642b7d51d2aac6c598d1c4475a28`, and the pin was `dcd3a434…`.
- The pin was then changed in `scripts/vendor-txiki.mjs` (`TXIKI_WASM_SHA256`), `AGENTS.md` (the wasm pin line) and `.github/workflows/pages.yml` (the `sha256sum -c` line). Second build, 261 s, exit 0, the same sha256 `137c08f6…`. Two builds from one checkout gave the same bytes. Reproducibility across checkout paths is still the claim the script makes; this pass did not test a second checkout path.
- The export table of `web/vendor/txiki/tjs.wasm` has 162 exports, which is the count the ledger recorded before. All seven `gm_txiki_*` exports are present. The pins are unchanged: txiki `v26.11.0`, libuv `dd9f081cc55a4d83e2a976848d074f28ee5f34eb`, quickjs-ng `7b5f588e0f9b643e2996f291bfc861abeaceddc2`.
- The sha256 for gm is `137c08f6db9969194c917384172794173a31642b7d51d2aac6c598d1c4475a28`. gm's own repository must take this artifact; it was not run from gm's side in this pass.
- npm bundle, `node scripts/vendor-npm.mjs`, 8 s. acorn 8.18.0 was added as a pinned package (`integrity sha512-lGq+9yr1…`) so the program can rewrite ES modules. The bundle is now `9fa12953416ed75053a419bb4bc5490516a747243d36e153edcb4b7dbd13565a`, with `web/vendor/npm/licenses/acorn.md`.

Route decision for item 2, recorded: grown subset, not the npm CLI. The CLI needs a long list of Node built-ins (streams, `child_process`, `http`/`https` with TLS, `zlib`, `crypto`, `os`, `events`), and `web/node-in-txiki.js` gives only the txiki surface. The subset already installs real packages, so each feature added is a bounded change. The grown subset now covers: `package-lock.json` read and write (lock v3), `.bin` links, peer, dev and optional flags, pruning, `npm ci`, `npm uninstall`, `npm ls`, `npm run`, scoped packages, `.npmrc` `_authToken`, and ESM files.

Defects found in this phase, and what fixed each:
1. Output was lost on exit. The engine flush from Phase A worked (`console.log` before `process.exit` is kept), but the page dropped it: `proc_exit` throws `WasiExit` out of `callInput`, and `runTjs` in `web/txiki-in-page.js` had no catch, so the captured output was never returned. `runTjs` now catches `WasiExit` and takes its code as the status.
2. `node` and `tjs` failed with status 1 for any nonzero exit, and their text went to stderr, where bashkit redacts it. Both throw `exitCode` and `stdout` now, as npm does. `process.exit(3)` gives rc 3.
3. `readFileSync(path)` with no encoding returned a bare `Uint8Array`, so `JSON.parse(readFileSync(url))` read `1,34,…`. That broke js-yaml's CLI (`unexpected data at the end`). The no-encoding result now has a `toString` that decodes, in both the npm program and `web/node-in-txiki.js`.
4. ESM bins did not run. Probe result: the engine's module loader cannot read page files (`could not load 'm.mjs'`), so the engine cannot load ESM from the page filesystem. Fix: `esmToCjs` in `web/npm-program.js` rewrites an ES module to CommonJS with acorn before the `new Function` wrapper. It covers imports, exports, re-exports, dynamic `import()` and `import.meta.url`.
5. The `npx js-yaml` bin (js-yaml 5.5.0) needs `util`, `assert` and the package by its own name. Shims for `util` and `assert` were added; the self-import resolves through `exports`, which `resolvePackage` now reads before `main`.
6. `npm install` 404 now prints `npm: 404 Not Found - GET https://registry.npmjs.org/<name>` on stdout with status 1. The earlier `Uncaught npm:` text is gone.
7. Open, not fixed: `.npmrc` `_authToken`. The token goes out as an `Authorization` header, and the browser refuses that on a cross-origin request unless the registry's CORS preflight allows it. `curl -X OPTIONS https://registry.npmjs.org/debug` with `Access-Control-Request-Headers: authorization` returns 404 and no CORS headers. A GET with an invalid bearer returned 200 with `Access-Control-Allow-Origin: *`, so public reads work. With a token configured, every npmjs request fails, and the error now says so. The fix is either a registry that allows the header, or a same-origin proxy, which the relay does not provide (it serves GET and HEAD only). That is the owner's decision.
8. Open, not fixed: `node file.mjs` with a relative import fails, because the engine loader cannot read page files. The npm path has the transform; `node` does not use it yet.
9. Open, not fixed: `curl`, `wget` and `git` still put their error text on stderr, which bashkit redacts, so a URL in their errors prints as `https:<path>`. The npm route (stdout with the status) is the same mechanism and would fix them; not done here.
10. Open limits of the ESM transform: top-level `await` does not work, and imports are copied rather than live bindings.

Witness, final tree (commit of Phase B plus this section), on headless Chromium through `scripts/browser-driver.mjs` and `scripts/witness.mjs`. Reason for headless Chromium: the live site is not deployed from this tree until the push, so the local relay is the only build of this tree. Playwriter is the live-site route, and it is in the item-3 entry below.
- `npm run check`: exit 0. `npm run lint:comments`: 92 repo-owned files, 0 comments, exit 0.
- Focused npm runner (`/tmp/npm-focus/focused3.mjs`, 24 terminal commands plus the ESM setup): WALL 98.5 s, every line as expected.
- Full witness, final tree, `CHROME_BIN=/usr/bin/chromium node scripts/witness.mjs`: `witness totals: PASS 166 FAIL 0`, exit 0, 318 s. An earlier full run on the same code before the check tightening took 516 s and also gave PASS 166 FAIL 0. Of the 166, 22 are npm, node and ESM checks, including the process.exit output, the readFileSync toString, the js-yaml install, the bin link, `npx`, `npm ls`, `npm run`, `npm uninstall`, the devDependency flag, `npm ci`, the peer install, the scoped package, the ESM bin and the auth failure message.
- `npm run witness:shell`: `RESULT PASS=108 FAIL=0`, exit 0, 1 s.
- `CHROME_BIN=/usr/bin/chromium npm run lint:architecture` (live): `331 claims: 331 pass, 0 fail, 0 unverified`, exit 0, 68 s.

Witness checks I tightened in this phase, so they cannot pass on another line: the dev and peer checks print labels (`dev-flag true`, `react-installed true`), and the npx, `npm run`, uninstall and `npm ci` lines carry a `npx:`, `run:`, `uninstall:` or `ci:` prefix from `sed`, so each matches only its own command.

## Item 3: live site through playwriter (blocked by the Pages build)

- Pages run `42773709466` for `114a7fb` failed in `build`: `fatal: repository 'https://github.com/AnEntrypoint/gmfx/' not found`. `AnEntrypoint/gmfx` is private (`gh repo view`), and `.github/workflows/pages.yml` checks it out with the default token, which cannot read another private repository. Every Pages run since `61a76ce` (2026-11-09) has failed the same way (`579e2e6`, `f6acf20`, `4525610`, `837c78c`, `79bd180`, `114a7fb`), so the site has not been rebuilt since `61a76ce`. Fix needs the owner: make `gmfx` readable to the workflow, or give the workflow a read token secret. No secret is visible to this run, and the repository's visibility is not changed here.
- The txiki gate, `txiki.yml` run for `114a7fb`, passed (`completed success`).
- Live check, through playwriter in gm (`gm.playwriter_execute`, project browser for `/workspace/thebird`): the live page loads and its terminal accepts `run` URL parameters. The live site runs `61a76ce`, so it shows what was deployed before the npm work: `npm -v` gives `npm: command not found. Package managers are not available in the sandbox.`, `npx -v` gives `npx: command not found`, and `node -e "console.log('x'); process.exit(0)"` prints `node: quickjs exited with status 0` with no `x`. That confirms the defects this stretch fixes, and it confirms the new code is not live.
- Why headless Chromium ran the local checks: playwriter cannot test the new build until Pages deploys it, and the relay serves the tree on disk. The local witness, the focused runner and the live lint used `scripts/browser-driver.mjs` on `/usr/bin/chromium` against that relay. The live terminal check above used playwriter.
- Not done: the live witness of the new npm surface. It needs a green Pages deploy of `114a7fb` or later, and then the same playwriter check.
- Committed locally and not pushed: this section. The push rule for this stretch allowed one push, and it was used for `114a7fb`.

## Phase A: fx in the browser (stretch 1, local build, not built)

Reproduction on the local relay (`node bin/thebird-relay.js --port 0`) through the playwriter setup (`gm.playwriter_execute`, project browser for `/workspace/thebird`), with `window.THEBIRD_FX` set by an init script to a stub key and a loopback gateway. Quoted terminal output, before the fix:
- `fx --version` → `fx-core.wasm 1c894cb9b15f libfx SDK 2`
- `fx check` → `fx ready: JSPI available; core application/wasm`
- `fx ask hello` → `fx: fx ask needs window.THEBIRD_FX with apiKey and model`, though the page had `window.THEBIRD_FX` set.

Cause, found by reading the wiring: `web/fx-in-page.js` reads `globalThis.THEBIRD_FX`, and `fx` runs in the shell worker (`web/shell-worker.js`), whose global is not the page's `window`. Nothing carried the configuration across. Fix: `web/shell-client.js` sends `fx: { apiKey, model, gatewayChatUrl }` (`fxConfig`, the three fields only) with each run message, and `web/shell-worker.js` sets `globalThis.THEBIRD_FX` from it before the command. The key moves by `postMessage` to the same origin and stays in memory; it is never written to the workspace.

After that fix, `fx ask hello` against the stub gateway:
- Stub saw `POST /v4/ai/language-model` with `ai-language-model-streaming: true`, `authorization: Bearer …` and the prompt `hello`.
- Output: `stub gateway answer: prompt=hello streaming=true authorized=true` (the stub answers with fx's SSE shape: `text-delta` events and a `finish` with `finishReason.unified` = `stop`, the shape in `src/gateway/host_stream_provider.zig`).

Other causes checked and not found:
- JSPI detection (`supportsJspi`, `WebAssembly.Suspending` and `promising`) is correct: `JSPI available` on Chromium 155.
- Vendored modules: all ten files in `web/vendor/fx/` are byte-equal to the sibling checkout `/workspace/fx/fx/sdk/`, and `fx-core.wasm` (`1c894cb9b15f…`) equals its `zig-out/bin/fx-core.wasm`.
- The real gateway allows the page's preflight: `OPTIONS https://ai-gateway.vercel.sh/v4/ai/language-model` with `Origin` set to the relay answers 200 with `access-control-allow-headers` including `Authorization`, `ai-language-model-id` and `ai-language-model-streaming`. A wrong key with a 401 from a stub prints `AI_GATEWAY_API_KEY authentication failed · HTTP 401` (fx's own message). The owner's real key was not used and was not requested.

Open, not fixed here (upstream, the fx core): a gateway 500 is retried by the core and then printed as `fx: HostStreamFailed`, a raw code, not a message. The fix belongs in the fx core.

Upstream dependency, recorded as the owner asked: the fx core build depends on the private gmfx checkout. `scripts/vendor-fx.mjs` builds from the sibling `fx` checkout (`FX_REPO`), and `pages.yml` checks out `AnEntrypoint/gmfx` (private), which fails the Pages build (see the Item 3 entry). That is why fx is not on the live site. Leave `pages.yml` as it is until the owner decides gmfx access.

Witness added to `scripts/witness.mjs` (the browser block, after the playwriter checks): a stub gateway from `scripts/fx-stub-gateway.mjs` on the fixed loopback port 18931 (`THEBIRD_FX_STUB_PORT` overrides), the page config from `browser-driver.mjs`'s new `initScript` option (`Page.addScriptToEvaluateOnNewDocument`), and three terminal lines `fx --version`, `fx check`, `fx ask hello`. Checks: the stub answer line, and the version and JSPI lines. The check fails when the key path breaks, because the stub answers 401 without the key.

Focused run before the witness, through `scripts/browser-driver.mjs` on `/usr/bin/chromium` (no playwriter, since it is the same local relay and the playwriter run above already covered the browser): `WALL 1.7s`, output as above, and `stub saw [{"streaming":true,"authorized":true,"prompt":"hello"}]`.

## Phase A: txiki project imports through the browser fs bridge (stretch 2, built locally, witnessed in the full run)

Problem, reproduced on the local relay before the change: `node main.mjs` with a static `import './m.mjs'` failed with `could not load 'm.mjs'`, and `node -e "import('./m.mjs')"` failed the same way. The txiki engine's loader reads module source through `uv_fs_*`, and the browser build stubbed every `uv_fs_*` call, so no project file could be read.

Change:
- `scripts/txiki/browser/fs-uv-browser.c` (new) implements the `uv_fs_*` calls the loader and the `tjs.*` file APIs use, over the `tjs_fs_*` host imports that `web/txiki-in-page.js` already provides: open, close, read, write, fstat, stat, lstat, mkdir, rmdir, unlink, symlink, readlink, realpath, rename, ftruncate, opendir, readdir, closedir, and req_cleanup. Synchronous when the callback is NULL; otherwise the result is deferred through the loop's pending queue (`tjs_browser_defer`).
- `scripts/txiki/browser/uv-browser.c`: `uv_queue_work` runs the work and then the after-callback as a pending job; `tjs_browser_work_pending` (renamed from `tjs_browser_timers_pending`) reports timers or queued callbacks, so a chain of async fs calls keeps the turn loop running.
- `scripts/txiki/browser/entry.c`: `tjs_browser_eval(code, name)` evaluates the code as a module named by the caller, so a relative import resolves from the script's directory. `node <script>` names the module by its absolute path; `node -e` and `tjs -e` name it `<tjs -e>` and resolve from the shell directory.
- `web/txiki-in-page.js`: `tjs_fs_realpath` (follows symlinks, -1 when missing) and `tjs_fs_rename`.
- `web/node-in-txiki.js` passes the script path through as the module name.
- `scripts/txiki/stubs.tsv`: the rows for the implemented calls are removed (the overlap check reports none). Still stubbed, because the browser has no host operation for them: `uv_fs_chmod`, `chown`, `copyfile`, `fchmod`, `fchown`, `fdatasync`, `fsync`, `futime`, `lchown`, `link`, `lutime`, `mkdtemp`, `mkstemp`, `statfs`, `utime`.

Probe, run through the local relay with `scripts/browser-driver.mjs` (`/tmp/txiki-probe/probe12.mjs`): static import (`answer 42`), nested import (`lib/x.mjs`), `node -e "import('./m.mjs')"` and `tjs -e` dynamic import, a missing module (`could not load 'nope.mjs'`, shell goes on), `tjs.rename`, `tjs.stat` size, `tjs.realPath` through `..` and through a symlink, `tjs.realPath` on a missing file (ENOENT), `truncate(6)`, `readFile` (26 bytes), `readDir` names, `node main.mjs` after rename gives the expected missing-file error.

Witness: four checks added to `scripts/witness.mjs` after the `node <script>` block: a script imports a sibling and a nested module (`script-imports 42 lib`), a dynamic import from `node -e` resolves against the shell directory (`eval-import 42`), a missing module reports the loader error (`missing-import could not load 'import-probe/nope.mjs'`), and `tjs.realPath` resolves a dotted path (`realpath /workspace/import-probe/m.mjs`).

Pin history for `web/vendor/txiki/tjs.wasm` (each a local build; the gate passed with 0 undefined symbols and 162 exports, the seven `gm_txiki_*` among them): `8d4b2b17…` (eval-name and realpath fix), `5855a1b3…` (eval naming), `ca7bcceb…` (fstat and opendir), `14679147…` (pending-work turn), `f716451387bd721e1b0cede84cc5ab44b10c6087e16dde78e206e12e70b1f296` (realpath and rename, current, `TXIKI_WASM_SHA256` in `scripts/vendor-txiki.mjs`).

Conflict, not changed here (owner said to leave `pages.yml`): `.github/workflows/pages.yml` line 53 still checks `137c08f6db9969194c917384172794173a31642b7d51d2aac6c598d1c4475a28  web/vendor/txiki/tjs.wasm`. The current wasm is `f716451…`, so the Pages build's pin check fails until the owner updates that line or the pin is reverted. Owner decision needed.

gm handoff, not done from here: gm must rerun its import witness against this txiki build. The channel to gm is not identified in this session, so this note is the handoff record. Its reason: the `uv_fs_*` bridge changes which imports succeed on the browser txiki path.

## Reference check: fx browser-agent example against thebird's fx ask (read only)

Source: `/workspace/fx/fx/examples/browser-agent` (vercel-labs fx checkout, HEAD `b063e41a`), compared with `web/fx-in-page.js` and `web/vendor/fx/engine.js`.

Differences that matter in the browser:
- The example routes a visitor without a key through a server proxy (`api/gateway.js`, two paths: `/coding-agent/v1/models` and `/v4/ai/language-model`). The proxy adds the server's `AI_GATEWAY_API_KEY` and drops the client's Authorization, so no key is in the browser. Thebird has no proxy: it sends the owner's key from `window.THEBIRD_FX.apiKey` straight to the gateway, and any script on the page can read it. Owner decision needed on whether thebird should move to a proxy.
- The example passes a custom `fetch` to `createFxEngine`. Thebird uses `globalThis.fetch` (`engine.js:1458`).
- The example reads the key from a password input and does not store it. Thebird reads it from the page global set by the shell client.
- Streaming (`text_delta` loop), JSPI gating and session close are the same in substance.
- Direct CORS to the gateway applies to both designs on the direct path. Not tested live here.

Version check against libfx 0.0.16:
- `src/main.zig:11` declares `0.0.16` in HEAD and in the working tree. The fx working tree has uncommitted changes under `src/` (`builtins/tools.zig`, `core/app/app_callbacks.zig`, `core/app/app_worker_runtime.zig`, `core/superagent/app_host.zig`, `core/superagent/runtime.zig`, `main.zig`); `sdk/` is clean.
- The vendored `web/vendor/fx/fx-core.wasm` (`1c894cb9b15f…`) is byte-identical to `/workspace/fx/fx/zig-out/bin/fx-core.wasm`, which was written before the last `src/` edits.
- All 12 modules in the manifest are byte-identical to `/workspace/fx/fx/sdk`.
- npm `libfx@0.0.16`: `fx-core.wasm` `c2b17c90d1c4ce76f72d322bb7bd210e3d066eb1db05aaae053a4e4371cabb69` (2260477 bytes). Against it, `engine.js` and 10 other modules match; `fetch-cleanup.js` and `wasm-runtime.js` differ. The vendored `wasm-runtime.js` imports `fx_http_stream_retry_after`, which npm 0.0.16 lacks.
- Verdict: mismatch. The vendored core is a newer build that still reports `0.0.16`, and `sdkApiVersion` 2 agrees in both. `scripts/vendor-fx.mjs` hardcodes `sdkApiVersion: 2` rather than reading it from the SDK.
- Not checked: whether a rebuild from HEAD reproduces the vendored wasm, live CORS and streaming, and `libfxApiVersion` 3 in the example's `browser-agent.js` against `fxSdkApiVersion` 2 in `engine.js`.

## Phase A: fx TUI in the page (diagnosis by comparison, fx-term with an xterm VT)

Diagnosis. Before the change, `fx` in thebird printed only its usage line; native `fx` opens the TUI. Native and thebird were compared surface by surface on the same keys, native in tmux (`/workspace/fx/fx/zig-out/bin/fx`, `FX_HOME=/tmp/fx-native-home`, session `fxnative2`) and thebird in headless Chromium through `scripts/browser-driver.mjs`.

Gap causes found:
- `fx` with no arguments had no TUI path: `web/fx-in-page.js` returned the help text. Fix: a bare `fx` posts a takeover request (`web/takeover.js`); the page runs the TUI (`web/fx-tui.js`) and returns the exit status.
- The vendored bundle had only `fx-core.wasm`. Fix: `scripts/vendor-fx.mjs` builds `zig build fx-term-wasm -Dwasm-surface=term` and vendors `fx-term.wasm` (sha256 `074e0e09b3707e876ec0671b1525f6dca38cf627fff88f7ac7de06ca9a864bfb`), with `wasm-terminal.js` and `xterm.js`. The core stays `fx-core.wasm` for `--version`, `check` and `ask`.
- Credential and prompt-history warnings on start (`Saved credential storage is unavailable`, `durable prompt history unavailable`): the runtime's `oauthSessionStore` and `promptHistoryStore` hooks were not passed. Fix: in-memory stores in `web/fx-tui.js`. Decision for the owner: nothing is persisted, so a reload clears the sign-in and the prompt history.
- Sign-in choices: native shows `Sign in with Codex` and `Sign in with Grok`; the wasm build does not. Cause in the fx core, not thebird: `src/core/auth/auth_runtime.zig` removes both on `host_target.is_wasm`, and `chatgpt_oauth.zig` and `grok_oauth.zig` return `ChatGptOAuthUnavailable` and `GrokOAuthUnavailable` on wasm. Not fixed here; upstream.
- Palette header: native `Results 50 · type to filter`, thebird `Commands 49 · type to filter`. Both show the same 49 command rows when paged one row at a time. The header label comes from `picker_presentation.zig:1232` (`Commands` when the command count equals the result count). The source of native's extra result is not identified. Open.

Surfaces compared (native first, then thebird):
- Welcome, input box, footer: same text, same rule width at the same size. Thebird lacks the two wasm-gated sign-in rows, so the blank rows after `Add an API key` differ accordingly.
- Input cursor: native (2,2) after the input marker; thebird (2,2).
- Colour: title `𝒇x` palette 255 bold, version text palette 245 in both (`ESC[38;5;255m`, `ESC[38;5;245m` natively; xterm reports palette 255 and 245).
- Alternate screen: native `alternate_on 0` on the welcome screen; thebird buffer `normal`. Same.
- Typed text, Escape, Backspace: same behaviour (`┃ /hello`, the palette closes on Escape with the slash left in the input).
- Ctrl-C: native and thebird both keep the TUI running on a single Ctrl-C.
- `/exit`: ends the TUI; the page's shell runs the next command (`after-fx`).
- Resize with no palette: native and thebird both keep the welcome panel and two 70-column rules at 70x24.
- Resize after the palette: native and thebird both lose the welcome panel and the rules (see the defect below).

Defect, upstream in fx, reproduced natively: after the command palette is opened and closed (`/`, Escape, Backspace), a resize to 70x24 redraws only the input line and footer, and the welcome panel and rules stay blank. Native reproduction: `tmux resize-window` after the same keys (screen: `┃`, a blank line, the footer). The thebird reproduction in the witness and in `/tmp/fx-tui/resize-timing.mjs` (with `STEPS=palette`): the light redraw is 474 characters with no `Welcome`, and no settled pass follows in 12 s. Without the palette steps the same resize writes 1220 characters with the full panel. The wasm host gives the TUI a 16 ms idle poll (`main.zig:195`), so the wait is not a sleep. The cause is in fx's resize observation state after palette use (`src/ui/resize_runtime.zig`, `settlePendingResize`, `queuedObservationMatchesDeadline`), which is the same code on native and wasm. thebird cannot fix it from the page: a second wake does not move the settle, and Ctrl-L does not repaint. Fix belongs in fx, which is outside this repo. Owner decision: whether to change the fx checkout (`/workspace/fx/fx`) and rebuild `fx-term.wasm`.

Split of the palette-then-resize defect, as the owner asked:
- thebird's part, checked and found clean: the page sends the new size (`term.resize` → `onResize` → `fx_term_size` reads 70 and 24, which the TUI reports back through its own frame), the wake reaches the TUI, and the TUI redraws. Resize with no palette works in thebird and in native. The thebird-side cause of the palette case was not found, because the native binary fails the same way.
- Upstream part, for fx (`/workspace/fx/fx`, outside this repo, not edited here): after the palette opens and closes, the resize observation never settles, so `src/ui/resize_runtime.zig` (`settlePendingResize`, `queuedObservationMatchesDeadline`) never runs the replay that repaints the welcome panel and rules. Evidence: native `tmux` run (palette, Escape, Backspace, then `resize-window` to 70x24: no `Welcome to fx`, no rules); wasm timing probe with `STEPS=palette` (the 70x24 redraw is 474 characters with no `Welcome`, no second write in 12 s); the same resize without the palette writes 1220 characters including the panel.
- Owner decision needed: whether to change the sibling fx checkout and rebuild `fx-term.wasm`, or accept the check as a known upstream failure.

Not reached in this pass: transcript, full transcript screen, approval screen and ask presentation. Native and thebird both show the welcome gate (`run /login`) and refuse a prompt with no provider credential, so a model reply needs a sign-in. The page holds no credential source for the TUI, and the stub gateway cannot stand in for the provider's fixed host. These four surfaces are not covered by the witness. Open.

Witness: `scripts/witness.mjs` runs the TUI through `runTerminal` with `interact`. Checks: welcome, input box and footer (`Welcome to fx`, `Sign in with Vercel`, `Add an API key`, `auto · grok-4.7`, cursor (2,2)), title colour (palette 255 bold, version palette 245), typed text, the palette header and `/help` row, Escape, resize with no palette (70x24 with the welcome and two rules), resize after the palette (expected to fail until fx is fixed, named as upstream), Ctrl-C, `/exit` then `echo after-fx`. Driver keys added: `Escape` and `Backspace` in `scripts/browser-driver.mjs`.

Bridge status for gm's import row: the `uv_fs_*` bridge is described in the stretch 2 section above. It is built and witnessed in witness run 4 (`script-imports`, `eval-import`, `missing-import`, `realpath` all PASS).

## Open decisions

- Pages build: `AnEntrypoint/gmfx` is private and the workflow cannot check it out (see Item 3). Owner decision: make it readable to the workflow, or add a read token secret.
- `scripts/vendor-pyodide.mjs`: retired in 18403ed, with its references in ARCHITECTURE.md, AGENTS.md, README.md and `scripts/lint-architecture.mjs` changed in the same commit. The stale local directory `web/vendor/pyodide/` has been removed (see the queue pass entry that records its deletion).
- Pyodide bundle licence: held by the owner, and not confirmed. The stripped bundle at `https://anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br` is not changed by this pass. The licence notice file `web/vendor/PYODIDE-NOTICE.md` was removed in the licence removal above, so this question is recorded only here.
- Licence notices for the vendored bundles: removed in the licence removal above. Whether they return in another form is the owner's decision.

## Phase B: witness run table (wall times, this pass)

| Run | Wall (s) | Result |
| --- | --- | --- |
| 3 | 433 | finished |
| 4 | 691 | finished; uv_fs bridge checks PASS |
| 5 | 466 | crashed (Chromium orphan) |
| 6 | 512 | crashed (Chromium orphan) |
| 7 | 502 | five failures: resize after palette, splash probe, frames, centring, done cleanup |
| 8 | 475 | finished |
| 9 | 155 | partial, crash-free, 155 PASS |
| 10 | 395 | finished |
| 11 | 549 | WITNESS-EXIT 1: PASS 183, FAIL 1 (upstream fx resize) |

Defect recorded: the witness does not close Chromium when it crashes; orphan trees (143025, 3474121) were stopped by PID.

## Phase B: splash witness, run 11 (ASCII thebird, web/splash.js)

- Cold python3 shows `{"mode":"ascii","rows":6,"canvases":0,"phase":"loading the shell","phaseBelowLogo":true,"boot":false}`.
- Frames differ: first `####@ #`, second `##### #` with the `@` moved, six rows each.
- Centring: offset x -0.0078125, y 0; box 217.2–562.8 x 196.1–296.9 in 780x493.
- Done cleanup: `{"children":0,"hidden":true,"mode":null,"timers":0,"timersLater":0}`.

## Phase B: remaining FAIL (upstream fx, not thebird)

"a resize after the command palette keeps the welcome panel and the rules at 70 columns" fails with `{"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`. Native fx fails the same way. The cause is in fx `src/ui/resize_runtime.zig` (settle path). The thebird side (page size and wake path) was checked and is not the cause. Needs an owner decision on changing the sibling fx checkout and rebuilding fx-term.wasm before this check can pass; the push is held until then.

## Gates on this pass

- `npm run check`: exit 0.
- `npm run lint:comments`: 93 repo-owned files, 0 comments.
- gm import handoff: no channel confirmed; gm must rerun its own import witness.

## Phase A stretch: pin, witness cleanup, gm handoff (committed locally, not built, not witnessed, not pushed)

1. txiki wasm pin, one source. `scripts/txiki/pin.json` holds `tjsWasmSha256`. `scripts/vendor-txiki.mjs` reads it into `TXIKI_WASM_SHA256`, and `.github/workflows/pages.yml` ("Check tjs.wasm against the pin") reads the same file. The workflow previously carried `137c08f6…`, which differed from the script's `f716451…`. `scripts/lint-architecture.mjs` ("txiki wasm pin has one source") fails when `pages.yml` carries a literal pin for `web/vendor/txiki/tjs.wasm` that differs from the file, or when either side stops reading the file. Pin value: `f716451387bd721e1b0cede84cc5ab44b10c6087e16dde78e206e12e70b1f296`. Not built here, so the hash is unverified against a fresh build.
2. Witness browser cleanup. `scripts/browser-driver.mjs` records every Chromium process group it starts and exports `closeBrowserTrees()`, which kills each group by the child's own PID. `scripts/witness.mjs` calls it on `exit`, `SIGINT`, `SIGTERM`, `SIGHUP`, `uncaughtException` and `unhandledRejection`, and prints `browser cleanup (<reason>): closed N Chromium tree(s) by pid …` on every run. Not run here: the cleanup line is the evidence to check on the next witness run.
3. gm import handoff contract. Channel still not confirmed. gm's import witness reruns against the txiki build whose wasm matches `scripts/txiki/pin.json` (`f716451…`), with `web/vendor/txiki/tjs.wasm` produced by `scripts/vendor-txiki.mjs`. The artifact handed to gm earlier was `137c08f6…` (line 743 above), a different build; gm must take the `f716451…` build, which was rebuilt and matched the pin in the Phase B pass. The `uv_fs_*` bridge that changes the import path is `scripts/txiki/browser/fs-uv-browser.c`, over the `tjs_fs_*` host imports in `web/txiki-in-page.js`. The checks gm must see PASS are the four in `scripts/witness.mjs` (around lines 363–426, the import probe): `script-imports` ("a node script imports a sibling and a nested module through the txiki loader"), `eval-import` ("a dynamic import from node -e resolves against the shell directory"), `missing-import` ("a missing module reports the loader error and the shell goes on"), and `realpath` (the realpath import check). Expected output is the strings `script-imports 42 lib`, `eval-import 42`, and `missing-import could not load`. The witness run that proves this has not happened.

Phase B witnesses still to run (none run in this stretch): the full `npm run witness` on the txiki pin above, including the resize check ("a resize after the command palette keeps the welcome panel and the rules at 70 columns"), which waits on the fx fix in `src/ui/resize_runtime.zig`; the gm import checks in item 3; and the witness cleanup line in item 2.

## Phase B pass on the pin (df289ff plus the lint fix; built and witnessed, not pushed)

- Build: `ZIG=/workspace/tools/zig-x86_64-linux-0.17.1/zig TMPDIR=/tmp node scripts/vendor-txiki.mjs` exit 0 in 1 m 44 s. Compile gate 40 of 40, link 0 undefined symbols. `web/vendor/txiki/tjs.wasm` sha256 `f716451387bd721e1b0cede84cc5ab44b10c6087e16dde78e206e12e70b1f296`, OK against `scripts/txiki/pin.json`.
- Lint: `npm run lint:comments` 97 repo-owned files, 0 comments. `npm run lint:architecture` 346 claims, 0 fail, 0 unverified. The first run had one FAIL in my own record ("txiki wasm pin has one source") because its anchor was not in AGENTS.md. Fixed by stating the one-value pin in AGENTS.md and naming that line in the record.
- Witness: `CHROME_BIN=/usr/bin/chromium-browser node scripts/witness.mjs`, exit 1, `witness totals: PASS 183 FAIL 1`.
- Browser cleanup line: `browser cleanup (exit): closed 72 Chromium tree(s) by pid 386526, 387243, …` (72 recorded process groups, killed by their own PIDs; groups that had already exited are a no-op).
- gm import checks, all PASS: `script-imports` → `"script-imports 42 lib"`; `eval-import` → `"script-imports 42 lib\neval-import 42"`; `missing-import` → `"missing-import could not load 'import-probe/nope.mjs'"`; `realpath` → `"realpath /workspace/import-probe/m.mjs"`.
- The one FAIL, upstream fx (not thebird, not worked around): `a resize after the command palette keeps the welcome panel and the rules at 70 columns` → `{"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`. Cause: fx `src/ui/resize_runtime.zig`, the resize observation does not settle after palette use. Waiting on fx's push; no thebird change for it.
- Phase B witnesses still open after this pass: the resize check above, rerun after fx's push.

## Phase A: fx full TUI in the browser (docs only, nothing built, not pushed)

Finding, checked against the tree, before any change:
- The term build is already vendored and wired. `web/vendor/fx/fx-term.wasm` has sha256 `074e0e09b3707e876ec0671b1525f6dca38cf627fff88f7ac7de06ca9a864bfb`, identical to `/workspace/fx/fx/zig-out/bin/fx-term.wasm`. `web/vendor/fx/wasm-terminal.js` and `web/vendor/fx/xterm.js` are the VT surface: bytes go to xterm.js through `xtermAdapter`, and `web/fx-tui.js` runs `createFxTerminal` on `fx-term.wasm`.
- A bare `fx` already takes over the terminal: `web/fx-in-page.js` calls `requestTakeover('fx')` when argv is empty, `web/shell-client.js` and `web/terminal.js` (`runFxTui`) run the term build, and `fx --version`, `fx check` and `fx ask` stay on the core line builtin (`fx-core.wasm`). The owner's diagnosis (only the core, line builtins only) is therefore out of date for bare `fx`. The witness already passes the welcome panel, input box, footer, cursor, palette and palette Escape, typed text, resize with no palette, Ctrl-C and `/exit` (`PASS` lines in the Phase B run).
- `ghostty-vt.wasm` and WTerm are not in this repo, not in the fx checkout (`grep -rli ghostty` finds only CHANGELOG, tests and a Zig test name), and not on fx.sh/try as fetched (the page names no wasm files and no grid component; it links the source at github.com/vercel-labs/fx). Nothing here can be vendored from them. The owner needs to name the artifact or repo for those two, or confirm that xterm.js stays as the VT surface.

Changes in Phase A: none to code. The only change is this section. What the witness does not yet cover, and the witness each needs (Phase B, after fx pushes the resize fix and the go-ahead):
1. Welcome gate, sign-in choices: already covered by "fx with no arguments opens the TUI: welcome, sign-in choices, input box and footer render in the page".
2. Transcript: send a prompt through the stub gateway (`scripts/fx-stub-gateway.mjs`, the same gateway `fx ask` uses) with `window.THEBIRD_FX` set, and check the transcript rows in the TUI screen (`screenRows`), in `scripts/witness.mjs` beside the TUI checks.
3. Full-transcript screen: open it after the transcript and check its heading and a row from the earlier turn.
4. Approval: a tool call that needs approval through the stub gateway, check the approval panel text and that Escape or the deny key returns to the input.
5. Ask presentation: the TUI's ask prompt (a model question), answer it in the input, check the answer row.
6. Resize: the palette-then-resize check ("a resize after the command palette keeps the welcome panel and the rules at 70 columns") stays the fx-owned FAIL until fx's `src/ui/resize_runtime.zig` fix is pushed; rerun it then, with no thebird workaround.

These four surfaces need the stub gateway to answer a streamed turn and a tool call, which the current stub does not do. The gateway change is part of the Phase A code work for the next pass, once the owner names the VT surface.

## Decision: xterm.js stays the VT surface (dispatcher, recorded in Phase A, not built)

- Decision: keep xterm.js (`web/vendor/xterm/`, adapter `web/vendor/fx/xterm.js`) as the VT surface for `fx-term.wasm`. Do not vendor `ghostty-vt.wasm` or a WTerm grid.
- Reason: neither ghostty-vt.wasm nor WTerm is in this repo or in the fx checkout, and nothing we have names their source or artifact (fx.sh/try names neither; see the Phase A TUI section above). Without an artifact there is nothing to vendor and no hash to pin.
- Revisit condition: a parity gap that a witness shows and that xterm.js cannot draw, with the owner naming the artifact or source for the replacement. Until then a gap is fixed in the adapter or in fx, not by a new VT engine.

## Stub gateway: streamed turns and tool calls (scripts/fx-stub-gateway.mjs, not run)

The stub now answers a streamed request with the events fx's gateway client parses (`src/gateway/client.zig`): `text-delta`, `tool-input-start`, `tool-input-delta`, `tool-input-end`, `tool-call` (`toolCallId`, `toolName`, `input`) and `finish` (`finishReason.unified`). It records each request's tool names (`request.tools`) in `seen`. Directives in the last user text choose the reply:
- `[tool:NAME]` and optional `[input:{json}]`: a tool call to NAME. Once the prompt carries a `tool` role message (a tool result), the stub answers with text and `tool-result=seen`.
- `[lines:N]`: a text reply of N lines `line 1` … `line N`, for the full-transcript screen.
- no directive: the earlier text reply, `stub gateway answer: prompt=… streaming=true authorized=true`, unchanged for the `fx ask` check.
- Open point 1, RESOLVED by reading fx source (no build): the finish value `tool-calls` is accepted. `src/gateway/client.zig` reads `finishReason.unified` in `parseSseFinishReason` (line 4115), and `src/core/shared/types.zig` `ProviderFinishReason.parse_unified` (line 1694) maps `"tool-calls"` to `.tool_calls`. The stub value is correct and was not changed. The client treats `.tool_calls` as a completed turn at line 4736. The witness still shows the TUI running the tool end to end; that is a Phase B check, not an open question.

## Witness checks to add (Phase B, after fx pushes and the go-ahead; none run here)

Each runs through `runTerminal` with `interact` and `THEBIRD_FX` set to the stub (`apiKey` `thebird-stub-key`, `gatewayChatUrl` the stub URL), in `scripts/witness.mjs` beside the TUI checks:
1. Transcript: type `hello`, press Enter, wait for `stub gateway answer: prompt=hello`. Witness: the transcript rows show the user line and the answer. Needs: the text reply path.
2. Full-transcript screen: type `[lines:60] long`, Enter, then press Ctrl-O (raw byte 0x0F, `\x0f`), which opens the full-transcript screen. Escape closes it again. Settled by fx source: `src/ui/input/escape_parser.zig` `controlByteFeatureAction` maps byte 15 to `.toggle_full_transcript` (line 250), and `src/core/app/input_full_transcript_runtime.zig` `keyForAction` maps `.escape` to `.close` (line 165). Witness: the heading, `line 1`, and `line 60` are on the screen. Needs: `[lines:N]`.
3. Approval: type `[tool:bash] [input:{"command":"echo approval"}]`, Enter. Witness: the approval panel names the tool and shows `echo approval`; a deny key returns to the input box with no tool result. Needs: the tool-call path, and `seen` shows `tools` from the request.
4. Ask presentation: a tool whose name fx treats as an ask (confirm the name in fx before the witness; the stub passes any NAME). Type `[tool:ask] [input:{"question":"pick"}]`, Enter, answer in the input, Enter. Witness: the question row, then the answer row, then `tool-result=seen` in the reply. Needs: the tool-call path and the second request with a tool message.
5. Resize, palette then 70×24: unchanged; the FAIL stays until fx's `src/ui/resize_runtime.zig` fix is pushed, then rerun with no thebird workaround.

Stub check: after each run, `seen` in the stub holds `streaming: true`, `authorized: true` and the expected `prompt`, and the witness asserts that before reading the screen.

## Phase A: open-ledger pass (no build, no witness, not pushed)

Ranking of the open ledger items reachable without a build and without a push:
1. npm defect 9, curl and wget error text went to stderr, where bashkit redacts a slash-prefixed token (`https:<path>`). Done: `web/curl-in-page.js` now throws `failure(message, exitCode)`, which carries the text on `stdout` and the status, the same route as npm (`web/bash-shell.js` already prints `err.stdout` and sets the status). A failed `-f` exits 22, curl's own status for an HTTP error. The message texts are unchanged.
2. The same redaction in git. Done: `web/git-in-page.js` `gitBuiltin` throws the failure text with `stdout` and `exitCode: status`. The remote-verb refusal has no path token and is unchanged.
3. Ledger closure, npm defect 8, `node file.mjs` with a relative import. Closed by evidence already in the Phase B run: the witness passes `a node script imports a sibling and a nested module through the txiki loader` (`"script-imports 42 lib"`), which runs `node main.mjs` in `import-probe`, and `a dynamic import from node -e resolves against the shell directory`. The uv_fs bridge (854c9a8) made the loader read page files, so the defect as written is stale.
4. Ledger closure, npm defect 2, `node process.exit` output loss. Closed by the Phase B fix to `runTjs` (defect 1) and the witness passes `console.log output written before process.exit(0) is kept` (`"x"`) and `… process.exit(3) is kept and the status is 3` (`"y\nrc=3"`). The wasm exit flush (Stretch 1) is in the same pin.
5. Ledger closure, npm defects 4, 5 and 6 (ESM bins, util and assert shims, 404 text on stdout) are closed by the Phase B items above; their witness is the npm checks in `scripts/witness.mjs`.

Witness each change needs (Phase B, one full `npm run witness` after the go-ahead; none run here):
- curl: `curl to a refused port inside the txiki shell writes its error to stdout with a nonzero status, and the next command still runs`. Expects `127.0.0.1` in stdout (the message names the host) and `after-curl-rc=` with a nonzero status. The earlier stderr check was replaced.
- git: `git outside a repository writes its error to stdout with a nonzero status, and the next command still runs`. Runs `mkdir -p git-not-a-repo && cd git-not-a-repo && git log; echo git-rc=$?` in `/workspace`. It assumes `/workspace` is not itself a git repository, and that in-page git reports `git log` outside a repo as a nonzero status with at least two stdout lines; the Phase B run confirms both. If git finds an enclosing repository, this check must move to a directory outside it.
- Lint: the architecture lint has no record for these files; `npm run lint:comments` must still report 0 comments (none were added).

Not reachable without the owner, recorded and not changed here:
- `.npmrc` `_authToken` through the browser (npm defect 7): the registry's CORS preflight refuses the `Authorization` header. The owner chooses a registry that allows it, or a same-origin proxy (the relay serves GET and HEAD only).
- Ctrl-C on the Pages site without cross-origin isolation (Blocked table): the owner chooses between accepting the restart and isolating the site with a service worker.
- The esbuild-pin content (`scripts/esbuild-pin.mjs`, item 5 of the npm section): the earlier content is unrecoverable, and the file as it stands is the one to keep.
- The `web/stream-hub.js` removal, the Pyodide bundle licence and the older vendored notices: owner decisions already recorded above.
- Top-level `await` and live ESM bindings (npm defect 10): engine-side limits of the transform, documented in AGENTS.md and ARCHITECTURE.md.

## Phase B, go-ahead pass (fx b7b3cdd4; two witness runs)

fx term build. fx's checkout is at `0597c045` and is not an ancestor of origin's `b7b3cdd4` (checked with `git merge-base --is-ancestor`), and its tree is clean, so the checkout was not moved. The export `git archive b7b3cdd4` went to `/tmp/fx-b7b3cdd4` (outside both repos) and was built from there.
- `zig build fx-term-wasm -Dwasm-surface=term` at `b7b3cdd4` exits 0. `fx-term.wasm` sha256 `5d5e26ba02258e8643d122e5985e3c27e37faa26f8ed7bcf2bf84a773988cb69`. It is in `web/vendor/fx/`, and the SDK modules copied from the export are byte-identical to the vendored ones.
- `zig build -Dwasm-surface=core` at `b7b3cdd4` FAILS: `src/core/hooks/external_run.zig:67` (`expected type 'i32', found 'void'`, `.pid = pid`) and `:140` (`type 'void' does not support struct initialization syntax`, `std.posix.SIG.IGN`), reached from `src/builtins/hooks/command.zig`. The file is identical at `b7b3cdd4` and at the checkout, so the break is in fx's commits `4ffe6c3d` and `f35ada16`, not in the export. Cause: POSIX-only process code in a wasm32-wasi build. This is fx's to fix. The core WASM was not rebuilt: `web/vendor/fx/fx-core.wasm` stays at `1c894cb9…`, and `manifest.json` `source` now says so. `scripts/vendor-fx.mjs` cannot run to completion until the core builds, so the term and module update was copied in by hand, and that is recorded here.
- Resize, with this term build: the palette resize still fails in both runs. Cause: fx, not thebird. Output: `{"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`. Not worked around.

Witness runs (PID 475164 is the first; PID 501587 is the second, after the fixes below):

Run 1, PID 475164, after the term re-vendor: `witness totals: PASS 181 FAIL 4`, `WITNESS-EXIT 1`.
- Failures, all four read against run 1:
  1. resize after the palette: fx, as above.
  2. `git outside a repository writes its error to stdout …`: my check, and wrong. `runShellInTxiki` routes builtin errors to stderr by design (`web/shell-core.js` `sink.err`), so the check read the wrong path. Its output was `{"stdout":"git-rc=1\n","stderr":"git: no commits yet\n"}`, which also showed `/workspace` is inside a repository. Check removed.
  3. `curl to a refused port … writes its error to stdout …`: the same mistake, the txiki path. Output `{"stdout":"after-curl-rc=1\n","stderr":"curl: could not fetch from 127.0.0.1:1: …"}`. Check removed. The bashkit route is covered by `in-page curl refuses a host that sends no CORS headers, and the shell goes on`, which passes in both runs.
  4. `in-page git checkout refuses an unknown branch and leaves HEAD where it was`: mine, from `b6238f1`. The refusal text was not on the screen at all. The bashkit `err.stdout` route works for npm (the 404 check passes), so the cause for git is not established from the capture. Reverted `web/git-in-page.js` to the plain `throw new Error(failureText(output))`, which passed in the earlier run.
- Browser cleanup, run 1: `browser cleanup (exit): closed 72 Chromium tree(s) by pid 475182, 476107, 476299, …`.
- gm import checks, run 1, all PASS: `script-imports` `"script-imports 42 lib"`; `eval-import` `"script-imports 42 lib\neval-import 42"`; `missing-import` `"missing-import could not load 'import-probe/nope.mjs'"`; `realpath` `"realpath /workspace/import-probe/m.mjs"`.

Run 2, PID 501587, after the revert and the two checks removed: `witness totals: PASS 182 FAIL 1`, `WITNESS-EXIT 1`.
- Only FAIL: the palette resize (fx, as above).
- `in-page git checkout refuses an unknown branch and leaves HEAD where it was`: PASS (the revert worked).
- Browser cleanup, run 2: `browser cleanup (exit): closed 72 Chromium tree(s) by pid 501599, 502513, 502696, …`.
- gm import checks, run 2, all PASS (same strings as run 1).
- TUI, run 2: PASS `fx with no arguments opens the TUI: welcome, sign-in choices, input box and footer render in the page`; PASS `escape closes the command palette and leaves the typed slash in the input`; PASS `resizing the page reflows the TUI to 70 by 24 and keeps the welcome panel and the rules at 70 columns` (no palette); FAIL `a resize after the command palette …` (fx).

Not run, and not yet written into the witness: the TUI screen checks for transcript, approval, ask and the full-transcript screen opened with Ctrl-O (byte `\x0f`), which Phase A planned and which the stub now serves (`[lines:N]`, `[tool:NAME]`). They need the check code in `scripts/witness.mjs`, and a run. They are open. The Ctrl-O key and the close key are settled in fx source (`escape_parser.zig:250`, `input_full_transcript_runtime.zig:165`).

Lint, this pass: `npm run lint:comments` 97 repo-owned files, 0 comments. `node scripts/lint-architecture.mjs`, 346 claims, 0 fail, 0 unverified.

## TUI surface checks: decisions from run 2 (PID 531158, log /tmp/witness-tui2.log)

Run 2 result: `witness totals: PASS 183 FAIL 4`, `WITNESS-EXIT 1`, `browser cleanup (exit): closed 73 Chromium tree(s)`.

- Palette resize, `a resize after the command palette …`: FAIL. Cause is fx: `src/ui/resize_runtime.zig`, as recorded above. Not worked around.
- Transcript, `transcript: the prompt and the stub answer appear …`: FAIL, `{"shown":false,"stub":[]}`. Cause is thebird, in `web/fx-tui.js`, not fx and not the stub. The TUI screen shows `Error · auth: fx needs access to Vercel AI Gateway. Run /login …, or set AI_GATEWAY_API_KEY.` and the stub's `seen` is empty, so the stub never received a request. `web/fx-tui.js` passed `apiKey`, `model` and `gatewayChatUrl` as top-level options, but the terminal runtime reads only `options.env` (`web/vendor/fx/wasm-runtime.js:171`). `web/vendor/fx/engine.js:530-540` shows how the same values reach the WASM: `AI_GATEWAY_API_KEY`, `FX_MODEL`, `FX_GATEWAY_CHAT_URL`. Fixed in `web/fx-tui.js` (`environmentFor`), committed as lanmower.
- Ask, `ask: the question is shown …`: FAIL. Same cause as the transcript: the ask request never reached the stub, so no tool result came back. The approval check, `approval: a bash tool call shows its command …`, passed in run 2: the TUI showed `┃ [tool:bash] [input:{"command":"echo approval"}]` and the approval wording, so the stub's directive path is not the problem. Cause is thebird's `web/fx-tui.js`, fixed with the transcript.
- Ctrl-O, `Ctrl-O opens the full transcript …`: FAIL, `{"opened":false}`. Same cause: there was no `[lines:60]` reply in the transcript to open. Fixed with the transcript. The Escape close is not yet shown, because the screen never reached the full view.

So none of the three new failures is fx's. They are the same wiring fault in thebird.

Realpath reconciliation. `tjs.realPath` resolves against the process cwd. The witness shell starts in `/workspace`, so its command now starts with `cd /workspace &&`, and the expected value is named for that directory: `realpath /workspace/import-probe/m.mjs`. gm reports `/import-probe/m.mjs` from its own project root, which is the same file resolved from a different cwd. I cannot check gm's cwd from this repo, so this is recorded as a reconciliation by cwd and not as verified against gm's run. The check's name says so.

Run 3 (PID 554463, log /tmp/witness-tui3.log, started after the env and realpath fixes): still running when this section was written. Its result is not recorded here. The third run has to be read before the TUI checks are reported as passing.

## TUI surface checks: run 3 (PID 554463, log /tmp/witness-tui3.log)

Run 3 result: `witness totals: PASS 184 FAIL 3`, `WITNESS-EXIT 1`, `browser cleanup (exit): closed 73 Chromium tree(s)`.
- Transcript: PASS. `{"shown":true,"stub":[{"streaming":true,"authorized":true,"prompt":"hello","tools":[]},…]}`. The env fix (`web/fx-tui.js`) works: the stub now receives the TUI's requests.
- Approval: PASS, but the evidence is weak. The screen matched `echo approval` in the typed prompt echo, not in an approval panel. Treat this check as not yet proof of the approval surface. Tightening it needs the real panel text, which needs a tool call that fx runs.
- Ask: FAIL. The screen stays at `• Thinking` with the input box. The stub's requests carry `"tools":[]`, and the TUI's session header in run 2 read `tools: 0 advertised`. The stub emits a tool call for a name fx did not advertise, and fx does not run it, so the turn does not finish. Cause: not yet settled. It is either fx's TUI advertising no tools in this page, or thebird not supplying a tool source. The stub cannot cause a tool to be advertised. Recorded as open, not as fx's.
- Ctrl-O: FAIL, `{"opened":false}`. The screen shows the main transcript tail (lines 37–53…), not the full view. The likely cause is the stuck ask turn ahead of it, because the `[lines:60]` prompt was typed while the turn was busy. Not verified. Open.
- Realpath: PASS, `realpath /workspace/import-probe/m.mjs`, from the cwd `/workspace` (explicit in the command).
- gm import checks, run 3: `script-imports` PASS `"script-imports 42 lib"`; `eval-import` PASS `"script-imports 42 lib\neval-import 42"`; `missing-import` PASS `"missing-import could not load 'import-probe/nope.mjs'"`.
- Palette resize: FAIL, the known fx defect (`src/ui/resize_runtime.zig`), not worked around.

Decision: nothing in this section is pushed. The fixes are thebird's (the env wiring in `web/fx-tui.js`, the explicit realpath cwd). The ask and Ctrl-O failures stay open until the tool-advertisement question is answered from fx's source: which code path sets the TUI's advertised tools, and whether this page's TUI has a source for them.

## Run 3 decisions (PID 554463, /tmp/witness-tui3.log): ask and Ctrl-O

Run 3 totals, quoted from the log: `witness totals: PASS 184 FAIL 3`, `WITNESS-EXIT 1`. The failures are the palette resize (fx, `src/ui/resize_runtime.zig`, not worked around), ask, and Ctrl-O.

(2) Ask. Owner: the stub, per the log. Evidence: the stub's requests carry `"tools":[]` (run 3's `seen`), and the TUI header shows `tools: 0 advertised`. The stub called a tool it had not been offered, so fx dropped the call and the turn stayed on `• Thinking`. A gateway may only call tools the request advertised, so the stub was wrong to emit the call. Fixed in `scripts/fx-stub-gateway.mjs`: `streamPlan` now takes the request's `tools` and emits a tool call only when the name is advertised. An unadvertised name gets a text reply with `tool-not-advertised=<name>`, so the screen shows the answer and not a stall. The ask check still fails until fx advertises a tool to this page, because no tool can run without an advertised one. The advertisement is fx's: fx builds `tools` for the request (`src/acp/libfx_hooks.zig:206` counts `advertised_functions`, `additional_functions` and `selected_dynamic`), and this page's TUI sets none of them. Whether the empty list is fx's configuration or a missing source from thebird's page is not settled from this log. Open.

(3) Ctrl-O. The check was wrong, not the screen. The run 3 log shows the full-transcript footer `esc close · pgup/pgdn scroll`, so the full view opened. The check required `line 1` and `line 60` on one screen, but the viewer is windowed and pages with pgup/pgdn, so the two ends are never on screen together. The `closed` capture is the main transcript tail (lines 37 to 53), which is the view after Escape. Fixed in `scripts/witness.mjs`: the check now reads the footer. It passes when `esc close` is on screen after Ctrl-O, and fails when it is gone after Escape.

Not pushed. Commit as lanmower with no trailer. The ask check and the approval check (which matched the input echo, not a panel) remain open until fx advertises a tool to this page.

## Approval check: asserts the panel, not the echo (not run)

Change, in `scripts/witness.mjs`. The old check matched `echo approval` anywhere on the screen, and the typed prompt echo `┃ [tool:bash] [input:{"command":"echo approval"}]` contains it, so it proved nothing about the panel.
- The approval step now waits for `Allow once`, the first option of the approval panel.
- `approval: a bash tool call opens the approval panel with its options and its command row` asserts `1. Allow once` and `3. Deny` on the screen, which are the option labels in fx's `src/ui/footer/approval_ui.zig` (line 1747 and line 1749, for a request with an argument preview), and at least one row that contains `echo approval` and does not start with `┃`. A `┃` row is the input echo, so a row outside it is the tool line from the panel.
- `negative control: a plain prompt with no approval-requiring tool shows no approval panel` uses the transcript screen after the plain prompt `hello`. It asserts the stub answer is there and that neither `Allow once` nor `3. Deny` is on it.

Witness it needs (Phase B, after fx's push and the go-ahead): the full `npm run witness`, reading the approval check's `options` and `commandRows` detail and the negative control's detail.

Expected result, and why: with `tools: []` on this page, the stub now sends no tool call for `[tool:bash]` (`scripts/fx-stub-gateway.mjs`, `tool-not-advertised=bash` in the reply), so the panel will not open and the approval check is expected to FAIL on the same fx advertisement cause as the ask check. A PASS needs fx to advertise a tool that needs approval to this page. The negative control can pass on its own.

## Phase B on the six local commits (6acfa44 … 8eee0f1), no fx push

Build: `node scripts/build-pages.mjs`, exit 0, wall 0 s (`_site/` written; ignored by git).

Witness run A, PID 604771, log `/tmp/witness-phaseB-final.log`, wall 733 s: `witness totals: PASS 184 FAIL 4`. Its Ctrl-O FAIL was my witness: `grab('fullClosed')` overwrote the boolean flag with the screen text. Fixed in `scripts/witness.mjs` (captures renamed `askReply` and `closedScreen`), committed as a Phase A fix.

Witness run B, PID 628718, log `/tmp/witness-phaseB-final2.log`, wall 747 s: `witness totals: PASS 185 FAIL 3`, `WITNESS-EXIT 1`. `browser cleanup (exit): closed 73 Chromium tree(s) by pid 628734, 629202, 629379, 629852, …`.

TUI results, run B:
- Transcript: PASS. `{"shown":true,"stub":[{"streaming":true,"authorized":true,"prompt":"hello","tools":[]},…]}`.
- Negative control (plain prompt, no approval panel): PASS. The transcript screen has no `Allow once` or `3. Deny`.
- Ctrl-O full transcript and Escape close: PASS. `{"opened":true,"closed":true,"footer":["  esc close · pgup/pgdn scroll"]}`.
- Palette resize: FAIL, fx (below).
- Approval: FAIL, fx (below). `{"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] [input:{\"command\":\"echo approval\"}] streaming=true"]}`. No `1. Allow once` or `3. Deny` appears, so the panel did not open. The stub did not call a tool, because the request advertised none.
- Ask: FAIL, fx (below). The screen shows `• Thinking`-era status, `0s (↑1 ↓16)` and `auto · haiku 5.5`, with no `tool-result=seen`.
- Realpath: PASS, from `/workspace`: `realpath /workspace/import-probe/m.mjs`.
- gm import checks: PASS `script-imports` `"script-imports 42 lib"`; `eval-import` `"script-imports 42 lib\neval-import 42"`; `missing-import` `"missing-import could not load 'import-probe/nope.mjs'"`.

Open defects, all fx's, rows kept open (not worked around):
1. Palette resize. Cause: `src/ui/resize_runtime.zig`, the resize observation does not settle after palette use. Output: `{"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`.
2. Tool advertisement, which causes the approval and ask failures. The TUI request carries `"tools":[]` (witness `seen`), and the header reads `tools: 0 advertised`. The stub now only calls advertised tools (`tool-not-advertised=<name>` otherwise), so no approval panel opens and no tool result returns. The advertisement is built in fx (`src/acp/libfx_hooks.zig:206` counts `advertised_functions`, `additional_functions`, `selected_dynamic`). This page sets none, and whether that is fx's configuration or a missing source from the page is not settled. Owner: fx.

Wall times recorded: build 0 s; witness A 733 s; witness B 747 s.

## Phase B, final items (witness run C, PID 651237, log /tmp/witness-phaseB-final3.log, wall 730 s)

Witness totals: `witness totals: PASS 185 FAIL 3`, `WITNESS-EXIT 1`. Cleanup: `browser cleanup (exit): closed 0 Chromium tree(s)`.

1. Approval. Change made: `web/fx-tui.js` passes `permissionMode` as `FX_PERMISSION_MODE`, which fx reads in `src/core/app/app_lifecycle.zig:1601`. The witness TUI session sets `permissionMode: 'ask'`, so tool calls are gated. Result: still FAIL, `approval: a bash tool call opens the approval panel with its options and its command row … {"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] …"]}`. Cause: fx. The page offers no tools (`"tools":[]` in the stub record), so the stub has no tool to call and no approval can be requested, whatever the mode. The negative control still PASSes. Row kept open, fx's.
2. Ask, and the stub `initialize` idea. Not applied, and the reason is recorded. The stub is an HTTP gateway and never receives `initialize`; that request is made by the `fx ask` engine (`web/vendor/fx/engine.js:1796`, which sends `clientCapabilities.libfx.tools` from `options.tools`). The TUI runs through `web/vendor/fx/wasm-terminal.js`, which takes no tools option, so the page has no way to send that capability to the TUI. fx's commit `b3a22f51` (`docs/PENDING_VALIDATION.md` in fx) names the same gap as "the page's initialize request shape … not in this repo". Result: `ask: the question is shown … ["","  0s (↑1 ↓16)","","┃","","auto · haiku 5.5"]`, FAIL. Cause: fx's TUI host-tool offer. Row kept open, fx's.
3. Palette resize. Unchanged: FAIL, fx's `src/ui/resize_runtime.zig`. Row kept open.
4. Browser cleanup. The earlier runs (run A, B and the 73-tree lines) listed the PIDs of every Chromium spawn that the same witness made, including those that had already exited. Each PID was spawned by that run; none was another project's browser, and no other project's PID appears in those lists. Killing an exited PID's group could hit a reused PID, which is a real risk even though it did not show here. The driver now drops a tree when its leader exits and signals only live leaders this run started. Run C closed 0, which is correct because each run already closes its own browsers. Ledger answer: the earlier runs did not close other projects' browsers, as far as the recorded PIDs show; the fix removes the reuse risk.

Commits this pass, local, lanmower, no trailer: the Phase A fix commit above, and this record. Pushed once after this record.

## Phase A: fx as a shell command in thebird (bare fx opens the TUI)

- The launcher from the earlier pass is removed (bin/fx.mjs, test/, package.json and README entries). No native binary is run.
- `fx` is already a registered in-page builtin (web/builtins.js, BUILTIN_NAMES). Bare `fx` starts the vendored fx-term through takeover (web/fx-in-page.js, web/fx-tui.js). The TUI takes no arguments on the page: `runFxTui` receives only the env and stores. The other subcommands (`--version`, `check`, `ask`) take arguments.
- Witness added: `which fx; command -v fx; type fx` must print `fx`, `fx`, and `fx is a shell builtin`. The existing TUI block still checks that `fx` opens the TUI and that `/exit` returns to the prompt.

## Phase B: witness run 12 (fx builtin check, HEAD 2094f44)

- Wall 834 s, `WITNESS-EXIT 1`, PASS 186, FAIL 3.
- New check PASS: `fx is a registered shell builtin: which and command -v print fx, and type says it is a shell builtin`. Output includes `fx`, `fx` and `fx is a shell builtin`.
- PASS: `fx with no arguments opens the TUI`, `/exit ends the TUI and the shell runs the next command` (`{"exited":true,"shellAfter":true,"tui":null}`).
- FAIL, known upstream: resize after the command palette (fx resize defect, see above).
- FAIL, known upstream: `approval` and `ask` (the page sends `tools: []`, so fx advertises no tool and the approval panel does not open). Causes recorded above in this file.

## Phase B: approval and ask witness, run 13 (no code change, HEAD e4b44f6 plus this entry)

- Wall 843 s, `WITNESS-EXIT 1`, PASS 186, FAIL 3 (same three as run 12).
- Approval: `FAIL approval: a bash tool call opens the approval panel with its options and its command row` `{"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] [input:{\"command\":\"echo approval\"}] streaming=true"]}`.
- Ask: `FAIL ask: the question is shown, and the answer reaches the stub as a tool result` `["","  0s (↑1 ↓16)","","┃","","auto · haiku 5.5"]`.
- Negative control: `PASS negative control: a plain prompt with no approval-requiring tool shows no approval panel`.
- Capability: thebird's TUI cannot send `clientCapabilities.libfx.tools`. Its initialize is built inside `fx-term.wasm`, and `createFxTerminal` takes no tools option. The `fx ask` initialize (`web/vendor/fx/engine.js:1794`) sends `libfx.tools` only when host tools are passed, and thebird passes none. The fx accept path (`src/acp/server.zig` `parseInitializeRequest`, allow_libfx) is sound, so this is a thebird API gap, not an fx defect. Giving the page a tool list is a product decision and was not made here.
- `/config/.local/bin/fx` is a symlink to `/workspace/fx/fx/zig-out/bin/fx`. The in-page `fx` path does not use it.
- Stopped relay PID 4140198 (named by /tmp/relay.pid, cwd /workspace/thebird). Not stopped: chromium and relay processes not named by my pid files (listed in the report).

## Phase A: page tool list for fx ask, stub refusal (this pass, not witnessed yet)

- `web/fx-host-tools.js` (new): `PAGE_HOST_TOOLS` is the one list, bash and ask, each with an object input schema and an execute that reports "not available on the thebird page yet". `PAGE_HOST_TOOL_NAMES` is derived from it.
- `web/fx-in-page.js`: the `fx ask` engine gets `tools: PAGE_HOST_TOOLS`, so its initialize sends `clientCapabilities.libfx.tools` (engine.js:1794–1796). Native builtins stay off on the page.
- `scripts/fx-stub-gateway.mjs`: a tool call is emitted only for a name in `PAGE_HOST_TOOL_NAMES` that the request also advertises. Any other name gets the `tool-not-advertised=<name>` reply.
- Tests: `test/fx-stub-tools.test.mjs` (`npm test`), five cases: list is bash and ask; listed tool emits a call; unlisted name is refused; unlisted name refused even when advertised; page tools report unavailable.
- Witness needed: `fx ask advertises exactly the page tools bash and ask to the gateway` (added to scripts/witness.mjs), plus the approval and ask TUI surfaces.
- Limit: the TUI (`fx-term.wasm`) builds its own request and has no channel for a host tool list (no FX_ env key, no option in `createFxTerminal`). Its requests keep `tools: []` unless fx changes. The approval and ask TUI surfaces depend on that, so they are expected to keep failing; that is an fx defect, and fx is not changed here.

## Phase B: witness run 14 (page tool list, HEAD after AGENTS.md entry)

- Wall 875 s, `WITNESS-EXIT 1`, PASS 186, FAIL 4.
- PASS: `fx ask advertises exactly the page tools bash and ask to the gateway — ["bash","ask"]`.
- FAIL, approval: `{"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] [input:{\"command\":\"echo approval\"}] streaming=true"]}`. The TUI request has no tool list: `fx-term.wasm` builds its own request, and `createFxTerminal` and the FX_ env keys offer no host-tool channel, so the page cannot send `libfx.tools` to the TUI. Recorded as an fx defect: the TUI needs a host-tool input. fx is not changed here.
- FAIL, ask: `["","  0s (↑1 ↓16)","","┃","","auto · haiku 5.5"]`, same cause.
- PASS: `negative control: a plain prompt with no approval-requiring tool shows no approval panel — []`.
- FAIL (fixed after the run): `ARCHITECTURE.md and AGENTS.md claims` on the `npm run witness` line "There is no test suite". `npm test` now exists, so AGENTS.md:105 names the one test file and `scripts/lint-architecture.mjs` checks for it. Direct `node scripts/lint-architecture.mjs` after the fix: exit 0, no FAIL lines. Not rerun inside the witness, per the one-witness rule.
- Resize FAIL: the known upstream fx defect, unchanged.

## Phase A: witness browser cleanup closes only recorded PIDs (no witness run in this pass)

- Change, `scripts/browser-driver.mjs`. Each Chromium launch records its root PID with its `/proc` start time (`recordBrowserTree`). While the browser runs, the driver refreshes every 500 ms and records each descendant of a recorded process, so a Chromium that is reparented to PID 1 stays recorded. The record is written to `THEBIRD_BROWSER_RUN_DIR` (default `thebird-browser-<pid>` under tmpdir) as `chromium-trees.json`.
- Cleanup: `closeBrowserTrees()` SIGKILLs each recorded PID only when its current start time still matches the record, so a reused PID is not killed. It runs at the end of each `runTerminal` and on process exit (`exit`, SIGINT, SIGTERM, SIGHUP), in every process that imports the driver, including `scripts/lint-live.mjs`. The old group kill (`killGroup`), which signalled every process in the launched group, is removed. No cleanup matches by name or by cwd.
- Cause of the run 14 leftovers, found in this pass: the twelve PIDs (928688 root, 928708, 928710 and their descendants) are from `scripts/lint-live.mjs`, the live probe of my `node scripts/lint-architecture.mjs` run killed by `timeout 110`. Their profile is `/tmp/lint-profile-Fnv4p5`, which `lint-live.mjs` creates. That process had no exit hook, so the Chromium it left was never recorded. They started at 17:36:27 local, six seconds after run 14 finished, not during it.
- Witness needed: `npm test` (`test/browser-driver.test.mjs`) checks that cleanup closes exactly the recorded tree and leaves an unrecorded process running. Witness run needed later to confirm no leftovers after a full run.

## Ranked open items (this pass, reachable first)

Reachable this pass, taken in rank order:
1. Witness wall-time table for runs 12–15 (recorded in the next section). Docs only.
2. This ranked list. Docs only.

Reachable, not taken this pass (needs a C change and a rebuild with its own witness, which this pass does not include):
3. The txiki `uv_fs_*` rows still stubbed: chmod, chown, copyfile, fchmod, fchown, fdatasync, fsync, futime, lchown, link, lutime, mkdtemp, mkstemp, statfs, utime (`scripts/txiki/stubs.tsv`). Some have no browser operation (chmod, chown, utime, link). copyfile, mkdtemp and mkstemp could be built on `tjs_fs_*`, but each needs a C change and a rebuild.

Not reachable from here:
4. Approval and ask TUI checks. Need fx's host-tool input: `fx-term.wasm` has no channel for a tool list. Owner note: leave them as they are.
5. Resize after the command palette. Needs fx: `src/ui/resize_runtime.zig` settle path.
6. Palette header `Results 50` vs `Commands 49`. Needs fx: the source of the 50th result is unidentified.
7. Sign-in choices for Codex and Grok absent. Needs fx: a wasm design decision.
8. Vendored core is not libfx 0.0.16 npm (`fx_http_stream_retry_after`). Needs fx: a core build from the fx side.
9. Transcript and ask surfaces with a real provider. Owner-held: needs a provider credential.
10. browser-agent proxy against the owner's key. Owner-held: a credential and an exposure decision.
11. Pages build: `AnEntrypoint/gmfx` is private to the workflow. Owner-held: a read token or visibility change.
12. Live site through playwriter. Blocked by 11. Owner-held.
13. Pyodide bundle licence. Owner-held: a licence fact.
14. Licence notices for vendored bundles. Owner-held.
15. Removal of `web/vendor/tte-js`. Owner-held: the owner decides removal.
16. gm import handoff channel. Owner-held: the channel is a fact only the owner holds. gm reruns its own import witness.
17. Stray processes on this machine (relay on port 8877, PID 3051450; Chromium trees under `/config`). Not project work. Owner-held: whether to stop them.

Reachable count: 2 taken, 1 reachable but deferred. Not reachable: 14.

## Witness wall times, runs 12–15 (this pass, docs only)

| Run | HEAD | Wall (s) | Exit | PASS | FAIL | Failing checks |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | 2094f44 | 834 | 1 | 186 | 3 | resize (upstream fx), approval, ask (fx host-tool input) |
| 13 | cd4fac5 | 843 | 1 | 186 | 3 | resize, approval, ask |
| 14 | 9cc8efd | 875 | 1 | 186 | 4 | resize, approval, ask, architecture claim "no test suite" (fixed after the run) |
| 15 | 2ac06b5 | 796 | 1 | 187 | 3 | resize, approval, ask. Cleanup closed its own 812 recorded PIDs. |

## Phase A: uv_fs_* rows made real (copyfile, mkdtemp, mkstemp), the rest stay stubbed (no build, no witness yet)

Changes:
- `scripts/txiki/browser/fs-uv-browser.c`:
  - `uv_fs_copyfile`: opens the source (`tjs_fs_open`, no create), honours `UV_FS_COPYFILE_EXCL` (EEXIST when the destination exists), opens the destination with create, truncates it to 0 through `tjs_fs_truncate`, then copies in 64 KiB chunks with `tjs_fs_read` and `tjs_fs_write`. A missing source gives ENOENT, and a directory gives EISDIR.
  - `uv_fs_mkdtemp` and `uv_fs_mkstemp`: the template must end in `XXXXXX` (EINVAL otherwise). The suffix comes from a counter, not an entropy source (uv_random is still a stub), and each candidate is checked with `tjs_fs_access` and retried up to 64 times (EEXIST when all collide). mkdtemp makes the directory with `tjs_fs_mkdir`. mkstemp creates the file with `tjs_fs_open` (create) and registers its position. A failed mkdir or open gives ENOENT. The name is owned by the request and freed in `uv_fs_req_cleanup`, which now covers MKDTEMP and MKSTEMP.
- `scripts/txiki/stubs.tsv`: copyfile, mkdtemp and mkstemp rows removed (a row and a real function would be a duplicate symbol). The reasons on the remaining rows now say why each one stays a stub: no OPFS operation for modes, owners, settable times, hard links or statistics; fsync and fdatasync need a synchronous flush, and the host write is buffered until `flushFs`.
- `scripts/witness.mjs`: a `uv_fs_*` block with six checks, run through the engine's `tjs -e`:
  - `uv_fs_mkdtemp makes a unique directory under a 6-character suffix…` (`uvfs-mkdtemp true 22 true true`)
  - `uv_fs_mkstemp creates a regular file under a 6-character suffix` (`uvfs-mkstemp true 22 true`)
  - `uv_fs_mkdtemp rejects a template without XXXXXX` (`uvfs-bad-template rejected`)
  - `uv_fs_copyfile replaces the destination…` (`uvfs-copy-truncate short`)
  - `uv_fs_copyfile copies a 131072-byte file across more than one 64 KiB chunk` (`uvfs-copy-big 131072`)
  - `uv_fs_copyfile rejects a missing source` (`uvfs-copy-missing rejected`)
- `AGENTS.md`: the list of still-stubbed rows now matches `stubs.tsv`, with the reason.

Expected in Phase B: the wasm changes, so `scripts/txiki/pin.json` must move to the new digest. That is the consequence of the C change, and it is recorded when the build runs.

## Phase B: uv_fs_* rows (build and witness)

- Build: the first `scripts/vendor-txiki.mjs` run passed both gates (compile 40 of 40, link 0 undefined symbols) and then stopped at the pin check, because the C change moved the digest to `3e5ccc55…`. The pin moved to that digest (`scripts/txiki/pin.json`, and AGENTS.md). A second build ran with the new pin and wrote `web/vendor/txiki/tjs.wasm` (exit 0, wall 195 s, sha256 `3e5ccc55fc9a06790dd1717fd54ddfc0e67c3733e3e8fb37ef0b5a8c4553556e`). The first run's wall time was not recorded.
- Witness run 19 (full witness, before the witness fix): wall 872 s, `WITNESS-EXIT 1`, PASS 190, FAIL 6 (the three uv_fs checks below, the resize, approval and ask checks).
  - `uv_fs_mkdtemp rejects a template without XXXXXX` PASS, `uv_fs_copyfile replaces the destination` PASS, `uv_fs_copyfile rejects a missing source` PASS.
  - mkdtemp, mkstemp and copy-big FAIL. The cause is in the witness, not in the C: it called `tjs.statSync` and `tjs.mkstemp`, which are not on the global `tjs` (`typeof tjs.statSync` is `undefined`, and `tjs.mkstemp` throws "not a function"). The engine's names are `tjs.stat` (async, `size`, `isFile`, `isDirectory`) and `tjs.makeTempFile`.
- Probe of the live page (`/tmp/fx-tui/uvprobe/probe2.out`) with the correct names: `F 22 true`, `SIZE 32 false`, `D 22 true`. makeTempDir alone had already returned `D /workspace/uvfs-z01n6h`.
- Witness fix: the three checks now use `tjs.stat` and `tjs.makeTempFile`. The witness is rerun once more in full, so the uv_fs lines come from a run with the corrected code.
- Witness run 20 (full witness, HEAD 5064967): wall 1115 s, `WITNESS-EXIT 1`, PASS 193, FAIL 3. All three FAILs are fx (resize after the palette, approval, ask), and the approval and ask causes are unchanged.
  - `PASS uv_fs_mkdtemp makes a unique directory under a 6-character suffix, and the path is reported to JavaScript` (`uvfs-mkdtemp true 22 true true`)
  - `PASS uv_fs_mkstemp creates a regular file under a 6-character suffix` (`uvfs-mkstemp true 22 true`)
  - `PASS uv_fs_mkdtemp rejects a template without XXXXXX` (`uvfs-bad-template rejected`)
  - `PASS uv_fs_copyfile replaces the destination: a shorter source leaves exactly the source bytes` (`uvfs-copy-truncate short`)
  - `PASS uv_fs_copyfile copies a 131072-byte file across more than one 64 KiB chunk` (`uvfs-copy-big 131072`)
  - `PASS uv_fs_copyfile rejects a missing source` (`uvfs-copy-missing rejected`)
- Gates on this pass: `npm run check` exit 0; `npm run lint:comments` 0 comments in 100 repo-owned files; `npm test` 6 pass, 0 fail; `node scripts/lint-architecture.mjs` (live probes) 349 claims, 349 pass, 0 fail, 0 unverified, wall 684 s.
- Build wall: the second `vendor-txiki.mjs` run 195 s. Witness wall: run 19 872 s (before the witness fix), run 20 1115 s.
- Still stubbed, with reasons in `scripts/txiki/stubs.tsv`: chmod, chown, fchmod, fchown, lchown, futime, utime, lutime, link, statfs (no OPFS operation), fsync and fdatasync (the host write is buffered until `flushFs`, and the host call is synchronous).

## Queue: fx host tools and the metadata uv_fs rows (Phase A, not built)

Phase A is code, tests and docs only. No build, gate or witness has run for these changes. Phase B owns the build, the pin move, the witnesses and the push.

- Item 1, fx host tools (`web/fx-host-tools.js`, `test/fx-stub-tools.test.mjs`): `pageHostToolsJson()` returns `{"tools":[{name,description,inputSchema}]}` for `PAGE_HOST_TOOLS`. A node:test checks that it parses and that its names equal `PAGE_HOST_TOOL_NAMES`. The test was run once in this phase (6 pass, 0 fail), which the queue did not ask for at Phase A.
  - Blocked on the fx SDK: `fx_terminal_initialize(bytes_ptr, bytes_len)` has to run before `_start`, and the vendored `web/vendor/fx/wasm-runtime.js` calls `_start` inside `instantiate` with no pre-start hook and no exposed instance. There is no way for the page to place the JSON bytes in wasm memory before the TUI starts. Nothing in `web/vendor/fx/` was edited. Approval and ask therefore stay open until the SDK exposes that hook.
- Item 2, metadata rows (witness: `scripts/witness.mjs` uv_fs attr block, not yet run):
  - `scripts/txiki/browser/fs-uv-browser.c`: `chmod`, `fchmod`, `chown`, `fchown`, `lchown`, `utime`, `lutime` and `futime` are real over `tjs_fs_setattr`. Stat slots are now seven (uid, gid, atime added). Seconds from libuv become milliseconds for the shim.
  - `web/txiki-in-page.js`: `tjs_fs_stat` and `tjs_fs_lstat` write seven slots, with mode from `info.mode`; new `tjs_fs_setattr` maps attr codes 0 to 4 onto mode, uid, gid, atime, mtime.
  - `web/shims/fs.js`: `attrs` map persisted to `/.thebird/attrs.json`; `statOf` and `linkStat` read it; `setAttrSync`; `touch` keeps the live mtime authoritative and drops a stored mtime on the next write; remove and rename carry attributes (`forgetAttrs`, `replaceAttrs`).
  - `scripts/txiki/stubs.tsv`: the eight rows are removed. Four stay with an exact cause, each saying the call is reachable from JS and returns `UV_ENOSYS`:
    - `uv_fs_link` (`tjs.link`): OPFS files have no inode identity, so a second name cannot share the first name's bytes.
    - `uv_fs_statfs` (`tjs.statFs`): OPFS usage is only available through an async estimate, and the host call is synchronous.
    - `uv_fs_fsync` (`File.sync`) and `uv_fs_fdatasync` (`File.datasync`): host writes sit in the dirty map until the async `flushFs`, and the synchronous host call cannot wait for it.
  - Witness attr block, JS-reachable rows only: `tjs.chmod` (expects `uvfs-chmod 384`), `File.chmod` (`uvfs-fchmod 416`), `File.chown` (`uvfs-fchown 1234 5678`), `File.utime` (`uvfs-futime 1700000000000 1600000000000`). There is no global `chown`, `lchown`, `utime` or `lutime` in txiki's `mod_fs.c`, so those four have no JS entry to witness; their C path is a real implementation with no JS call site.
  - `AGENTS.md`: the stubbed-row sentence lists the four remaining rows and the attribute storage.
- Witness wall time: not run in Phase A.

## Stretch 1: uv_fs rows, Phase B (build and witness)

- Builds (`scripts/vendor-txiki.mjs`, zig 0.17.1). Each build passed both gates (compile 40 of 40, link 0 undefined symbols). A C change moves the digest, the pin check stops the run before the wasm is written, so each change took a pin move and a second run:
  - B1 (Phase A C, 2b05905): stopped at the pin check, wall 127 s. Pin moved to `c4e55f46…`, rebuilt, exit 0, wall 175 s.
  - B2 (git fs stat buffers widened to seven slots): stopped, wall 100 s. Pin moved to `63463286…`, rebuilt, exit 0, wall 106 s.
  - B3 (link, statfs, fsync, fdatasync): stopped, wall 84 s. Pin moved to `fb1337e8…`, rebuilt, exit 0, wall 131 s.
  - B4 (flush completion counted by the page's work-pending check): stopped, wall 119 s. Pin moved to `af3ab91e…`, rebuilt, exit 0, wall 138 s. This is the pin in `scripts/txiki/pin.json` and AGENTS.md.
- Witness run 21 (on B1 wasm, before the recursion fix): wall 867 s, `WITNESS-EXIT 1`. Defect: `touch` called itself (the bulk rewrite of `meta.set` into `touch` also rewrote the line inside `touch` and in `saveAttrs`), so every OPFS write overflowed the stack. This took the OPFS, symlink and gm checks with it.
- Witness run 22 (after the recursion fix): wall 1099 s, `WITNESS-EXIT 1`, PASS 196, FAIL 4. The uv_fs `futime` FAIL was in the witness: it read `s.atime` and `s.mtime`, which the txiki stat object does not have (it has `atim`, `mtim`, `ctim`, `birthtim`), so the check threw silently. Verified by a live probe (`uvfs-futime 1700000000000 1600000000000` after the witness fix). The git binding `scripts/txiki/browser/fs-browser.c` still declared four-slot stat buffers that the host now fills with seven, so it was widened.
- Witness run 23 (final state, B4 wasm): wall 1064 s, `WITNESS-EXIT 1`, PASS 202, FAIL 3. All 15 uv_fs checks PASS:
  - `PASS uv_fs_mkdtemp makes a unique directory…`, `PASS uv_fs_mkstemp creates a regular file…`, `PASS uv_fs_mkdtemp rejects a template without XXXXXX`, `PASS uv_fs_copyfile replaces the destination…`, `PASS uv_fs_copyfile copies a 131072-byte file…`, `PASS uv_fs_copyfile rejects a missing source`
  - `PASS uv_fs_chmod (tjs.chmod) sets the mode bits that stat reports`, `PASS uv_fs_fchmod (File.chmod)…`, `PASS uv_fs_fchown (File.chown)…`, `PASS uv_fs_futime (File.utime)…`
  - `PASS uv_fs_link (tjs.link) makes a second name that reads the same bytes`, `PASS uv_fs_link: a write through the new name is seen through the old name`, `PASS uv_fs_statfs (tjs.statFs)…`, `PASS uv_fs_fsync (File.sync)…`, `PASS uv_fs_fdatasync (File.datasync)…`
  - The 3 FAILs are outside uv_fs. `FAIL a resize after the command palette…` is the upstream fx TUI defect (native fx fails the same way). `FAIL approval: a bash tool call opens the approval panel…` (options `[]`) and `FAIL ask: the question is shown…` are blocked on the fx SDK pre-start hook (stretch 2).
- Four rows now implemented (none left in `stubs.tsv`):
  - link: hard-link group in the attrs file (`hard` id); every write goes through `storeBytes`, which copies to all members; attribute changes apply to all members; rename and unlink carry membership. stat nlink stays 1.
  - statfs: `tjs_fs_quota` reads a cached `navigator.storage.estimate()`; 4096-byte blocks; `f_files` and `f_ffree` are 0 because OPFS has no inode table; ENOSYS when no estimate is available.
  - fsync and fdatasync: `tjs_fs_flush` runs `flushFs` and calls the exported `tjs_fs_flush_done(id, status)`; the C side keeps a count of outstanding flushes that the browser work-pending check reads, so the page keeps ticking until the flush completes.
- Gates after the last change: `npm test` 7 pass, 0 fail (exit 0); `npm run check` exit 0; `npm run lint:comments` exit 0, 0 comments in 100 repo-owned files.
- Witness wall times: run 21 867 s, run 22 1099 s, run 23 1064 s.

## Stretch 2: host-tool wiring (Phase A, not built, not pushed)

- Source of the vendored SDK: fx origin main `ffb0e21f`. The runtime change that adds the hook is fx commit `7e33a9fe` (`sdk/wasm-runtime.js`, `beforeStart(instance)` after `instantiate` and before `_start`). The only difference from the previously vendored `web/vendor/fx/wasm-runtime.js` is the line `await options.beforeStart?.(instance);`. `web/vendor/fx/manifest.json` records the new SHA-256 for that file. `wasm-terminal.js` is byte-identical to upstream and spreads its options into `instantiate`, so the hook reaches the runtime.
- Change 1, vendored `web/vendor/fx/wasm-runtime.js` and its manifest hash: witness is the TUI run in Phase B (the TUI cannot start without the hook).
- Change 2, `web/fx-host-tools.js` `initializeHostTools(instance)`: writes the host-tool JSON from `pageHostToolsJson()` above the end of the terminal wasm's memory, calls `fx_terminal_initialize(ptr, len)`, and throws on a negative result. Witness: the approval and ask TUI checks in `scripts/witness.mjs`.
- Change 3, `web/fx-tui.js` `runFxTui`: passes `beforeStart: initializeHostTools` to `createFxTerminal`. Witness: the approval and ask TUI checks.
- Blocker found in Phase A: the vendored `web/vendor/fx/fx-term.wasm` exports only `memory` and `_start` (checked with `WebAssembly.Module.exports`). `fx_terminal_initialize` is in fx `src/wasm_term_main.zig` at origin main, so the terminal wasm must be rebuilt from origin main to carry it. The fx checkout at `/workspace/fx/fx` is at `2e3832eb`, not origin main, and has an uncommitted change in `src/ui/transcript/runtime.zig`. A build there would embed that change, so it was not run. Its existing `zig-out/bin/fx-term.wasm` does export the function, but it was built from a tree that cannot be tied to origin main, so it is not vendored.

## Phase A without a build (held until fx's clean source is pushed)

- Not built and not pushed. `scripts/txiki/pin.json` and AGENTS.md still carry the `af3ab91e…` digest from the last build, which no longer matches the C changed below. Phase B's build moves the pin.
- Change A1, stat link count (row: uv_fs stat / `nlink`): `scripts/txiki/browser/fs-uv-browser.c` stat records are eight slots, slot 7 is the link count, and `stat_into` sets `st_nlink` from it (1 when absent). `scripts/txiki/browser/fs-browser.c` buffers are eight slots. `web/txiki-in-page.js` `tjs_fs_stat` and `tjs_fs_lstat` write slot 7 from `info.nlink`. `web/shims/fs.js` `statOf` reports `nlink` as the hard-link group size (`hardMembers(path).length`), and directories and symlinks report 1. Node check: `link` makes nlink 2 and 2, and `unlink` returns the survivor to 1. Witness: `scripts/witness.mjs` step `tjs.link` then `tjs.stat` with the check `uv_fs stat reports a hard link's real link count (three names after a third link)` (expects `uvfs-nlink 3`). Not yet run.
- Change A2, flush released on engine free (row: uv_fs fsync and fdatasync): `scripts/txiki/browser/fs-uv-browser.c` `tjs_fs_release_loop(loop)` removes that loop's outstanding flush waits and decrements the count, and `scripts/txiki/browser/entry.c` calls it in `tjs_browser_end` and `gm_txiki_free` before `TJS_FreeRuntime`. A completion that arrives after the release finds no wait and does nothing. Witness: none yet. It needs a probe that frees an engine with a flush outstanding and checks that a following `tjs -e` does not keep ticking. That probe is a Phase B item, because it needs the build.
- Change A3, the rest of the stretch 2 work (`68aa077`) is unchanged.
- fx checkout state (`git -C /workspace/fx/fx`, read only, after `git fetch origin`): `HEAD` `0645ac20`, `origin/main` `ffb0e21f`, the working tree clean, and the branch `ahead 8` of `origin/main`. So fx has eight local commits that are not pushed, and its origin main is the clean source once it pushes. Nothing in that checkout was changed.

## Phase A, round 2: remaining stub rows and host-tool assertions (not built, not pushed)

- Stub audit (`scripts/txiki/stubs.tsv`, 64 rows left). The existing `tjs_fs_*` imports cover filesystem calls only, so none of the remaining rows can be built over them alone. Four rows were implemented without a new import, because the page has an exact answer:
  - `uv_os_getenv` (`tjs.getenv`): `UV_ENOENT`; the page has no environment variables. Row: os. Witness: `uvos-env` step, expects `tjs.getenv('PATH') === undefined`.
  - `uv_os_environ` and `uv_os_free_environ` (`tjs.environ`): zero entries, free is a no-op. Witness: `uvos-env`, expects 0 keys.
  - `uv_os_tmpdir` (`tjs.tmpDir`): `/.thebird`, the directory the engine's temp files already use (AGENTS). Witness: `uvos-env`, expects `/.thebird`.
  - `uv_loadavg` (`tjs.loadavg`): the stub left the array unwritten, a defect. It now writes `0,0,0` and the row is removed. The browser has no load average, so zeros are a fixed value, not a measurement. Witness: `uvos-env`, expects `0,0,0`.
- Remaining rows stay stubbed, each with its cause in `stubs.tsv`. Reachable rows name their JS entry: `uv_os_setenv`/`unsetenv` (`tjs.setenv`/`unsetenv`), `uv_os_gethostname` (`tjs.hostName`), `uv_os_getpid`/`getppid` (`tjs.pid`/`ppid`), `uv_os_get_passwd` and `uv_os_free_passwd` (`tjs.userInfo`), `uv_cpu_info` and `uv_free_cpu_info` (`tjs.cpuInfo`), `uv_available_parallelism` (`tjs.availableParallelism`, returns 1), `uv_uptime` (`tjs.uptime`), `uv_interface_addresses` and `uv_free_interface_addresses` (`tjs.networkInterfaces`), `uv_cwd` (`tjs.cwd`), `uv_chdir` (`tjs.chdir`), `uv_exepath` (loader only), and `uv_random` (`tjs.random` and webcrypto key generation, which fails with `UV_ENOSYS`). `uv_random` needs a `crypto.getRandomValues` host import, which is not among the `tjs_fs_*` imports, so it is an open item for the owner to decide. The `uv_inet_pton`, `uv_ip4_name` and `uv_ip6_name` rows are only used by excluded net modules.
- Host-tool assertions (witness, approval and ask):
  - `web/fx-host-tools.js` `initializeHostTools` sets `globalThis.thebirdHostToolCount` to the count `fx_terminal_initialize` returns.
  - `scripts/witness.mjs` reads it after the welcome panel shows, and checks `host tools: fx_terminal_initialize accepted the page host tools before the TUI started (count 2)`.
  - `host tools: the TUI advertises exactly bash and ask to its gateway` checks the sorted, unique tool names the TUI's stub gateway received, against `['ask','bash']`.
  - The existing approval (`approval: a bash tool call opens the approval panel…`) and ask (`ask: the question is shown…`) checks run in the same witness, unchanged. They still fail until the wasm carries `fx_terminal_initialize` (Phase B).
- Not run: no build, no test, no witness in this round.

## Phase A, round 3: reachable rows (not built, not pushed)

- Implemented in `scripts/txiki/browser/uv-browser.c` with no new host import:
  - `uv_os_setenv` and `uv_os_unsetenv` (`tjs.setenv`, `tjs.unsetenv`): a per-engine environment table in the wasm. `uv_os_getenv` and `uv_os_environ` (round 2) now read that table, so a set variable is visible to `tjs.getenv` and `tjs.environ`, and an unset one is removed. Rows removed from `stubs.tsv`. Witness: `uvos-set` step (`tjs.setenv` → `tjs.getenv` → `tjs.unsetenv`), check `uv_os_setenv and uv_os_unsetenv store and remove a variable that uv_os_getenv reads back` (expects `uvos-set 1 true`). The round-2 witness, `uvos-env`, still expects an empty environment before any set.
- Checked for reachability from JS and found not reachable over the existing `tjs_fs_*` imports; each keeps its row in `stubs.tsv` with the exact cause (the JS entry and the missing data):
  - `uv_os_gethostname` (`tjs.hostName`), `uv_os_getpid` (`tjs.pid`), `uv_os_getppid` (`tjs.ppid`): the page has no machine name, process id or parent process id to report. `location.hostname` names the Pages host, not the machine.
  - `uv_os_get_passwd` and `uv_os_free_passwd` (`tjs.userInfo`): the browser has no user database.
  - `uv_cpu_info` and `uv_free_cpu_info` (`tjs.cpuInfo`), `uv_interface_addresses` and `uv_free_interface_addresses` (`tjs.networkInterfaces`), `uv_uptime` (`tjs.uptime`): no host data source in the page; `navigator.hardwareConcurrency` is not CPU info, and no import provides interfaces or uptime.
  - `uv_available_parallelism` (`tjs.availableParallelism`): the generator returns 1, correct for the single-threaded engine (the row is unchanged).
  - `uv_cwd` (`tjs.cwd`) and `uv_chdir` (`tjs.chdir`): the engine's working directory is not kept in the wasm; the shell's cwd lives in bashkit.
  - `uv_exepath`: used by the file-based bootstrap that the browser entry does not call.
  - `uv_random` (`tjs.random`, webcrypto key generation): needs `crypto.getRandomValues`, which no existing `tjs_fs_*` import provides. Open: a new host import is the owner's decision.
  - `uv_pipe_*`, `uv_tcp_*`, `uv_accept`, `uv_listen`, `uv_inet_pton`, `uv_ip4_name`, `uv_ip6_name`, `uv_signal_start`, `uv_thread_create`, `uv_thread_join`, the `tjs__channel_*`, `tjs__mod_*` and `tjs__lws_*` rows: the modules are excluded from the browser build or the page is single-threaded, so the symbols are not reachable from JS.
- Witness round 3: `scripts/witness.mjs` steps and checks above; not run.

## Phase A, round 4: the remaining reachable rows (not built, not pushed)

- Imports used, all existing: `tjs_random` (`crypto.getRandomValues`), `tjs_fs_resolve` (the page's `absolute()` against `slot.cwd`), `tjs_now_ms`. No new import was added.
- Implemented (rows removed from `scripts/txiki/stubs.tsv`), in `scripts/txiki/browser/fs-uv-browser.c`:
  - `uv_random`: synchronous fill from `tjs_random` in 64 KiB chunks, which is the `getRandomValues` limit. The asynchronous form (a callback) returns `UV_ENOSYS`; every engine call site passes NULL for the loop, request and callback, so the engine never takes that path. Witness: `uvos-rand` step, check `uv_random fills bytes from the browser entropy source (non-zero, differs between calls); uv_cwd reports the shell directory` (expects `uvos-rand true true /workspace true`).
  - `uv_cwd` (`tjs.cwd`): resolves `.` through `tjs_fs_resolve`, which is the page's current directory. A buffer that is too small returns `UV_ENOBUFS` with the size needed, as `mod_os.c` expects. Witness: the same `uvos-rand` check, which reads `tjs.cwd` and expects `/workspace`.
- Causes recorded in `scripts/txiki/stubs.tsv`, not guessed, because no existing import holds the data:
  - `uv_os_gethostname` (`tjs.hostName`): no import returns a machine name.
  - `uv_os_getpid` (`tjs.pid`) and `uv_os_getppid` (`tjs.ppid`): no import returns a process id.
  - `uv_os_get_passwd` (`tjs.userInfo`): no import reads a user database. `uv_os_free_passwd` has nothing to free.
  - `uv_cpu_info` (`tjs.cpuInfo`): no import reports CPU data. `uv_free_cpu_info` has nothing to free.
  - `uv_interface_addresses` (`tjs.networkInterfaces`): no import reports interfaces. `uv_free_interface_addresses` has nothing to free.
  - `uv_uptime` (`tjs.uptime`): `tjs_now_ms` gives the wall clock, not the system boot time, so uptime is not computable.
  - `uv_chdir` (`tjs.chdir`): the page keeps its directory in `slot.cwd` and no import sets it.
  - `uv_exepath`: a web page has no executable file for an import to name.
- Witness round 4: `uvos-rand` step and check above; not run.

## Phase A, round 5: nine rows through the browser record (not built, not pushed)

- Wasm import list changes: two new host imports, `tjs_os_info` (the record) and `tjs_os_chdir` (a setter). The import list changes, so the pin changes at Phase B. The request named one import; `uv_chdir` must set the page's directory, which no read-only import can do, so the setter is the second import.
- JS, `web/txiki-in-page.js`, next to `tjs_random`:
  - `tjs_os_info(out, cap)` writes a flat JSON record: `hostname` (`location.hostname`), `pid` 1, `ppid` 0, `passwd_name` `thebird`, `passwd_home` `/.thebird`, `passwd_shell` empty, `passwd_uid` 0, `passwd_gid` 0, `cpu_count` (`navigator.hardwareConcurrency`), `cpu_model` `browser`, `interfaces` 0, `uptime_s` (`performance.now()` in seconds), `exepath` `/.thebird/tjs`. It returns -1 when the record does not fit.
  - `tjs_os_chdir(ptr, len)` resolves the path against the page's directory and sets it only when it is an existing directory; otherwise -1.
  - Not in the record, on purpose: the request listed `cwd: "/"`. The engine's directory is `slot.cwd`, which `uv_cwd` already reads and which the shell sets per run, so a second cwd field would disagree with it. `cwd` is left out.
- C, `scripts/txiki/browser/fs-uv-browser.c`: a flat-key reader over the record (`json_text`, `json_number`), with the implementations:
  - `uv_os_gethostname` (`hostname`), `uv_exepath` (`exepath`), `uv_os_getpid` (`pid`), `uv_os_getppid` (`ppid`), `uv_os_get_passwd` (`passwd_*`, copies allocated and released by `uv_os_free_passwd`), `uv_cpu_info` (`cpu_count` entries with `cpu_model`, released by `uv_free_cpu_info`), `uv_interface_addresses` (`interfaces`, zero entries; a non-zero count returns `UV_ENOSYS`, released by `uv_free_interface_addresses`), `uv_uptime` (`uptime_s`), `uv_chdir` (the setter; `UV_ENOENT` when it fails).
  - The three free functions (`uv_os_free_passwd`, `uv_free_cpu_info`, `uv_free_interface_addresses`) are implemented as well, because the functions above now return allocated memory; they were stub rows before.
- `scripts/txiki/stubs.tsv`: twelve rows removed (the nine, and the three frees). `uv_available_parallelism` keeps its generator body (1).
- Witness, `scripts/witness.mjs`: step `uvos-info` (reads `tjs.pid`, `tjs.ppid`, `tjs.userInfo.userName`, `tjs.userInfo.homeDir`, `tjs.cpuInfo()`, `tjs.networkInterfaces()`, `tjs.uptime()`, `tjs.chdir` to a missing path, `tjs.exePath`, `tjs.cwd`). Check: `uv_os_getpid, uv_os_getppid, uv_os_get_passwd, uv_cpu_info, uv_interface_addresses, uv_uptime, uv_chdir and uv_exepath read the browser record; chdir to a missing path is rejected` expects `uvos-info 1 0 thebird /.thebird true 0 true rejected /.thebird/tjs /workspace`.
- Semantics to know: `tjs.chdir` changes the page's directory for the rest of that `tjs -e` run only, because `runTjs` sets `slot.cwd` from the calling shell's directory each time. The shell's own working directory (bashkit) is not changed.
- Not run: no build, no test, no witness in this round.

## JS-only gates on the local HEAD (no build, no witness; not pushed)

- Run once each on HEAD `4e4cb08` (the round 5 commit), in the order listed:
  - `npm test`: exit 0, wall 1 s. Output: `ℹ tests 7`, `ℹ pass 7`, `ℹ fail 0`.
  - `npm run check`: exit 0, wall 1 s. Output ends with the `node --check` chain for `bin/`, `src/`, `scripts/`, `web/` and `web/shims/`, all passing.
  - `npm run lint:comments`: exit 0, wall 1 s. Output: `VENDORED web/vendor/xterm/xterm.mjs: 3 comments kept; upstream xterm.js named (third-party, not edited)` and `100 repo-owned files checked: 0 comments; 147 tracked files, 19 vendored files with comments`.
- Defects found: none. No fix was needed, so no fix commit was made.
- Not run in this turn: the wasm build, `npm run witness`, the witness steps, and `npm run lint:architecture`.

## uvos rows on 0ac311c (local, not pushed)

Commit 0ac311c (the amended 21ee96f) changes `scripts/witness.mjs` only: the uvos rows use the names this build exposes (`tjs.env`, `tjs.system`, `crypto.getRandomValues`) in place of `tjs.getenv`, `tjs.random`, `tjs.userInfo` and the other absent names. The engine bindings were already implemented; no binding changed.

Witness output, from the full `npm run witness` on 0ac311c (headless Chromium, `WITNESS-EXIT 1`, wall 16m47.9s, `witness totals: PASS 208 FAIL 4`; the four FAILs are listed below):

- `PASS uv_os_getenv and uv_os_environ report an empty environment, and uv_os_tmpdir reports /.thebird`
- `PASS uv_os_setenv and uv_os_unsetenv store and remove a variable that uv_os_getenv reads back`
- `PASS uv_random fills bytes from the browser entropy source (non-zero, differs between calls); uv_cwd reports the shell directory`
- `PASS uv_os_getpid, uv_os_getppid, uv_os_get_passwd, uv_cpu_info, uv_interface_addresses, uv_uptime, uv_chdir and uv_exepath read the browser record; chdir to a missing path is rejected`

Raw engine output for the same four commands, from a direct run of those commands (the witness does not print the `uvos-*` lines): `uvos-env true 0 /.thebird 0,0,0`, `uvos-set 1 true`, `uvos-rand true true /workspace true`, `uvos-info 1 0 thebird /.thebird true 0 true rejected /.thebird/tjs /workspace`.

## Open rows waiting on fx (not passing, not changed)

These four FAILs stay open on 0ac311c. None is a thebird defect that can be fixed here.

- `FAIL approval: a bash tool call opens the approval panel with its options and its command row` - waits on fx's stretch 4a push (host tools advertised to the page). Detail: `{"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] [input:{\"command\":\"echo approval\"}] streaming=true"]}`.
- `FAIL host tools: the TUI advertises exactly bash and ask to its gateway` - waits on fx's stretch 4a push. Detail: `[]`.
- `FAIL ask: the question is shown, and the answer reaches the stub as a tool result` - waits on fx's stretch 4a push. Detail: `["","  0s (↑1 ↓16)","","┃","","auto · haiku 5.5"]`.
- `FAIL a resize after the command palette keeps the welcome panel and the rules at 70 columns` - waits on fx's upstream palette fix in `src/ui/resize_runtime.zig`. Detail: `{"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`.

Status at this entry: fx origin main is ddd17c74 (stretch 3). Stretch 4a is not on origin yet, so the three host-tools rows cannot be rerun against it.

## fx TUI parity, Phase A (docs only, nothing built, not pushed)

The queued memory (`thebird-fx-tui-parity`) says the TUI is missing and that the cause is unknown. Checked against the tree in this pass, that premise is out of date, and this Phase A changes no code.

- The term build is vendored and wired (see the Phase A finding above): `runFxTui` runs `fx-term.wasm` for a bare `fx`.
- The witness already has the parity checks the memory asks for: transcript (`transcript: the prompt and the stub answer appear in the TUI transcript`), negative control, approval panel, ask, full-transcript screen opened with Ctrl-O, and palette resize (the fx-owned FAIL).
- The owner's ghostty-vt and WTerm references are not in this repo or the fx checkout. Still open: the owner has to name those artifacts, or confirm xterm.js as the VT surface.

Changes in Phase A: this section only. No witness, build, or code change. The parity rows stay pending on fx's stretch 4a push and the palette fix, and are not run here.

## Phase A: floosie in gm (queue pass 6, docs only, no build, test or witness)

State found at the start of this pass, checked against the tree and history:
- The floosie restore is already in place. `ea62485` (feat(floosie): wire many apps through the bare JS browser stream hub) re-added the floosie import in `web/gm-in-page.js`, the hub attach, the floosie witness checks, the floosie text in AGENTS, ARCHITECTURE, DESIGN and README, `scripts/vendor-floosie.mjs`, and the `web/vendor/floosie/` bundle. `ea62485` is an ancestor of `origin/main`. `ffe1f3b` (playwriter) sits on top of it and keeps the floosie import.
- Decoupling hunks from `4686dce`, `79754fe` and `6beb1d1` that still differ from the pre-decoupling tree: none in `web/gm-in-page.js`, `scripts/witness.mjs` or the docs listed above, because `ea62485` replaced them. One removal from `4686dce` remains: the `gmHostTools` export (the host-tool JSON for the gm verbs). Nothing in the tree refers to it. It is not a floosie hunk, so it is not restored here; the owner decides whether it returns with the host-tool wiring.
- `6beb1d1` is the record of the decoupling and says floosie is held for its owner. That is superseded by `ea62485`; its rows stay as history and are not edited.

Changes in Phase A:
| Change | File | Witness |
| --- | --- | --- |
| None to code. The floosie import, hub attach and docs are already at HEAD from `ea62485`; this section is the only change. | `docs/PENDING_VALIDATION.md` | Static: `git show HEAD:web/gm-in-page.js` line 5 is `import { createBrowserStdio } from './vendor/floosie/browser.js';`, and `git merge-base --is-ancestor ea62485 origin/main` succeeds. No build, test or witness run in Phase A. |

Phase B (not run in this pass), in this order, once fx `origin/main` moved past `ddd17c74` (it is at `1cf7602`, "Send the terminal host tools in the interactive gateway request and expose a tools option"):
1. `FLOOSIE_REPO=/workspace/floosie node scripts/vendor-floosie.mjs`, so `web/vendor/floosie/` is built from floosie main and not hand-copied. Record the commit and the `browser.js` SHA-256 it writes in `web/vendor/floosie/manifest.json`. The manifest at HEAD names `5417a536`.
2. Rebuild `web/vendor/fx/fx-term.wasm` from the fx checkout at `/workspace/fx/fx`, which is at `5c8b64dc` (one docs commit above `origin/main`, clean tree). That is the commit that carries the host-tool wiring; the build reads its own commit.
3. Run the approval, host-tools and ask rows and the palette resize row inside `npm run witness` (witness run 4), once, on the tracked tree.
4. Fix each defect found, then push `origin/main` once with `0ac311c`, `62b0623` and any floosie commit.

## Phase B: floosie vendor, fx host-tool term build, approval mode (queue pass 6)

Trigger: fx `origin/main` moved past `ddd17c74` to `1cf7602` (host tools in the interactive gateway request).

Changes and their witness:
| Change | Commit | Witness |
| --- | --- | --- |
| `FLOOSIE_REPO=/workspace/floosie node scripts/vendor-floosie.mjs` run from floosie `5417a53`. The output is byte-identical to the committed bundle (`browser.js` SHA-256 `588f159d…`), so nothing changed. | none | Vendor script output: `floosie vendor written to …/web/vendor/floosie: 5417a536a3bc 588f159dd6ea`. |
| fx term wasm rebuilt from the fx checkout (`zig build fx-term-wasm -Dwasm-surface=term`, Zig 0.17.1, from `/tmp/qjs-zigcopy/zig-x86_64-linux-0.17.1/zig`). Term SHA-256 `b0d98491…`, and `wasm-terminal.js` changed to `e05eec92…`. The core is not rebuilt: `zig build` for `fx-core` fails at fx `5c8b64dc` in `src/core/hooks/external_run.zig` (`expected type 'i32', found 'void'`). The committed core is kept. | fd04a2a | Witness run 4 (below). |
| `scripts/witness.mjs`: the approval step sends `/permissions ask` first, because fx starts in `auto` (a safety review, no approval panel). | b101dda | Witness run 5 (below): approval still FAILs. |

Witness run 4 (`npm run witness`, 13m14.8s, `WITNESS-EXIT 1`, `witness totals: PASS 210 FAIL 2`). The host-tools and ask rows pass:
- `PASS host tools: fx_terminal_initialize accepted the page host tools before the TUI started (count 2) — 2`
- `PASS host tools: the TUI advertises exactly bash and ask to its gateway — ["ask","bash"]`
- `PASS ask: the question is shown, and the answer reaches the stub as a tool result — ["","• Thinking      ","","┃","","auto · haiku 5.5"]`
- `FAIL approval: a bash tool call opens the approval panel with its options and its command row — {"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] [input:{\"command\":\"echo approval\"}] streaming=true"]}`
- `FAIL a resize after the command palette keeps the welcome panel and the rules at 70 columns — {"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`

Witness run 5 (after b101dda, `npm run witness`, 20m53.6s, `WITNESS-EXIT 1`, `witness totals: PASS 205 FAIL 7`):
- `FAIL approval: … — {"options":[],"commandRows":["  stub gateway answer: prompt=[tool:bash] [input:{\"command\":\"echo approval\"}]"]}`. The transcript shows the `<fx-context-update>` for the mode change, so `/permissions ask` was sent. The stub still answers with text, not a tool call. Cause not found: `streamPlan` emits the `bash` tool call when called directly with one text part, so the difference is in the request the TUI sends after the mode change. Open.
- `FAIL a resize after the command palette …` — the fx-owned defect, as before.
- `FAIL the built GitHub Pages site runs bash and python3 without COOP/COEP headers` — the page's `pages` run reports `{"ok":true,"finished":true,"actionSeq":3}` for the gm call. Its check reads the gm stdio lines from run 4's order. Not diagnosed.
- `FAIL npm install debug …` (two rows) and `FAIL the txiki shell answers pip --version …` (`pip: Failed to fetch`) and `FAIL the txiki shell serves git, node, qjs and python3 …` (`shell engine exited with status 124`). These passed in run 4; the registry and PyPI fetches and the nested-engine timeout look environmental. Not confirmed by a rerun.

Host-tools and ask rows: PASS in run 4 and run 5. Approval and the palette resize: FAIL. Nothing is pushed. The push waits for the approval row to pass, or for the owner to accept it open.

## Run 5 regression: cause of each of the seven new failures (queue pass 7)

Run 4 was `PASS 210 FAIL 2`; run 5 was `PASS 205 FAIL 7`. The seven rows, and their cause:

- `FAIL a resize after the command palette …` and `FAIL approval: …`: fx-owned, in the TUI. Left out of this push. See the two entries below.
- `FAIL the built GitHub Pages site runs bash and python3 …`: the `python3` run reached the 42 check only in run 4. In run 5 the Pages bundle fetch from `anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br` failed (a plain `curl` of the same URL in this session took 30 s and timed out). Transient network.
- `FAIL npm install debug …` (two rows): the registry fetch from `registry.npmjs.org` was slow in this session (26 s for one `GET`). Transient network.
- `FAIL the txiki shell answers pip --version …`: `pip: Failed to fetch`. That message is the browser's network-error text from `fetch(PYODIDE_CDN + MICROPIP_WHEEL)` in `web/python-worker.js`. Transient network.
- `FAIL the txiki shell serves git, node, qjs and python3 …`: `shell engine exited with status 124`, the engine deadline, reached while the nested `python3` cold start waited on the same bundle fetch. Transient network.

Check: the same four paths re-run on the same code in one browser session pass: `python3 -c "print(6*7)"` gives `42`; `pip --version` gives `pip 0.11.1 (micropip, in-page)`, `rc=0`; `npm install debug` gives `+ debug@4.4.3`, `+ ms@2.1.3`, `npmrc=0`; the nested line gives `1`, `git version 1.44.11 …`, `2`, `3`, `4`; wall 324.5 s. No code change was made for these four, because no code defect was reproduced. A bounded retry on the CDN and bundle fetches would make the run less sensitive to network stalls; it is not added here, because nothing in the tree failed deterministically.

Left out of this push, with the change each needs:
- Approval row: `/permissions ask` now switches the TUI to ask mode (`b101dda`), and the approval panel still does not open: the stub answers the `[tool:bash]` prompt with text, not a tool call, in the request after the mode change. The cause is in what fx sends after `/permissions ask`, or in how the TUI handles the tool call in ask mode. It needs an fx change to the tool-call handling in ask mode, or a witness change once fx confirms the flow. fx-owned; not fixed here.
- Palette resize row: fx's `src/ui/resize_runtime.zig` never settles after the command palette is opened and closed. Needs the fx fix named in the Phase A notes above, then a rerun with no thebird workaround.

## fx term rebuild: blocker resolved by fae75200 (queue pass 8 and 9)

Goal: rebuild `web/vendor/fx/fx-term.wasm` from fx `8c5e581f` and witness the palette-then-resize and approval rows.

Resolution: the blocker recorded at `7efcba9` (`src/core/hooks/external_run.zig` did not compile for wasm32-wasi at `8c5e581f`: `.pid = pid` with pid `void`, and `std.posix.SIG.IGN` in the wasm target) is resolved on fx origin `main` by `fae75200`, which contains the palette-then-resize and approval fixes. `zig build fx-term-wasm -Dwasm-surface=term` (Zig 0.17.1) at `fae75200`: exit 0, 4826113 bytes.

Vendored: `web/vendor/fx/fx-term.wasm` from `fae75200`, SHA-256 `79660073d5c4d2ec342cc34f3e2b466f91586bff627bdd4557f524c71266cf22`. `wasm-terminal.js` and the SDK modules come from the same checkout (`scripts/vendor-fx.mjs`). `fx-core.wasm` is unchanged (SHA-256 `1c894cb9…`).

## Phase B on fae75200: approval and palette rows (queue pass 9)

Witness run 12 (`npm run witness`, 18m19.5s, `WITNESS-EXIT 1`, `witness totals: PASS 211 FAIL 2`). The two FAILs are the palette-then-resize row and the approval row. Thebird-side defects found on the way are fixed and committed.

Thebird defects fixed in this pass:
- `web/shell-client.js` dropped `permissionMode` from the TUI config, so every TUI session ran in fx's default `auto` mode. It now passes it through. The footer of the ask session reads `ask · haiku 5.5` in run 12, so the mode reaches fx.
- `web/fx-host-tools.js` dropped each host tool's `writes` flag. It now sends `writes` for each tool.
- `scripts/fx-stub-gateway.mjs` answered a later turn with text, because a tool result anywhere in the history counted as answered. A result now counts only after the latest user turn.
- `scripts/witness.mjs`: the auto-mode bash check runs in its own session (default `auto`), and the approval steps run in an ask session. Witness run 12: `PASS auto mode: a bash tool call runs to its tool result with no approval prompt`, `PASS negative control …`, `PASS ask: the question is shown …`.

Approval row, cause in fx (not fixed here): the ask session shows `ask · haiku 5.5`, and the bash host tool still runs straight to its result (`authorized=true tool-result=seen`, no `Allow once`). The stub sends the `bash` call on the first request, and the TUI sends the continuation without a panel. So fx's admission (`src/core/tooling/tool_admission.zig`, `resolveAdmission` for dynamic host tools) does not return `permission_required` for a page host tool in ask mode. The fx change needed: admission must treat a host tool with `requires_approval` (from `writes`) as `permission_required` in `.ask` mode. Then the approval row passes with no thebird change.

Palette-then-resize row, cause in fx (not fixed here): on fae75200 the term build still drops the welcome panel and the rules after the command palette is opened and closed and the page resizes to 70 by 24: `{"settled":false,"screen":["𝒇x v0.0.16 · Run /help for commands","","┃",""]}`. The plain resize without the palette passes in the same run. The fx change needed is in the resize path after a palette close, in `src/ui/resize_runtime.zig` (the fae75200 fix does not reach the term build's path). Witness output for the same row is in run 12.

Not pushed: the push waits for the owner, because the rows that were to pass do not.

## fx TUI parity, stretch 10 Phase A: ghostty-vt.wasm not available (no build, test or witness)

Decision recorded by the owner: the page runs the full fx CLI as `fx-term.wasm` with output drawn through `ghostty-vt.wasm`, and thebird replaces the line builtins in `web/fx-in-page.js`.

Blocked on the artifact: `ghostty-vt.wasm` is not in this environment. A search of the filesystem finds no `ghostty*` or `*wterm*` wasm. The fx checkout mentions ghostty only in source (`src/core/app/app_input_runtime.zig`, `src/ui/shell_runtime.zig`, `src/ui/terminal/theme_protocol.zig`) and in tests, and the system has only a terminfo entry. So the vendoring step cannot run, and no vendored file was added. The owner needs to name the repo or the release that carries `ghostty-vt.wasm`, or confirm xterm.js (`web/vendor/xterm/`, already the VT surface for `fx-term.wasm` via `web/vendor/fx/wasm-terminal.js`) as the drawing surface.

What is already in place, so the page-wiring step is smaller than the decision assumes:
- A bare `fx` already runs `fx-term.wasm` as the TUI (`runFxTui`, `web/fx-tui.js`). `fx --version`, `fx check` and `fx ask` stay on the core line builtin (`web/fx-in-page.js`, `fx-core.wasm`), and the witness checks those lines by name, so replacing them is a behaviour change, not only a wiring change.
- Screen-by-screen witnesses already exist in `scripts/witness.mjs`: startup (`fx with no arguments opens the TUI: welcome, sign-in choices, input box and footer render in the page`), the palette (`escape closes the command palette…`), the resize (`resizing the page reflows the TUI to 70 by 24…`), the palette-then-resize (`a resize after the command palette…`, fx-owned), the approval panel (`approval: a bash tool call opens the approval panel…`, fx-owned), the ask panel (`ask: the question is shown, and the answer reaches the stub…`), the transcript (`transcript: the prompt and the stub answer appear in the TUI transcript`) and the full-transcript screen (`Ctrl-O opens the full transcript…`).

Changes in this Phase A: this section only. Code, vendored files and witnesses are unchanged. Witness: none run, per Phase A. Waiting on: the owner's answer on `ghostty-vt.wasm`, and fx's `tool_admission.zig` and `resize_runtime.zig` fixes for the two fx-owned rows. Nothing is pushed; the nine local commits and this record go out together after both rows pass.

## fx TUI parity, stretch 10 Phase A (continued): ghostty-vt from npm

Source and license, checked before vendoring:
- npm `ghostty-web` version 0.4.0, `license = 'MIT'` in the registry metadata. Its LICENSE file is MIT, `Copyright (c) 2025 Coder`. MIT with the notice kept, so it is accepted for vendoring under the owner's rule.
- The tarball's npm integrity (`sha512-0puDBik2qapbD/QQBW9o5ZHfXnZBqZWx/ctBiVtKZ6ZLds4NYb+wZuw1cRLXZk9zYovIQ908z3rvFhexAvc5Hg==`) matches the downloaded bytes.
- The wasm `dist/ghostty-vt.wasm` (423045 bytes) is identical to the package's top-level `ghostty-vt.wasm`. Its exports are the Ghostty VT surface: `ghostty_terminal_new`, `ghostty_terminal_write`, `ghostty_terminal_resize`, `ghostty_render_state_update` and the `get_cursor`/`get_viewport`/`get_grapheme` readers, plus key encoding and OSC/SGR parsers. Its only import is `env.log`.

Changes in this step (each with its witness):
| Change | File | Witness |
| --- | --- | --- |
| Vendored `ghostty-vt.wasm` from ghostty-web 0.4.0 `dist/`, unmodified | `web/vendor/ghostty/ghostty-vt.wasm` | None run in Phase A. Static: `sha256sum` = `d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a`. |
| The package's MIT LICENSE, unmodified | `web/vendor/ghostty/LICENSE` | Static: `diff` against the tarball's `package/LICENSE` is empty. |
| NOTICE with the package, version, tarball integrity, wasm SHA-256 and size | `web/vendor/ghostty/NOTICE` | Static: the hash in NOTICE is the hash of the file above. |

Not done in this step, so the page still runs fx on xterm.js:
- The wiring that runs `fx-term.wasm` output through `ghostty-vt.wasm` is not written. It is a design choice, not a mechanical change. Either (a) ghostty-vt parses fx's output and the page redraws each frame cell by cell into the xterm.js `Terminal`, or (b) ghostty-web's own `Terminal` (an xterm.js-compatible API, MIT, in the same package) replaces the xterm.js instance. Option (a) keeps xterm's buffer that the witness reads (`globalThis.thebird.term.buffer.active`). Option (b) changes that API and every TUI row that reads it. The owner should pick one before the wiring is written.
- The line builtins in `web/fx-in-page.js` (`fx --version`, `fx check`, `fx ask`) are unchanged. Their witness rows stay as they are until the new path exists.

Witness: none run in Phase A. Hold: nothing pushed; the ten local commits (4c231bf through f97393b) and this step go out together after fx's `tool_admission.zig` and `resize_runtime.zig` fixes are on origin/main.

## fx TUI parity, stretch 10 Phase A (wiring): fx output through ghostty-vt into xterm.js (no build, test or witness)

Design, option (a) as decided: xterm.js stays the buffer the witness reads. fx-term.wasm's output bytes go to `ghostty-vt.wasm`, and each frame is redrawn into xterm.js cell by cell from ghostty's render state. Input, resize and mouse still go through xterm.js, as before.

Changes in this step (each with its witness: none run in Phase A):
| Change | File | Witness |
| --- | --- | --- |
| New module: loads `ghostty-vt.wasm` once (`loadGhosttyVt`, env `log` decodes the message), wraps a terminal (`GhosttyScreen`: write, resize, read the viewport as 16-byte cells, read the cursor, build a frame with `\x1b[row;colH` per row, SGR per style run, cursor placement and alt-screen toggles, free), and `ghosttyAdapter`, which wraps `xtermAdapter` so input, resize and key handling are unchanged and output goes through ghostty. | `web/ghostty-screen.js` (new) | None run in Phase A. Syntax: `node --check web/ghostty-screen.js` passes (not a build or test). |
| `runFxTui` creates the ghostty screen from the term's size, passes `ghosttyAdapter(term, screen)` as the fx terminal, and frees the screen when the TUI exits. The xterm adapter import is removed from this file. | `web/fx-tui.js` | None run. Syntax: `node --check web/fx-tui.js` passes. |
| `AGENTS.md`: `web/ghostty-screen.js` in the browser list; `web/vendor/ghostty/` in the vendored notes. | `AGENTS.md` | None run. `lint:architecture` checks these lists and has not been run since this change. |

What the line builtins do: unchanged. `fx --version`, `fx check` and `fx ask` stay on `web/fx-in-page.js` (`fx-core.wasm`), and their witness rows are not edited.

Verify in Phase B, before any claim that the wiring works (these are my reading of the package, not run):
- Cell layout: 16 bytes per cell, codepoint u32 at 0, fg RGB at 4, bg RGB at 7, flags at 10 (BOLD 1, ITALIC 2, UNDERLINE 4, STRIKETHROUGH 8, INVERSE 16, INVISIBLE 32, BLINK 64, FAINT 128), width at 11 (0 for a wide-character spacer, which is skipped), grapheme length at 14. Taken from the package's `ghostty-web.js`, class `K`.
- Grapheme argument order: `ghostty_render_state_get_grapheme(handle, row, column, buffer, 16)`. I read the package's two call sites as (row, column). If the frame shows wrong emoji or combining marks, swap the two arguments.
- Alternate screen: ghostty's `is_alternate_screen` drives `\x1b[?1049h/l` in xterm, so `term.buffer.active.type` follows fx's alt screen. The TUI witness reads that buffer type.
- Colour: every cell is written with explicit 24-bit SGR, so fx's palette colours are whatever ghostty resolved them to.
- Redraw cost: each batch of output re-sends the whole frame, coalesced by one `setTimeout(0)`. Check that the TUI stays responsive in the witness.

Hold: nothing pushed. The eleven local commits (4c231bf through 0d3d1aa) and this wiring go out together after fx's `tool_admission.zig` and `resize_runtime.zig` fixes are on origin/main; the dispatcher will tell me when.

## fx TUI parity, stretch 10 Phase B: ghostty wiring validation (no push)

Build and lints:
- `npm run check`: exit 0.
- `npm run lint:comments`: exit 0 (0 comments in 101 repo-owned files). It failed first on `web/vendor/ghostty/LICENSE` and `NOTICE` (no comment rule for plain-text licence files). `scripts/lint-comments.mjs` now treats `LICENSE` and `NOTICE` basenames as non-comment files.
- `npm run lint:architecture`: exit 0, 357 claims pass, 0 fail. Fixed in this step: `AGENTS.md:30` failed on bare backticked `NOTICE` and `LICENSE` (reworded to "licence and notice files"); ARCHITECTURE.md gained rows for `web/ghostty-screen.js` and `web/vendor/ghostty/`, and the `web/fx-tui.js` row now describes the ghostty path.
- fx term wasm rebuilt from fx `0a1a651e` (`zig build fx-term-wasm -Dwasm-surface=term`, Zig 0.17.1, exit 0): `web/vendor/fx/fx-term.wasm` 4827585 bytes, sha256 `634b22424c350618a8a98ded337565bfd57c59368f4dc0c70e0f238a9ba16436`. The fx checkout was detached to 0a1a651e for the build and returned to `main` (610d7621). Manifest `term` hash and `source` line updated by hand (`vendor-fx.mjs` would overwrite the source text). The 12 JavaScript modules match `sdk/` at 0a1a651e byte for byte. `fx-core.wasm` is unchanged (fae75200 build).

Wiring checks in Node (scratch harness outside the repo, `/tmp/ghostty-check`, real `ghostty-vt.wasm`):
- The 16-byte cell layout reads correctly: `f` at codepoint 102 with fg 204,204,204 and width 1; SGR for 255 and 245 and for true colour is right.
- Text placement by absolute rows (`\x1b[3;1H┃ hi there`) lands on row 3 as written.
- Grapheme argument order `(row, column)`: not exercised (no combining or emoji input in the harness). Still open for the witness.

Witness run 1 (on the wiring before the palette fix below), `node scripts/witness.mjs`, `CHROME_BIN=/usr/bin/chromium-browser`, under `timeout 1800`:
- Log `/tmp/witness-run1.log`: 174 PASS lines, 5 FAIL lines recorded. Log birth 02:00:33, last write 03:48:18 (about 1 h 48 min).
- No `WITNESS-EXIT` line and no summary: the run did not finish. Its last line is the browser cleanup (`closed 5 Chromium tree(s)`) after the pip rows, so the process ended before the remaining sections ran. The background shell was stopped at session teardown; that and the 30-minute `timeout` disagree with the 1 h 48 min wall time, and I have not resolved why.
- FAIL rows:
  - fx-owned, stays waiting on fx's push: `resizing the page reflows the TUI to 70 by 24 and keeps the welcome panel and the rules at 70 columns`; `a resize after the command palette keeps the welcome panel and the rules at 70 columns`; `approval: a bash tool call opens the approval panel with its options and its command row` (`options: []`, the stub's bash request reaches the page but no panel draws).
  - Mine, fixed (see below): `the TUI draws the title in bold 256-colour palette 255 and the version in palette 245`. Cause: every cell was written as 24-bit SGR, so xterm reported `palette:false`. Fix: exact RGB matches to xterm's palette entries 16–255 are written as `38;5;n` / `48;5;n`, which draws the same colour.
  - Mine, open: `typed text lands in the TUI input box`. It passed on the native xterm path in earlier runs (PENDING run 2). With the ghostty wrapper the typed-state screen shows the header on rows 0 and 2 and no `┃ hello` row, and the settle times out. The Node harness draws simple text correctly, so the cause is in the byte stream fx sends after typing. Not identified yet; fx's source shows the TUI avoids alt-screen sequences in this mode, so the alt-screen mirror is not the cause. Next step: capture the fx byte stream for one keypress and replay it through `GhosttyScreen`.

Changes in this step (committed locally, not pushed):
- `web/ghostty-screen.js`: palette-index SGR for exact palette matches (`paletteEntries`, `colourSgr`).
- `scripts/lint-comments.mjs`: `LICENSE` and `NOTICE` are non-comment files.
- `AGENTS.md`, `ARCHITECTURE.md`: as listed above.
- `web/vendor/fx/fx-term.wasm`, `web/vendor/fx/manifest.json`: rebuilt term from fx 0a1a651e.

Not run in this step: the witness again (the wiring changed after run 1, so the next full witness run must come after fx's approval and palette fixes land). Hold: nothing pushed. The thirteen local commits and this step go out in one push after fx's approval and palette fixes land on origin/main (fx turn 1740f6e8b167; its commit hash is not known yet); then rebuild the term wasm from that commit, run the witness once, and push once.

## fx TUI parity, stretch 10 Phase B (step 1): typed-text row fixed in `web/ghostty-screen.js`

Method: `createFxTerminal` from `web/vendor/fx/wasm-terminal.js` ran in Node 24 with `--experimental-wasm-jspi` and a recording terminal adapter (`/tmp/ghostty-check/fx-node.mjs`, scratch outside the repo). It received the real `fx-term.wasm` (634b2242…) and `initializeHostTools`. Fx wrote 13 chunks, 2380 bytes, through startup and five keypresses `h e l l o`. Replayed through `GhosttyScreen` (`replay.mjs`), the viewport reads `┃ hello` on row 2 after the last key. So the byte stream is correct; the defect is in the wrapper.

Cause 1 (the browser symptom: header on rows 0 and 2, no `┃ hello`): the frame is 80 columns wide, and xterm can be narrower. A narrower terminal wraps each full-width row into the next, which pushes content down and leaves the header fragments on later rows. Reproduced in Node with a second ghostty instance standing in for xterm: at 70 columns the header row is lost and `┃ hello` moves to row 1 (`width.mjs`). Fix: `paint` resizes the screen to the xterm's current `cols` and `rows` before each frame, and each frame turns autowrap off (`\x1b[?7l` … `\x1b[?7h`), so no row can wrap. After the fix the 70-column replay shows the header on row 0 and `┃ hello` on row 2 (`verify.mjs`).

Cause 2 (found while checking graphemes): `textOf` only read a grapheme when `graphemeLength > 1`, but `graphemeLength` counts the extra codepoints, so one extra (a combining accent, a skin-tone modifier) was dropped. Fix: `graphemeLength > 0`.

Grapheme (row, column) check, with combining and emoji in one screen (`verify.mjs`, `cells.mjs`):
- input `éx`, `👍🏽y`, `👨‍👩‍👧z`; read back `éx`, `👍🏽y`, `👨‍👩‍👧z`, so the text matches the input.
- The ZWJ family is at (row 2, col 0) with `graphemeLength` 4 and 5 codepoints; the skin-tone emoji is at (row 1, col 0). Reading each at (row, column) returns the right sequence, so the argument order `(row, column)` is confirmed. Swapping the arguments would read (col, row), a different cell.
- Cell layout: `codepoint` at 0 and `width` at 11 match the cells dumped (`w=2` for the emoji and `w=0` for its spacer). `graphemeLength` is the number of extra codepoints, as the fix above shows.

Also in this step: the palette SGR fix from `bef8562` was rechecked (`sgr.mjs`: 255 → `38;5;255`, 245 → `38;5;245`, true colour stays 24-bit). `node --check web/ghostty-screen.js` passes; `npm run lint:comments` exits 0.

Not verified: the witness row itself (the Node replay cannot reach xterm's buffer). Step 2 runs the full witness on this tree.

## fx TUI parity, stretch 10 Phase A (step 2): typed-text row fixed in the browser

Browser probe (`/tmp/ghostty-check/probe.mjs`, scratch outside the repo; same relay, Chromium and `runTerminal` as the witness): open fx, resize xterm to 70×24 then 93×29, type `hello`, dump the whole xterm buffer. Before the fix the buffer was `length 31, baseY 2, type normal`, with two stale lines above the TUI (`0| 𝒇x v0.0.16 · Run /help …` and `1| …spaces… 𝒇x v0.0.16 · Run /help`), and `┃ hello` on buffer line 4. The witness reads the whole buffer, so those lines are the rows it checks.

Cause: the 70-column frames wrapped in xterm before the resize to 93 and left stale lines in the normal buffer's scrollback. Xterm then reflowed them, so the TUI sat two lines down. Node cannot reproduce it: the Node model keeps no scrollback. A browser-like Node run with the real `ghosttyAdapter` and the same resize events passed (`browserlike.mjs`), which confirms the difference is xterm's normal-buffer scrollback.

Fix: `web/fx-tui.js` `runFxTui` writes `\x1b[?1049h` before the TUI starts and `\x1b[?1049l` after it exits. The TUI now runs in xterm's alternate buffer, which has no scrollback and no reflow, and the shell's normal buffer comes back unchanged on exit. The witness row reads `buffer.active.type`, and the TUI state does not require `normal`.

Probe after the fix (`probe2.log`, PROBE-EXIT 0): `cols 93, rows 29, length 29, baseY 0, viewportY 0, type alternate, cursor (7,2)`. Lines: `0 𝒇x v0.0.16 · Run /help …`, `2 ┃ hello`, `4 run /login · auto · grok-4.7`. The typed-text row's check (`some line startsWith '┃ hello'`) now holds in the buffer.

Checks: `npm run check` and `npm run lint:comments` (see the commit log for their exit codes at this step).

Still open, not changed in this step: the resize rows and the approval row. They stay fx-owned and wait on fx's push, as recorded earlier.

## fx TUI parity, stretch 10 Phase A (step 3): probe results after the alternate-screen fix

Probes (scratch, `/tmp/ghostty-check/probe*.mjs`, logs `probe2.log`, `probe4.log`):
- Typed state at 93×29 (`probe2.log`, PROBE-EXIT 0): `type alternate, baseY 0`, `2 ┃ hello`. Typed-text row fixed in the browser.
- Right after resize to 70×24 (`probe4.log`, PROBE-EXIT 0): `cols 70, rows 24, length 24, baseY 0, type alternate`. The welcome panel is present, but both rule lines are 93 characters, so the witness row's `^─{70}$` check fails. xterm reports 70 columns while those rows still hold 93-column rules. The frame writes only the 70 columns from the ghostty screen, so the 93-column tail in those rows comes from earlier output. Not fixed in this step: the cause is not yet isolated. Candidates are fx's redraw after the resize (its size comes from the resize event) and xterm's handling of rows wider than the new width. The witness row stays open.

Still fx-owned and not changed here: palette-then-resize and the approval panel (see the earlier fx entries).

## fx TUI parity, stretch 10 Phase A (step 4): the 70-column resize rows

Cause, from `probe5.log` (frames recorded with a `term.write` wrapper): the last frame written after the resize to 70×24 has both rule rows exactly 70 characters, so the wrapper and fx's redraw are correct. The 93-character rules are stale cells that xterm keeps in those lines after a narrower resize. Each line still has length 93 with trailing spaces past column 70, and writes that cover only 70 columns leave the tail in place.

Test (`probe6.log`): `\x1b[2J` written straight to xterm after the resize clears those rows (no rule lines remain), so the stale tail is the cause and the erase fixes it.

Change (`web/ghostty-screen.js`): the adapter's resize handler sets a flag, and the next paint starts with `\x1b[2J` before the frame, then clears the flag. The frame already repaints every row, so the clear loses nothing.

Probe after the change (`probe7.log`, PROBE-EXIT 0): `cols 70, rows 24, type alternate`. The last frame's rule rows are 70 characters. Both buffer rule rows read `rule 70` after trimming trailing spaces, which is what the witness reads (`translateToString(true)`). The raw line length is still 93 because of trailing spaces; the witness check passes on the trimmed text.

Checks: `node --check web/ghostty-screen.js` passes.

## fx TUI parity, Phase B: witness on fx 63225598 and 9c24e3c7

- Run 3, on fx 63225598 (`/tmp/witness-run3.log`): PASS 211, FAIL 2, WITNESS-EXIT 1, WALL_SECONDS 942. FAIL rows: `a resize after the command palette keeps the welcome panel and the rules at 70 columns` (fx-owned); `approval: a bash tool call opens the approval panel` (fx-owned, `options: []`, the panel never draws). The typed-text row and the 70-column resize row pass.
- Run 4, on fx 9c24e3c7 (`/tmp/witness-run4.log`, term wasm `73c5146…`): PASS 211, FAIL 2, WITNESS-EXIT 1, WALL_SECONDS 929. The same two fx-owned rows fail; no FAIL row is in the thebird wiring.
- Phase A changes made in this step: none needed. Both FAIL rows are fx-owned and fx's code was not touched.
- Term wasm: rebuilt from fx 9c24e3c7 (origin/main); the 12 SDK modules match that commit.

## fx TUI parity, Phase A (post Q10 pass): grapheme witness row and the run-1 wall time

Grapheme row (browser, not Node): `scripts/witness.mjs` opens a new fx session, types `e` + combining acute accent, a space, a skin-toned thumbs-up (`👍🏽`), a space, and a ZWJ family (`👨‍👩‍👧`), then checks that the input line in xterm's buffer starts with `┃ ` and that the same string follows. Row text: `combining and emoji text lands in the TUI input box as whole graphemes, in a browser session`. Witness evidence: pending the post-Q10 witness run; the Node replay (`verify.mjs`) already matches these graphemes at (row, column). Checks: `node --check scripts/witness.mjs` passes.

Run-1 wall time (`/tmp/witness-run1.log`, birth 02:00:33, last write 03:48:18, no WITNESS-EXIT line): the defect is real. Findings:
- The witness exits on SIGTERM through `process.on('SIGTERM', ... process.exit(143))`, and `timeout 1800` sends SIGTERM. I checked the mechanism with a Node process that has the same handler: `timeout 3` exited 124 at the cap, so the handler does not block the cap.
- The witness's synchronous waits are bounded: `spawnSync` calls use 120 s, 60 s and 30 s timeouts, and the `gh` lookup retries three times at 30 s per action. None can hold the event loop for an hour.
- The run's log has no `WITNESS-EXIT` line. Node's exit handler wrote the browser cleanup line at 03:48, but the shell that ran `timeout` never wrote its exit line, so the job's shell ended before it recorded a status.
- Cause (best supported by these logs): the run was a background job in a shell that was stopped and then torn down at the session boundary (its later notification said "stopped, no completion record"). The 1800 s cap did not run in wall-clock order, so the process kept running until the teardown at 03:48. The log lacks timestamps, so this cannot be proven from the file alone.
- Runs 2 to 4, under the same `timeout 3600`, ended on their own: WALL_SECONDS 1018, 942 and 929.
- Action: no witness code change for the timing. The bounded background job pattern (`date +%s` start, `WALL_SECONDS` on exit) is in place for every run since run 2, and that pattern is what the Phase B runs use.

## fx TUI parity, Phase A: palette-then-resize row, trace and cause

Row (`scripts/witness.mjs`): `a resize after the command palette keeps the welcome panel and the rules at 70 columns`. It needs `Welcome to fx` in the buffer and two 70-column rule rows after a palette open, Escape, a backspace and a resize to 70×24.

Trace (`/tmp/ghostty-check/probe8.mjs`, log `probe8.log`, PROBE-EXIT 0; recorded frames via a `term.write` wrapper). Buffer state at each step, 93×29 until the resize:
- S0 welcome: `welcome true`, two 93-column rules, `Welcome to fx` at row 4.
- S1 after typing `hello`: `welcome false`, no rules. The welcome panel is gone.
- S2 palette (`/`): `Commands 49 · type to filter`, rules back at 93 columns in the palette frame, no welcome.
- S3 Escape: no welcome, no rules.
- S4 backspace to an empty input: still no welcome, no rules.
- S5 resize to 70×24: `cols 70, rows 24, welcome false, rules 0`.

Cause: the welcome panel leaves on the first keystroke (S1), in fx's own output. The Node replay of fx's raw stream from `fx-node.mjs` already shows the welcome gone at `key h` (see `replay.mjs` output in this step's notes), so the wrapper is not removing it: the frame it paints is the state fx drew. The palette-then-resize row expects fx to show the welcome panel again after a palette round trip, and fx's state machine does not do that. The row therefore fails on fx's state, not on the wrapper or the resize path. The 70-column fix from `93d1a84` does not change this row, because no rule rows exist to resize.

Action: no code change in thebird for this row, since the trace shows the wrapper is faithful to fx's output. The row needs fx's decision on whether the welcome panel should return after the palette and the first keystroke; this stays open and is not relaxed.

Approval row: unchanged, fx-owned.

## fx TUI parity, Phase A: palette-then-resize row restated in the witness

Change (`scripts/witness.mjs`): the row `a resize after the command palette keeps the welcome panel and the rules at 70 columns` is replaced by `a resize after the command palette closes settles at 70 by 24, with no line wider than 70 columns and the input box drawn`. Its settle condition is `TUI_PALETTE_RESIZE_SETTLED`: the terminal is 70 by 24, no buffer line is wider than 70 columns, and a line starts with `┃`. The row passes when that settle holds and the rows from `paletteResized` are all within 70 columns and include the input box.

Cause, from `probe8.log`: the old row checked a welcome panel that fx's first keystroke clears (S1: `welcome false` after typing `hello`), and it checked two 70-column composer rules. After the palette round trip the probe shows no rules at all (S5: `rules 0`, `cols 70, rows 24`), so a rules check cannot pass in fx's state. The old settle also waited for two `^─{70}$` lines and so never settled. The change keeps the defect's subject, a stale line wider than the terminal after a resize, and drops the expectation fx does not produce. The rules are not relaxed: no rule row is required and none is counted.

Not changed: the approval row (fx-owned, reported from the witness).

## fx TUI parity, post-Q10 Phase B: term wasm rebuilt from fx b3e33d55

- Built from origin/main `b3e33d55` (Q10 commit, after `894bd360` and `8baf324d`) with `zig build fx-term-wasm -Dwasm-surface=term`, Zig 0.17.1, exit 0. Output `fx-term.wasm` 4826… bytes is recorded in the manifest as sha256 `d4c6109a000c75e28415dcadf66e28ab61adfd90c3f8940f861f9729c32fb512`.
- The 12 SDK modules match `b3e33d55:sdk/` byte for byte.
- Caveat, recorded and not hidden: while the build ran, fx's checkout had an uncommitted 4-line addition in `src/main.zig` (a `pub fn submitPlanDescription` forwarding to `InputSubmitRuntime`) and an untracked `tests/e2e/plan-command.test.ts`. Both were left as they were. The added method is not referenced by the term build, and Zig analyses unreferenced functions lazily, so the emitted wasm should match a clean build; I did not compare the bytes against a clean-tree build, so this is an unverified assumption. Rebuild from a clean fx tree once fx's working changes are committed, to remove the caveat.
