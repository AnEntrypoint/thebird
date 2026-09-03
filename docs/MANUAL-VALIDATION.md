# Manual validation

thebird keeps **no automated test suites and no test-running CI** — validation is
exclusively exhaustive manual troubleshooting/debugging (see AGENTS.md
"Validation policy"). The `validate.html` harness was removed because its
headless-CI run flaked on the 61 MB `plugkit.wasm` cold-load, and the
`witness-ci.yml`/`witness-core.yml` workflows were removed for the same class of
CI-vs-local divergence. The `scripts/witness-*.mjs` puppeteer probes below are
**manual debugging tools**: boot the OS locally and run them by hand, each
asserting one surface, reading the real output yourself.

## Prerequisites

```bash
bunx serve docs            # serves the web-OS at http://localhost:3000 (→ /os)
bunx acptoapi@latest       # optional: LLM gateway on :4800, needed for chat/tool-use
```

(`npx serve docs` / `python -m http.server -d docs` work too.)

Each probe takes the base URL as `argv[2]`; default is `http://localhost:3000/`.
The gm-wasm cold-load (plugkit-slim ~3.6 MB + bert ~136 MB, the dominant cost)
takes ~8–15 s on a quiet local server — gm-dependent probes wait on the host's
`globalThis.__GM_BOOT_STAGE__` progress signal (see `waitForGmReady` in
`scripts/witness-lib.mjs`), so a failure report names the exact boot stage it
stuck on. A headless run may OOM on the cold wasm; that is an environmental
limit of headless Chromium, not a code regression (real browsers load it fine).

## Running via the manifest (recommended)

`scripts/witness-manifest.mjs` is a tagged runner over all `scripts/witness-*.mjs`
probes — see its own header comment for the full tag scheme (`core`, `apps`,
`chat`, `freddie`, `perf`, `demos`). It spawns each probe as its own process
against a single already-running `bunx serve docs`, prints a per-script
pass/fail + exit code, and exits non-zero if any probe failed.

```bash
bunx serve docs -l 3000
npm run witness                        # every probe, serially
node scripts/witness-manifest.mjs --tag=core            # fast, no-wasm, no-network subset
node scripts/witness-manifest.mjs --tag=freddie,chat     # gm/acptoapi-dependent subset
node scripts/witness-manifest.mjs --list                # print the manifest without running
```

`--tag=core` is the fast local subset
— it excludes anything that cold-loads plugkit.wasm, needs a live acptoapi
daemon, or defaults to the live deployed URL instead of the local build.
Concurrency defaults to 1 (serial): every probe drives the same origin's
IndexedDB/shell state under its own ephemeral puppeteer profile, so parallel
runs don't collide on storage, but they do compete for CPU/memory — several
concurrent plugkit.wasm cold-loads was the exact flakiness class that got the
old `validate.html` CI run removed, so raise `--concurrency=N` deliberately,
not by default.

## Probes

| Script | Asserts |
|---|---|
| `witness-app-matrix.mjs` | shell boots; every registered app opens (canvas/xdisplay/monitor/todo/gm/about additionally checked for real interactive content); theme flips auto/paper/ink; uniform 34px bars; freddie dashboard renders; 0 real console errors — merges the former `witness-full-audit.mjs` + `witness-remaining-apps.mjs` |
| `witness-app-functions.mjs` | freddie dashboard sub-page nav, terminal xterm mounts, files app renders |
| `witness-wm-persist.mjs` | build N windows + maximize + 2 instances → reload → full 1:1 restore |
| `witness-edge-cases.mjs` | keyboard nav (Ctrl+Shift+N / Esc / Backquote), theme persists across reload, shell survives a throwing app factory, multi-instance isolation |
| `witness-ui-interactions.mjs` | chat composer typing+send+placeholder; double-click titlebar maximize/restore; window resize handle |
| `witness-deep-churn.mjs` | app open/close churn ×15 (no leak/crash), theme cycle ×10, dashboard sub-pages render content |
| `witness-a11y.mjs` | open a window and assert the ARIA additions from the windows/menubar/instance-switcher/resize a11y pass are present in the live DOM |
| `witness-camera.mjs` | merged camera spec (4 isolated cases): desktop-camera boot, gestures, input, pan/zoom persistence — absorbs the former `witness-desktop-camera`/`witness-camera-gestures`/`witness-camera-input`/`witness-camera-persist` |
| `witness-chat.mjs <url> "<prompt>"` | merged chat spec (5 isolated cases): config strip, real LLM roundtrip via the acptoapi gateway, scroll containment, seed-large history, ws-chat — absorbs the former `witness-chat-config`/`witness-chat-roundtrip`/`witness-chat-scroll`/`witness-chat-seed-large`/`witness-ws-chat` (needs acptoapi up for the roundtrip/ws cases) |
| `witness-gm-dispatch.mjs` | gm `memorize` → `recall` round-trip returns `vector_top_k` with the stored fact (warms the MiniLM embedder first) |
| `witness-freddie.mjs` | merged freddie spec (4 isolated cases): boot diag, gm-tool chained memorize→recall, freddie GUI render, dashboard render — absorbs the former `witness-freddie-diag`/`witness-freddie-gm-tool`/`witness-freddie-gui`/`witness-freddie-render` |
| `witness-fsbrowse.mjs` | files app: mkdir/create/rename/view/delete against the per-instance fs, per-instance isolation |
| `witness-opfs-fs.mjs` | OPFS-primary fs: real write → real OPFS file check (bypassing instance-fs.js) → real reload → read-back from OPFS (not IndexedDB) → delete |
| `witness-audit-log.mjs` | audit log (`docs/audit.js` `createAuditLog`) end-to-end: drive a real terminal command through the real shell, read `/var/log/audit.json` back via the per-instance fs, assert shape + secret masking |
| `witness-git-sync.mjs` | real in-browser git clone driven through the ACTUAL terminal app (real xterm keystrokes → real shell → real isomorphic-git clone over the network) |
| `witness-interactive.mjs` | terminal POSIX command exec (type + get output), freddie config write-back (set via gm/host config, read back), freddie chat error-recovery (forced error shows a graceful UI message) |
| `witness-libsql-native.mjs` | proves thebird uses REAL libsql (compiled into plugkit.wasm), not the JS kv/substring fallback, for all three consumers (sqlite-shim npm apps, freddie, gm) — arbitrary DDL+DML+DQL only a real SQL engine can execute |
| `witness-index.mjs` / `witness-live-probe.mjs` | landing page boots with `window.__debug.shell`, no module-resolution / xstate errors |
| `witness-launcher.mjs` | apps menu + side rail list freddie and the system submenu |
| `witness-autoboot.mjs` | clean-storage fresh boot auto-opens freddie + terminal |
| `witness-rename.mjs` | stack-name rename: visible labels read generic ('assistant'/'memory'/'gateway'), old stack jargon gone from visible text, OS still boots + apps open |
| `witness-bird-research.mjs <url> "<bird>"` | headline pipeline: freddie `web_search` → `write` a vibe-coded site into the IDB fs → read back + displayable (drives `host.pi.tools` via `__freddieRuntimeBridge`) |
| `witness-responsive.mjs` | sweep 390/768/1400/1920 → no horizontal overflow, uniform 34px bars, and `.fd-root .app` width > 100 at every size (regression guard for the desktop `.app`-collapse fix) |
| `witness-browser-pane.mjs` | open the browser app, navigate `createBrowserPane` to a site, assert the pane loaded + the xstate `browserMachine` tracked history |
| `witness-all.mjs` | serial runner over every probe (each as a child process, tallies the JSON reports) — the original runner; `witness-manifest.mjs`'s tagged runner above is the recommended one |

`scripts/witness-lib.mjs` is the shared helper library (`bootBrowser`, `assert`, `waitForGmReady`, `printReportAndExit`, ...), not a probe — every script above imports it.

> Cross-browser and shell-fidelity checks are driven live via the gm `browser` verb (not a standalone script) — dispatch `session new`, navigate to `os.html`, then `page.evaluate` a `createShell`/`window.__debug.idbSnapshot` harness inline. The `browser` verb only drives Chromium; there is no dedicated multi-engine probe.

> Probes that open instance-bound apps must wait for `shell.active` (or any `.wm-win`) before calling `openApp`, or autoboot's pre-instance race throws `app factory: no active instance`. The probes above already do this poll.

Run one directly:

```bash
bun scripts/witness-app-matrix.mjs http://localhost:3000/os.html
bun scripts/witness-chat.mjs http://localhost:3000/os.html "reply only the word pong"
```

A probe prints a JSON report and exits non-zero on assertion failure. Read the
report — most fields are self-describing (`gmReady`, `recallMode`, `barHeights`,
`appOpen`, `errors`). The only routinely-present console error is a harmless
manifest `404` (offline fallback handles it).

## Service-worker drift

After editing `docs/sw-instance.js`, regenerate the static per-instance SWs and
commit them:

```bash
node scripts/gen-static-sws.mjs
git diff docs/sw-i*    # should be intentional changes only
```

CI enforces this via `.github/workflows/sw-drift.yml` (one of the four non-test
guards kept under the manual-only validation policy — it is fast and does not
load the wasm).

## Kept CI checks (non-test guards only)

There is **no CI witness gate** — `witness-ci.yml`/`witness-core.yml` were
removed 2026-07-29 under the manual-only validation policy (CI-vs-local
divergence plus headless-Chromium flakiness on the wasm cold-load; see AGENTS.md
"Validation policy"). The only workflows in `.github/workflows/` are non-test
guards, none of which run the witness probes:

- `gh-pages.yml` — deploy the flatspace landing build to GitHub Pages.
- `syntax-check.yml` — parse lint over the JS sources.
- `sw-drift.yml` — codegen-drift guard for the static `docs/sw-iN/` workers
  (re-runs `scripts/gen-static-sws.mjs` and fails on diff).
- `sync-upstream.yml` — vendor freshness (the `refresh-*.mjs` pipelines).
