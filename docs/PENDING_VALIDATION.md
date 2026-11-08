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

## Open decisions

- `scripts/vendor-pyodide.mjs`: retired in 18403ed, with its references in ARCHITECTURE.md, AGENTS.md, README.md and `scripts/lint-architecture.mjs` changed in the same commit. The stale local directory `web/vendor/pyodide/` is untracked and was not deleted; remove it by hand when convenient.
- Pyodide bundle licence: held by the owner. The stripped bundle at `https://anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br` is not changed by this pass, and its licence is not confirmed. `web/vendor/PYODIDE-NOTICE.md` records it as held by the owner, not yet confirmed.
