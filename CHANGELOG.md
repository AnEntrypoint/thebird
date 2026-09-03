## 2026-08-09

- fix: AAA-quality-bar audit fixes across GUI polish, agent tool-call correctness, boot perf, and robustness (commit 868f8f0) — native blocking `prompt()`/`confirm()`/`alert()` in fsbrowse/notes/workspaces apps replaced with themed `<dialog>` modals; workspace rename routed through the shared `openRenameModal`; workspaces' 500ms full-DOM poll replaced with an xstate actor subscription; a cross-instance tool-bridge race in `freddie-chat.js`'s `bridgeAgentTools` fixed (was only re-bound once per turn, not per iteration); the `edit` tool now resolves relative paths via `resolveCwd` like every other tool; `freddie-loader.js`'s module-top-level `await` removed from the boot-critical import chain so shell chrome renders before the freddie bundle fetch resolves; 12 eagerly-imported core apps in `apps.js` converted to on-demand dynamic import; `os-shell.js` instance-persist writes serialized onto a single-flight promise chain, `worker.ready` bounded with a 30s timeout, and `destroyInstance` teardown failures surfaced via toast instead of silently leaking. Found via a 4-dimension multi-agent audit workflow (90 sub-agents, adversarial 3-vote verify per finding), then fixed and live-witnessed (0 pageErrors, 0 console errors) turn by turn.

## 2026-08-06 – 2026-08-07

- feat(design): OS shell / freddie dashboard design-system fixes — LIVE/status color split onto its own `--sky` hue (was collapsed into brand/success green); real window open/close/minimize/restore animations (`wm-minimizing`/`wm-restoring`/`wm-closing` keyframes + `@starting-style`, deferring `display:none`/`el.remove()` until the transition actually finishes); duotone fill-wash on active-state icons; subtle radial-gradient desktop wallpaper; Kpi stat tiles gain a border + hover elevation + optional icon-glyph slot; freddie dashboard tables gain zebra striping, non-clickable row hover, and numeric-column right-alignment; freddie analytics' literal `'?'` fallback for unknown session platform/model replaced with a designed `'unknown'` label; measured real WCAG contrast ratios live and fixed the one genuine AA failure (unfocused window title, 4.25:1 → 4.81:1). Landed in `anentrypoint-design` (commits f4a03b9, 0efa25b) and vendored into thebird (commit 576b7f2). Live-witnessed via the `browser` verb against a running `bunx serve docs` instance for every fix.
- fix(gm-tooling): root-caused and fixed a `gm` DECIDE→COMPLETE gate false-positive — `submodule_head_sha()` in rs-plugkit trusted `git rev-parse HEAD` run with cwd set to an uninitialized submodule directory, which silently walks up to the parent repo instead of erroring, spuriously flagging drift for any consumer repo (like this one) whose vendored submodules aren't locally checked out. Fixed upstream in `AnEntrypoint/rs-plugkit` (commit 0bdf455) and `AnEntrypoint/gm` (commit 90111ff6); confirmed resolved live once the daemon picked up the new build.

## 2026-07-30 – 2026-08-02

- feat(gm): plugkit.wasm is now the SLIM variant (~3.6MB, committed same-origin at `docs/vendor/gm/plugkit.wasm`) replacing the 149MB fat wasm + Cloudflare Worker proxy (`infra/plugkit-wasm-proxy/` retired); real bge-small-en-v1.5 embeddings preserved via agentplug-bert's standalone `bert.wasm` (~136MB, gitignored, CI-vendored by new `scripts/refresh-bert.mjs`) with `host_vec_embed` bridged in `docs/lib/freddie-host-gm-bridge.js` (commit a3c8cfa). OnceLock ordering: bert load is awaited before the gm tool/`__GM_DISPATCH__` bridge is exposed, or vector search strands on bm25 for the session.
- fix(gm): wire `host_plugin_call` so `sql_*` verbs work again after the slim-wasm swap (commit e17b32f); sqlite-shim sends `path:':memory:'` on every sql dispatch, not just `sql_open` (commit ffaa793).
- fix(git-status): root-cause Buffer polyfill + fs-shim bugs that broke isomorphic-git entirely in the shell (commit 9280965); full launcher bug sweep root-caused (commit c3ae469).
- fix(lint): un-vacuum the swallow-comments lint and wire both lints (swallow-comments, i18n-ratchet) into CI; wrap un-t()'d UI strings; document bare catches; correct AGENTS.md drift (commit 7029e6a).
- chore: remove vendored `.gm/` state (org-wide gm cleanup, commit b7b23da); refresh design kit to 0.0.449 fixing doctor-flagged vendor.lock `kits/os` drift (commit c46517c).

## 2026-07

- feat(fs): OPFS is the primary filesystem backing — real per-file OPFS via a dedicated Worker backs the per-instance `snapshot` object (IndexedDB kept as one-time migration source + full fallback; `fs.usingOpfs` exposes the live backend); the dead `shell-node-opfs.js` overlay removed (commit 018450d, 2026-07-17). Follow-up: createSyncAccessHandle race fix (commit e07ec96) and serialized concurrent IDB saves closing a persist-loss race (commit bf3947c).
- fix(vendor): vendor.lock hashing normalizes CRLF->LF before hashing — a Windows checkout produced hashes that never matched Linux CI with zero real drift (commits d44d2a9, 8880d5d, 2026-07-17); vendor.lock.json manifest documented (commit 4ac7b40).
- fix(fsbrowse): dynamic-import break root-caused to a literal NUL byte in source + a broken `./i18n.js` import path (should be `./vendor/i18n.js`); live-witnessed in the real OS shell (commit 85582f8, 2026-07-24; same-class NUL in AGENTS.md fixed in 41f89c1).
- chore(validation): manual-only validation policy completed — remaining test suites removed, `witness-ci.yml`/`witness-core.yml` workflows deleted after two distinct CI failure classes were documented (alternating flaky hangs + a deterministic CI-vs-local gap); pipeline fixes (commit 5dcac4e, 2026-07-29). gm.dispatch-readiness flake in witness-freddie/witness-libsql-native recorded (commit 2a7b8ce).
- feat(vendor): `247420.css` loads live from `unpkg.com/anentrypoint-design@latest` on every served page (commit d26558f); kit consumption paths documented (99eaeb0); vendored kit refreshes 0.0.407 -> 0.0.425 incl. app-shell split sheets + barrel companion dirs (8e7720b, d353ee8, f59f972); gm-plugkit wasm to 0.1.1062 from npm (3dd62e9); orphaned transformers.js/MiniLM payload deleted (59f4398); refresh null-local-source tolerance (ade77af).
- fix(ci): warm gm/plugkit.wasm before the witness-all fan-out (fa0cb8c); revert the ineffective warm-up step, keep failing-assert detail logging (c4d17c5).
- chore(deps): serve 14.2.6; doctor.mjs Windows dynamic-import path fix (f391c9e).

## 2026-06

- feat(level-editor): the no-code authoring closure — level-editor app (09b6066), zero-code flow + honest limits documented (fd28ceb), ECS runtime + canvas game-loop primitives (2a50ea0), visual event-chain data model + playtest loop (88d027f), sprite assets/scene templates/"view as code" escape hatch (b79439d), generic game-player app + two-tab save-conflict detection + hot-reload (3786bf7).
- feat(chat): durable chunked transcript store (813ae9e), chat-turn xstate lifecycle + crash/refresh session recovery (80d46a4, 2e6c11e), resumable agent turns via IndexedDB snapshot+step store (3bee4c9), last-good response cache for offline-first display (dd76446), agent descriptors/file uploads/binary download/privileged fetch (6441869), chat client hardening + instance status lifecycle (81c56fe).
- feat(freddie-host): v2 adapter flipped to default (c174875); chat builtin delegated to buildBrowserCallLLM (13149eb); structuredClone replaces JSON round-trip clone (a31baab); freddie bundle 0.0.122 -> 0.0.175 (66779ee, 71b5c6b).
- feat(os): instance templates, workspace zip export/import, plugin system + chat event bus (4e195a3), plugin tabs threaded the real appRegistry (3ddd2a6); policy engine + policy rules UI in chat-config (05840d1, 44f5074); audit log subsystem + masked audit trail in freddie-keys (b1efcfe, a3025ce); `docs/sdk.js` public per-instance SDK facade (a305fd0); WS gateway transport + cross-tab chat sync + adaptive batching (08d93b7); rate-limit retry + shared chat event bus (59263bb); acptoapi cache hit-rate in gateway status tooltip (0dd1631).
- feat(shell-git): batched git blob fetch fallback + npm native-dep stubs + terminal audit (23862f7); `git push --atomic` single-commit whole-fs push via GitHub Data API (e4a6f6f).
- refactor(shell): lazy-load shell builtins, merge chat/i18n/uid modules, extract shared helpers (consolidation commit 854e097); shell/shell-node builtins route through injected fs instead of window.__debug (09d9932); cwd/env persisted after command execution (2f61e10); POSIX fidelity passes (c69bb01, b42dc23, 7755daf); pyodide Node-sniff fix (b31383c); process polyfill via early classic script (88e9e77); asgi-bridge explicit active-instance (5155edc).
- i18n: t()/docs/i18n.js threaded through every UI surface — os-shell/session-ui, terminal/wm, cli-app/fsbrowse, notes/snake, browser-pane, freddie-loader/freddie-host, hermes-preview/chat-config, freddie-chat/freddie-keys (c84a3a6, e0f4e78, e91c523, efdbec1, 28035c8, 2a95290, 8ab97af, 400d153).
- refactor(apps): counter demo ported off react-lite onto webjsx, react-lite.js deleted (ed721d1); deprecated files-legacy registration removed (402e839); visible errors on lazy-app import rejection (2e17f6a); orphaned docs/terminal.js dead entry point removed (444a0e4); self-cleaning thebird-gui-state migration shim removed (e9c9dba); 50 generated per-instance SW copies collapsed into 7-line importScripts stubs (39edb6a).
- fix(witness): witness-manifest tagged runner consolidating app-matrix scripts (8d8b615) + witness-audit-log/git-sync/ws-chat/chat-seed-large probes (2d7e5d3, de970f5); all probes migrated to shared witness-lib.mjs helpers (a4acd03); a dozen false-negative fixes across edge-cases/interactive/app-functions/deep-churn probes (9c09ac1, 8fe3551, 8307da5, 3186669, 705d300, 8b0ef9e, 8e490e7, dcf270b, a8e73a5, 27f4d84, 24908c9, ac05d23); CI: acptoapi started for chat scripts (2d0890d), gm engine vendored same-origin (8fe8760), missing npm install (0e1bf02); known-non-blocking upstream-gap probes excluded from the gate (2fc19f4).
- feat(perf): content-addressed Cache API layer + real download-progress tracking for the plugkit.wasm loader (00d7cdf, 48c14dd); desktop-camera reduced-motion fix (5e5e321); puppeteer 25.3.0 (56acc1a).
- a11y: WCAG contrast on --warn token, ARIA on OS shell + Alt-Tab switcher (6281342); witness-edge-cases modal selector fix (ddb72f0).
- docs: cross-repo improvement report implemented — dedup, lint gates, hotspot splits (8b8e265); decision-gate records (4fc93e6, ab2663f, 6ba4537); orphaned-window skip downgraded to console.warn (6b1650c); stale react-lite reference removed (9d17ff3).

## 2026-05-25

- chore(testing): remove `docs/validate.html` + the `validate.yml` CI workflow + `validate-runner.mjs` + `run-validate.mjs`/`witness-validate.mjs`/`witness-validate-vec.mjs` runners, and drop the `validator` app from `apps.js`. The in-browser 169-assertion harness flaked on the 61 MB plugkit.wasm cold-load in headless CI (false failures). Validation is now manual via the `scripts/witness-*.mjs` probes — documented in `docs/MANUAL-VALIDATION.md`. The SW-static-drift guard (the one useful part of validate.yml) is salvaged into a fast standalone `.github/workflows/sw-drift.yml` that runs `gen-static-sws.mjs` + `git diff --exit-code docs/sw-i*` with no browser/wasm. AGENTS.md / README / TESTING-ARCHITECTURE.md / UX-TESTING-GUIDE.md / plugin-sdk.md updated; stale `validate.html` code comments generalized.

## 2026-05-23

- fix(session-ux): redesign instance lifecycle as named workspaces (commit 1ad1370). Replaces cramped `i1`/`i2` pills with labeled chips carrying name + window-count + close-x; adds create wizard, destroy confirm, empty-state CTA, Ctrl+Shift+N/W + Ctrl+1..9 shortcuts, dedicated Workspaces app, per-instance focused-window memory, 180ms crossfade on instance switch.
- fix(session-ux): theme-aware --bg/--fg tokens replace --paper/--os-fg, fixing invisible light-on-light modals (commit b6ae061).
- fix(session-ux): rename "Session" → "Workspace" everywhere user-visible to disambiguate from chat sessions (commit a1e08d4).
- fix(apps): `el(tag, cls, text)` helper now applies text; `wm.close()` invokes `win._app.dispose` so closing the Workspaces window stops its refresh interval (commit 7583664).
- fix(vendor/freddie + freddie): chain fallback on rate_limit/timeout/empty in `resolveCallLLM` opts; `adapt()` flattens Anthropic-shape content arrays + tool_use blocks (freddie commit f2faad4; thebird vendor mirror 7cac538).
- fix(acptoapi-browser): trust acptoapi v1+ CORS + Access-Control-Allow-Private-Network headers — drop the false-positive `_isLb && !_pageLb` short-circuit. Cross-origin loopback fetch from gh-pages SUCCEEDS when bunx acptoapi is running locally (thebird commit 54130cb; freddie commit 772643b).

## 2026-05-21

- feat(libsql): drop sql.js entirely; plugkit.wasm is the only sqlite backend in-browser. `docs/libsql-sqljs.js`, `docs/vendor/sql-wasm.{js,wasm}` and `docs/vendor/esm/sql-wasm.mjs` removed (~795 KB combined). `docs/vendor/busybase/embedded.js` now self-bootstraps plugkit from the pinned CDN release `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v0.1.465/plugkit.wasm` when `window.__debug.gm.dispatch` is not already present. Importmaps in os.html / validate.html / index.html lose the `sql.js` alias; `freddie-host.js` imports the libsql-client adapter directly.

## 2026-05-19 (later)

- ops(freddie): triggered first gh-pages build via API; `https://anentrypoint.github.io/freddie/browser/freddie.js` now serves the 157KB ESM bundle (HTTP 200 witnessed via live page resource timing). Bundle exports surfaced via grep: bootHost, createAgentMachine, createActor, createMachine, fromPromise, waitFor, assign, runTurn, host, FREDDIE_DEFAULT_CONFIG, etc.
- feat(freddie-host): skills now fetch remote-first from `https://anentrypoint.github.io/freddie/skills/<path>`, falling back to the vendored `docs/vendor/freddie/skills/` copy on failure. Companion change in `c:/dev/freddie/.github/workflows/browser-bundle.yml` (commit c85a581 on master) extends the gh-pages workflow to publish `skills/` alongside `/browser/` with a generated `manifest.json`. Edits to upstream skills now propagate to thebird via gh-pages without `scripts/refresh-design.mjs`.

## 2026-05-19

- feat(os): tilde-toggle bars + bars-overlay-on-maximize. `--os-bar-h: 34px` matches the rendered titlebar; `.wm-root` spans the full viewport (inset:0); menubar/taskbar (z 9200) paint over a maximized window's `.wm-bar` (z 9000). Backquote keydown — ignored when typing — toggles `html.bars-hidden` which display:none's both bars.
- feat(os): perfect multi-instance state restore. snapshot captures `{counter, activeInstance, barsHidden, instances:[{id, windows:[{appId,x,y,w,h,min,max,z,focused}]}]}` mirrored to every per-instance SW; restore recreates ALL saved instances via new `newInstance({forceId})`, replays windows in ascending z, applies max/min via wm-btn clicks. Witnessed: 2 instances × 2 windows + max + min + bars-hidden, reloaded, reproduces exactly.
- feat(validate): `chromeAssertions()` adds 4 invariants (chrome_bar_h_matches_titlebar, chrome_menubar_height_22_to_40, chrome_wm_root_full_viewport, chrome_tilde_toggles_bars).
- feat(freddie/polymorphism): mixed loader pattern — `bootHost` stays local (thebird-specific instance-fs + sw-client integration), xstate primitives + createAgentMachine come from the published browser bundle (remote with offline fallback). `docs/freddie-runtime.js` (3,280 lines) deleted; bundle vendored at `docs/vendor/freddie/freddie.js`. process global + createRequire stub bridges installed before bundle eval.
- feat(apps): apps menu prune + System submenu. `apps.js` tags {chat, freddie, terminal, browser, files} as essentials and {config, monitor, gm, validator, about, xdisplay, canvas, todo} as `system: true`. `os-shell.js` post-processes the menubar to group system apps under a collapsible "System ▸" expander.
- chore(deps): vendored anentrypoint-design refreshed to 0.0.114; freddie polymorphic bundle published at `c:/dev/freddie/src/browser/index.js` (vite-built, gh-pages publish via `.github/workflows/browser-bundle.yml`).
- docs: new memos — `polymorphic-freddie`, `apps-system-submenu`, `tilde-bars-and-restore`, `freddie-node-shimmability` (94% of freddie src/ is browser-bundle-eligible), `gm-app-reachability`.

## 2026-05-18

- feat(sw): per-instance Service Worker isolation. 16 static `docs/sw-iN/index.js` files (committed) for the GH Pages no-custom-headers case, plus dynamic `docs/sw-instance.js?inst=iN` fallback past instance 16. `scripts/gen-static-sws.mjs` regenerates the static set from the single SW source and refuses to write stale output if the dynamic INSTANCE_ID block is missing.
- feat(ci): `.github/workflows/validate.yml` boots `docs/` under `serve`, runs `docs/validate.html` headless via Playwright, and fails on any assertion regression. New pre-check step re-runs `gen-static-sws.mjs` and diffs `docs/sw-i*` so editing `sw-instance.js` without regenerating fails CI. Runner enforces a minimum assertion count to catch a harness that died mid-run.
- fix(sqlite-shim): `docs/lib/sqlite-shim.js` parses the SELECT clause to recover column order. Plugkit's `sql_query` returns rows as objects whose keys come back alphabetical; positional access (`row[0]`) now matches SQL expectations again.
- feat(libsql): cron round-trip through the freddie-host `pi.cron` surface — schedule/list/cancel via per-instance libsql-sqljs DBs. Validate covers create → list → cancel.
- fix(freddie): libsql persistence snapshot is now de-raced via a shared `inflightPromise` in `makeLibsqlPersistence`. Auto-scheduled snapshot from `memorize()` and explicit test calls share one in-flight result instead of stomping each other.
- feat(brand): `docs/thebird-brand.css` is the project's brand sheet, loaded as an external `<link>` so the inline-style drift detector doesn't flag project brand selections. Owns `--paper #F5F0E4`, Archivo display font, 999px `.os-task` pill via `.ds-247420 .os-task` specificity.
- chore(validate): score progression 130/138 → 159/159 across the session. Pre-existing failures resolved by the SW isolation, libsql, and shim work above. 2 new `sw_static_*` invariants gate the static SW file regeneration.

## 2026-05-14

- feat(freddie-host): acptoapi-first provider fallback — chat tool tries localhost:4800 /v1/chat/completions (acptoapi), falls back to localhost:3030 (freddie), then SDK. Added checkAcptoapi() health check, acptoapiFallback() OpenAI-compat POST with fallback error handling, directProviderFallback() SDK integration. Config defaults providers.openai.baseUrl='http://localhost:4800'. All subsystems respect cfg override.
- feat(freddie-host): full vector search via transformers.js Xenova/all-MiniLM-L6-v2 (384-dim, quantized) — `embed()`, `vecSearch()` cosine similarity, IDB v2 'embeddings' objectStore replaces BM25 approximation.
- feat(freddie-host): full codeinsight via web-tree-sitter (web-tree-sitter@0.24.7 + tree-sitter-wasms@0.1.12) — `indexInstanceFs()` extracts AST chunks with `nodeType/path/lineStart/lineEnd`; `normalizeCodesearch` promotes these fields to top level on all search results.
- feat(freddie-host): LLM-backed learn flow — `dispatchMemorizeAsync` summarizes text >200 chars via claude-haiku-4-5-20251001 before storing embedding; fire-and-forget async.
- fix(freddie-host): `host_kv_put` returns 1 on success (nonzero=ok matches Rust wasm_dispatch.rs convention; was returning 0 causing all kv_put calls to fail).
- feat(rs-plugkit/wasm_dispatch): added `host_vec_embed` extern — wasm can request 384-dim float embeddings from host; `host_kv_put` nonzero=success convention documented.
- witnessed: embed() 384-dim array ✓, recall() cosine scores ✓, codesearch() nodeType/path/lineStart/lineEnd ✓, IDB embeddings namespace ✓ — all four verified via live exec:browser tasks on GitHub Pages deploy.

## 2026-05-12

- refresh: vendored anentrypoint-design 0.0.90 → 0.0.94 via `node scripts/refresh-design.mjs` (latest npm @latest). Brings updated `pages-chat.js`, `pages-config.js`, `pages-config-edit.js` + `app-shell.css` + theme tokens.
- refresh: vendored freddie skills (12 SKILL.md across creative/data/ops/planning/software-development) from `C:/dev/freddie/skills` + regenerated `docs/vendor/freddie/skills/manifest.json`.
- fix(freddie-chat): guarded side-effect `import './vendor/web-components/freddie-chat.js'` with `typeof window !== 'undefined' && typeof HTMLElement !== 'undefined'` — was breaking node-side test.js with `ReferenceError: HTMLElement is not defined` after the 0.0.94 refresh added the web-component import.
- fix(test): removed orphan `PROVIDERS.openrouter.models` assertion (chat-providers.js was deleted earlier without removing this consumer line); replaced obsolete `jobs:`/`freddie` literal checks in the instance-shell surface assertion with current `jobs`/`exec` exports.
- witnessed: thebird test.js 102/0; validate.html 129/130 (only `worker_frames_increment` flakes under headless timing); screenshots at `.gm/shots/{os-shell-default,validate-harness,freddie-dashboard-chat}.png`.

## 2026-05-06

- feat(freddie): full host config surface + freddie-dashboard OS app. docs/freddie-host.js extended with FREDDIE_DEFAULT_CONFIG, FREDDIE_ENV_KEYS (24), FREDDIE_COMMAND_REGISTRY, FREDDIE_GATEWAY_PLATFORMS, plus host.pi.{config,projects,sessions,cron,env,gateway,profiles,batch,commands,health,agents,debug} surfaces — sessions/cron persist via libsql-sqljs per-instance DBs, config/projects/profiles persist as JSON in instance.fs. cli registry grew from 6 → 11 commands (+ config, sessions, cron, batch, projects). New OS app `freddie` is the full 15-route dashboard mirroring freddie's src/web/app.js (projects/home/chat/sessions/agents/analytics/models/logs/cron/skills/config/keys/tools/batch/gateway). Inline forms write back through host.pi.{config,projects,cron,env}. Implementation lives at docs/vendor/desktop/freddie-dashboard.js (read-only vendored desktop SDK pattern); docs/freddie-dashboard.js is a thin shim injecting bootHost. Validate harness now 110/110 green with 5 new freddie invariants: freddie_dashboard_app_registered, freddie_dashboard_renders_all_routes (≥15 sidebar buttons), freddie_host_pi_config_seeds_defaults (_config_version=1), freddie_host_pi_env_lists_24_keys, freddie_host_pi_cron_roundtrip (libsql round-trip). Witnessed allGreen=true at /validate.

## 2026-05-04

- chore(busybase): consolidated to single master branch. PR #1 fast-forward-merged to master, feature branch deleted local + remote, 10 stale claude/* remote branches deleted. busybase repo now has only master (local and remote). 69/69 tests still green on master. AGENTS.md updated.
- chore(busybase): repo unarchived. Pushed branch feat/backend-selector + docs commit (README + CLAUDE.md + docs/docs.html) and opened PR #1 at https://github.com/AnEntrypoint/busybase/pull/1. The external residual on busybase-sqljs-backend is now resolved — 69/69 embedded tests still green, registry usage documented across all three doc surfaces with thebird sql.js example. AGENTS.md updated to reflect.
- feat(freddie-host): docs/freddie-host.js — bootHost({fs}) returns a freddie-shaped agent host with pi.cli, pi.skills, pi.tools registries populated, plugin contract { name, surfaces, register(ctx) } + plugsdk definePlugin/HookType. 9 built-in tools wired to per-instance fs and libsql-sqljs: read/write/edit/grep/list/memory/chat/delegate/web_search. memory tool round-trips through libsql-sqljs. chat tool calls /v1/chat/completions on configured baseUrl with per-instance API key. 5 bundled skills (creative/software-development/ops/data/planning), 5 CLI commands (run/exec/tools/skills/memory).
- feat(instance-shell): freddie builtin — 'freddie tools|cli|skills|tool <name> <jsonArgs>|run <prompt>|exec <prompt>' wires the host into any per-instance xterm. Browser witness: 9 tools listed via 'freddie tools', tool dispatch returns JSON output to terminal.
- fix(libsql-sqljs): dynamic <script> injection of vendor/sql-wasm.js with deduplication (data-libsql-sqljs guard) + post-load polling for window.initSqlJs assignment. Was previously failing in module-import contexts with stale browser caches.
- chore(prd): close freddie-vendor (real working host with 9 tools, browser-witnessed) + chat-replace-with-freddie (freddie REPL via 'freddie run' shell builtin, per-instance API config from previous turn). PRD now empty — file deleted.
- feat(launcher): docs/launcher.js — top-level OS shell. createLauncher() builds a left-edge dock; '+' creates instance with 3 windows (terminal, browser pane, canvas-driven worker). Each instance gets its own fs/shell/worker/browser. Per-instance dock button focuses; close button tears down (dispose shells, stop worker, delete fs DB, close windows). 3-instance browser witness: count=3, list shows 3 windows + browser + worker per instance, FS isolation confirmed (A's /tmp/probe ENOENT from B's shell), clean teardown to count=0.
- feat(launcher.runValidationHarness): single-export validation harness boots 3 instances, asserts 6 isolation properties, writes to __debug.multiInstanceResults. Browser witness 2026-05-04: independence_fs / idempotency_fs_path / network_isolation_keys / fault_isolation_workers (after stop B, A and C continue advancing) / job_isolation / pane_isolation_browsers — ALL GREEN, allGreen: true.
- feat(browser-pane): docs/browser-pane.js — same-origin iframe + CDP-shaped facade (Page.navigate/reload/captureScreenshot, Runtime.evaluate, DOM.querySelector/getOuterHTML, Network.getRecent/clear) + shellCmd parser. Browser witness: navigate→evaluate→title/h1, querySelector outerHTML, captureScreenshot 13.5KB base64 PNG, network log entry recorded.
- docs(AGENTS.md): added "Multi-instance OS architecture" section documenting wm/instance-fs/instance-shell/instance-worker/browser-pane/launcher/libsql-sqljs/busybase modules with API surfaces and registration points.
- chore(prd): close multi-instance-launcher, validation-harness, docs-update. 2 items remain (freddie-vendor, chat-replace-with-freddie).
- feat(browser-pane): docs/browser-pane.js — same-origin iframe wrapped by CDP-shaped JSON-RPC facade. Domains: Page.navigate/reload/captureScreenshot, Runtime.evaluate, DOM.querySelector/getOuterHTML, Network.getRecent/clear. Plus shellCmd() that turns 'browser <verb> <args>' into the right method call. Browser witness against same-origin /__cdp_target.html: navigate-then-evaluate returns 'cdp target', querySelector returns h1 outerHTML, screenshot returns 13552-byte base64 PNG, network log records the navigation. Network.* full SW-intercept integration is the integration point with existing preview-sw.js (deferred to launcher work). Closes browser-pane-cdp. 5 items remain.
- feat(instance-shell): docs/instance-shell.js — createInstanceShell({fs, container, env, cwd, title}) builds an xterm + a built-in REPL bound to the per-instance fs handle. Builtins: pwd, cd, echo, env, export, cat, ls, write, rm, jobs, help. Per-shell state (cwd, env, jobs, history). Browser witness: 2 shells in instance A share fs (a1 writes /tmp/x → a2 reads alpha-from-a1; a2 writes /tmp/y → a1 reads beta-from-a2) but have independent jobs (6 vs 3) and independent cwd (a1 cd /etc → a1 pwd /etc, a2 still /home). Cross-instance: B's /tmp/x is bravo-from-b1, fully isolated from A. __debug.instances[id].shells[] correctly per-instance (A=2, B=1). Closes per-instance-shell-terminal. 6 items remain.
- feat(instance-worker): docs/instance-worker.js — createInstanceWorker(id) builds a Web Worker (inline-blob) that owns its OffscreenCanvas, draws an animated waveform, accepts input/frame-count/stop messages. Browser witness: 3 workers each in its own WM window, all frame counts advance independently, stopping B doesn't disturb A or C (fault isolation precondition).
- feat(busybase/embedded.ts) [external repo at C:/dev/busybase, branch feat/backend-selector commit 813428d]: pluggable backend selector — registerBackend(name, factory) + createEmbedded({backend,url}). Default 'libsql' unchanged. Existing 69-test embedded suite green; registry resolution + unknown-backend error path witnessed via probe. EXTERNAL BLOCK on PR: AnEntrypoint/busybase repo is archived since 2026-04-24, cannot push remote — owner action required to unarchive.
- chore(prd): close offscreen-canvas-guest, busybase-sqljs-backend (with external residual recorded). 7 items remain.
- feat(instance-fs): docs/instance-fs.js — createFs(instanceId) factory, IDB DB 'thebird-fs-<id>'. Witnessed: 3 instances writing /tmp/x get back alpha/beta/gamma respectively (independence); A reopen reads "alpha" (idempotency); B sees its own writes, A doesn't (file isolation). Plus per-instance api-config: getApiKey/setApiKey on /etc/freddie/config.yaml — A's sk-A-secret invisible to B; survives reopen. Closes per-instance-fs and per-instance-api-config.
- chore(test.js): compact 211→186 lines by dropping inter-group blanks. Stays under 200 cap. 103 assertions still green.
- feat(wm): docs/wm.js — windowed window manager (drag, resize, z-order/focus, minimize/maximize/close, Alt-Tab cycle). 5 mixed-kind windows witnessed simultaneously in browser; move/resize/focus/cycle/close all green via __debug.wm. PRD item window-manager closed.
- feat(libsql-sqljs): browser shim implementing @libsql/client surface (createClient, execute, batch, close) over vendored sql.js — keystone enabling Freddie + busybase to run in-browser without their native libsql binaries
- chore(plan): write .gm/prd.yml with 14 remaining items for full multi-instance windowed web-OS migration (per-instance FS/shell/terminal/api-config, window manager, OffscreenCanvas-per-worker, browser pane with CDP facade, freddie vendoring, chat replacement, busybase upstream PR, 3-instance isolation validation harness, COEP/COOP research, docs)
- decide(coep): document SAB cross-origin-isolation strategy in AGENTS.md — coi-serviceworker (gzuidhof) with credentialless mode, gated per-instance behind useSAB flag. Resolves the AGENTS.md-flagged conflict between require-corp and the preview SW. PRD item web-research-coep-coop closed.
- vendor witness: libsql-sqljs INSERT/SELECT/UPDATE/DELETE/batch round-trip green; IDB persistence across close/reopen confirmed; FTS5 noted absent in current sql.js vendor build (Freddie's sessions.js already has try/catch fallback so non-blocking)

## 2026-05-01
- feat(hermes-acptoapi): runHermesLLMDemo + [demo-llm] button — Hermes-context Python in the browser actually doing tasks via Claude Code through the local acptoapi bridge. New httpx-direct shim sidesteps the openai SDK 1.37 / httpx 0.28 incompatibility ('proxies' kwarg) and SDK-level hangs in pyodide. Witnessed in the live app: 3 tasks (arithmetic, code-gen, summarization) in ~60s total. arith="391" for 17*23, code-gen returned `sum(i**2 for i in range(1,11))`, summary returned a coherent one-sentence summary of thebird.
- chore(hermes-preview): add pyodide-http and openai==1.37.0 to wheel install list and patch httpx.Async/Client.__init__ to drop deprecated 'proxies' kwarg (openai 1.37 still passes it; httpx 0.28 rejects). Live in hermes-preview.js boot path so subsequent users don't re-discover this.
- feat(hermes-acptoapi): wire local acptoapi as a user-config provider for Hermes inside pyodide. New `setupAcptoapiProvider({baseUrl, apiKey, model})` export in docs/hermes-preview.js writes /home/pyodide/.hermes/config.yaml with an `acptoapi` provider entry (`base_url: http://localhost:4800/v1`, `transport: openai_chat`), sets OPENAI_BASE_URL/OPENAI_API_KEY env vars in Hermes' Python runtime, and verifies via `hermes_cli.providers.resolve_provider_full('acptoapi', ...)` that Hermes resolves the entry as `source: user-config`. New [wire-acp] button in app-shell.mjs preview toolbar invokes the wire-up after Hermes is mounted.
- Witnessed: acptoapi running on :4800 responds to OpenAI-compat `POST /v1/chat/completions` with model=claude/haiku → Claude Code returned "pong". Pyodide `pyfetch` from inside the live-app's mounted Hermes also round-trips to acptoapi → Claude Code. After [wire-acp], `resolve_provider_full('acptoapi', user_providers=cfg.providers)` returns ProviderDef{id:'acptoapi', base_url:'http://localhost:4800/v1', transport:'openai_chat', auth_type:'api_key', source:'user-config'}.
- Named complement (not witnessed this turn): Hermes' httpx-based aux client throws `httpx.ConnectError: Failed to fetch` against acptoapi from pyodide. pyfetch works; httpx-jsfetch transport appears to mishandle the PNA preflight on `localhost:4800` from `localhost:8752`. Routing Hermes' actual agent loop end-to-end through acptoapi requires either a pyodide-httpx jsfetch tweak or a Hermes-side hook that uses pyfetch instead of httpx for this provider.
- fix(asgi-bridge): derive base href + history-scoper basePath from the SW registration's scope (window.__debug.sw.registration.scope) instead of `location.pathname`. Old logic produced `/preview/<prefix>/` from `/app.html`, which broke iframe URL math when the docs/ tree is mounted under `/app/` in the new SDK shell. Now correctly emits `/app/preview/<prefix>/` so the SPA loads and React-Router scoping matches the iframe URL. Witnessed: Hermes SPA (`<title>Hermes Agent - Dashboard</title>`, 18,160-byte body) renders inside the live-app preview tab; dispatchAsgi round-trips 3 routes (200 HTML / 401 JSON / 401 JSON — Python responding to all three). Mount total ~10s warm cache.
- feat(site): rebuild live app natively in anentrypoint-design SDK chrome. app.html no longer iframes legacy docs/index.html — site/app-shell.mjs renders Topbar/Crumb/Status with the chat/terminal/preview tabs and reuses the same web-OS modules from ./app/ (app.js, terminal.js, preview-sw-client.js). All chrome (topbar, crumb, status, tabs, github-login, preview toolbar, term-image overlay) is component-driven; legacy .land-* / overview-pane chrome is gone. Witnessed: bird-chat upgraded, shell exec ec=0 → "HELLO_NATIVE / home/ sys/", preview SW active at /app/preview/, tab switching toggles pane visibility, no console errors, no 4xx.
- fix(terminal): replace `fetch('./defaults.json')` with `fetch(new URL('./defaults.json', import.meta.url))` so the seed loads correctly when terminal.js is imported from a different document path (e.g. /app.html via app-shell.mjs).
- fix(site): drop misleading "$ bunx acptoapi" install line from landing hero — that command is for the acptoapi package, not thebird itself. Reframed quickstart row to "acptoapi (separate package)".
- feat(site): restore rich landing content under SDK chrome — hero "web os, in your browser", 8-feature grid, project receipt, architecture panel, quickstart. All sections data-driven from site/content/pages/home.yaml using anentrypoint-design components (Hero/Panel/RowLink/Receipt/Btn/AppShell/Topbar/Crumb).
- feat(site): ship live web-OS demo as ./app/ on the deployed site. theme.mjs assets copy docs/ → dist/app/, new app.html SDK page iframes ./app/index.html. Witnessed: bird-chat upgrades inside iframe, shell exec ec=0, ls / shows seeded home/ sys/, preview SW active at /app/preview/.
- fix(site): copy docs/favicon.svg → dist/favicon.svg + add link rel=icon to all SDK pages (eliminates 404).
- chore(site): navigation now points at live app + source + acptoapi + 247420.

## 2026-04-30
- fix(site): drop broken /preview embed (its bootstrap requires the full thebird shell, not part of flatspace landing); refresh README and AGENTS.md to reflect site/ landing + docs/ web-OS split and correct workflow path to gh-pages.yml
- fix(site): rewrite stale "Anthropic SDK → Gemini bridge" template content in site/content/globals/site.yaml + pages/home.yaml. Landing now reflects actual project: browser-native web OS (agentic chat, POSIX terminal, live preview, IndexedDB FS). Added feature grid + accurate quickstart. Witnessed: home + todo iframe load clean in browser, test.js 102/102.

## 2026-04-24
- feat(docs): full 247420-design landing page with hero, 8-feature grid, architecture diagram, project receipt, and embedded live app
- refactor: acptoapi extracted to separate package; thebird re-exports it via index.js


## [unreleased] 2026-04-21 theme system + richer chat output
- feat: dark/light theme via [data-theme] attribute; pre-paint boot script respects localStorage + prefers-color-scheme
- feat: theme toggle button (◐) in tabs row; window.setTheme / toggleTheme / __debug.theme
- feat: xterm terminal re-themes live on tui-theme-change event (reads CSS vars)
- feat: preview iframe + "no files yet" placeholder inherit current theme
- fix: select arrow uses CSS gradients instead of hardcoded-fill SVG — theme-reactive
- feat: tool-event now renders output + error inline (not just input)
- feat: tool-event sig includes input length + output presence — multiple state snapshots during streaming
- feat: unknown-part carries raw part.text for diagnostic visibility

## [unreleased] 2026-04-21 chat observability — rich ACP/kilo/opencode event stream
- feat: kilo-http-stream emits status, model-info, reasoning-delta, tool-event, file-event, step-start/finish, file-mirrored, unknown-part
- feat: PART_HANDLERS dispatch table replaces part-type branching (kilo + opencode unified)
- feat: agent-chat forwards full event stream via onEvent callback; window.__debug.agent.events rolling log (300 cap)
- feat: agent stats strip in chat UI — provider·model·duration·txt·rsn·tool·file·step counters, live 4Hz
- feat: inline event badges in stream ([i] status/model/unknown, [t] tool, [f] file, [s] step)
- refactor: extracted PROVIDERS + fetchModels + renderEvent + formatStats to docs/chat-providers.js (app.js 229→166)

## [unreleased] 2026-04-21 node parity pass 12 — internal listen infrastructure
- feat: busnet — in-browser TCP-like listen/connect via BroadcastChannel cross-tab fabric
- feat: net.createServer now uses busnet — apps listen on ports other in-browser apps can connect to
- feat: busHttp — HTTP request/response framing over busnet
- feat: service discovery — busnet.discover() returns [{port,service,origin}] from peer tabs
- feat: netstat builtin — lists local listeners + peer services
- feat: window.__debug.node.busnet exposes full state
- feat: same-tab listen+connect works instantly without BroadcastChannel round-trip

## [unreleased] 2026-04-21 node parity pass 11 — virtualization + polyfills wave 3
- feat: virtual /proc filesystem — /proc/self/{cmdline,environ,stat,status,maps,limits}, /proc/{cpuinfo,meminfo,uptime,loadavg,version,stat,mounts,filesystems}
- feat: virtual /etc — hosts, resolv.conf, passwd, group, os-release, hostname, machine-id, shells
- feat: isomorphic-git wrapper — git.clone/commit/push/pull/status/log/checkout against real remotes via HTTP
- feat: tar/tar.gz extract + list — hand-rolled POSIX tar reader + fflate gunzip, works with real npm tarballs
- feat: DoH DNS polyfill — dns.resolve/resolve4/resolve6/resolveMx/resolveTxt/resolveNs/lookup/reverse via Cloudflare DoH with Google fallback
- feat: native addon dispatch — .node files route to WASM/JS equivalents (bufferutil, utf-8-validate, bcrypt, argon2, farmhash; sharp/better_sqlite3 placeholders)
- feat: process.dlopen for native modules
- feat: coreutils builtins — uname/whoami/hostname/id/df/free/uptime/ps/nproc/arch/yes/seq/tac/rev/nl/fold/od/xxd/dirname/basename/pwd/groups/logname/tty/stty/locale
- feat: npm registry shim — view/search/deps/tarballUrl/fetchTarball via esm.sh + registry.npmjs.org
- feat: os.cpus() returns real navigator.hardwareConcurrency, os.networkInterfaces returns lo
- feat: process.resourceUsage real numbers from performance.memory
- feat: crypto.secureHeapUsed
- feat: os.constants.signals/errno populated

## [unreleased] 2026-04-21 node parity pass 10 — test runner + util extras + IPC
- feat: node:test real runner — test/describe/it execute, report pass/fail/skip with colors and timing
- feat: node:test mock.fn / mock.method with calls recording
- feat: node:test/reporters TAP reporter (ok/not ok/plan)
- feat: util.styleText (named styles: red/green/bold/italic/etc)
- feat: util.stripVTControlCharacters removes ANSI escapes
- feat: util.getCallSites frame extractor
- feat: util.MIMEType + util.MIMEParams (RFC-compliant parse/serialize)
- feat: console.table/group/groupEnd/time/timeEnd/timeLog/count/countReset/dir/trace/assert/clear — full console surface
- feat: readline.createInterface — real interactive question/answer via xterm, asyncIterator, cursorTo/clearLine
- feat: fork IPC via BroadcastChannel — process.send/process.on('message')
- feat: node:sqlite module alias (DatabaseSync) — Node 22+ API

## [unreleased] 2026-04-21 node parity pass 9 — pnpm/yarn wired, workspaces, dlx
- feat: shell dispatches pnpm/yarn/bun/deno/corepack/dlx commands (previously shell-pm.js existed but wasn't wired)
- feat: workspaces resolution — package.json 'workspaces' field + pnpm-workspace.yaml packages:- syntax
- feat: Yarn Classic v1 lockfile writer + parser (real format, not JSON placeholder)
- feat: pnpm dlx / yarn dlx / bun x / npx — unified dlx runner via esm.sh
- feat: runtime observability — window.__debug.node.runtime.history tracks node→deno→bun switches
- feat: window.__debug.node.pm — pm command history (200 entries, cwd, ts, args)
- feat: Deno.stdin/stdout/stderr with ReadableStream/WritableStream surfaces
- feat: Bun.stdin/stdout/stderr .stream()/.text()/.writer() API
- feat: tab completion includes pnpm/yarn/bun/deno/npx/corepack
- feat: pnpm layout scaffold (.pnpm/<name>@<ver>/node_modules/<name> + symlinks) via shell-pm-layout.js

## [unreleased] 2026-04-20 node parity pass 8 — Deno/Bun/pnpm/yarn + POSIX
- feat: runtime detection (Deno, Bun, Node, browser) with capability flags
- feat: Deno global namespace — readTextFile/writeTextFile/mkdir/remove/stat/serve/Command/permissions/env
- feat: Bun global namespace — file/write/serve/spawn/shell(\`\`)/hash/password/TOML/nanoseconds/deepEquals
- feat: package manager dispatcher — auto-detects bun.lock/pnpm-lock.yaml/yarn.lock/package-lock.json + packageManager field
- feat: pm install/add/remove/run/ls/init/task unified across npm/pnpm/yarn/bun
- feat: deno task, deno.json/jsonc parsing, bunfig.toml parser, workspaces enumeration hooks
- feat: jsr: and npm: specifier rewriting to esm.sh
- feat: TypeScript direct execution — .ts/.tsx strip via regex (sucrase lazy-loaded)
- feat: shebang dispatch — #!/usr/bin/env deno|bun|node sets matching globals
- feat: corepack stub (no-op)
- feat: POSIX symlinks via sentinel entries — symlinkSync/readlinkSync/lstatSync/realpathSync with ELOOP at 40 hops
- feat: hard links + inode refcounting — linkSync, stat.nlink, stat.ino
- feat: file mode bits — chmodSync, S_IFREG/S_IFDIR/S_IFLNK/S_IFIFO constants
- feat: file descriptors — openSync/closeSync/readSync/writeSync/fstatSync/ftruncate
- feat: process.umask/cwd/chdir
- feat: mkdtempSync, cpSync(recursive), fs.mkfifoSync stub
- feat: Stats with isFile/isDirectory/isSymbolicLink/isFIFO, atime/mtime/ctime/birthtime Dates

## [unreleased] 2026-04-20 node parity pass 7 — Firefox maximization + polyfills
- feat: browser detection (vendor, version, 10+ capabilities) + window.__debug.node.polyfills registry
- feat: OPFS-backed fs.promises when available — real persistence (readFile/writeFile/mkdir/rm/stat/list) via SyncAccessHandle in worker, IDB fallback
- feat: brotli polyfill via brotli-wasm (compressSync/decompressSync + Transform streams)
- feat: Error.prepareStackTrace source-map integration via source-map-js — original filenames/lines when process.sourceMapsEnabled
- feat: net.Socket/tls.connect real polyfill via WebSocket-backed TCP tunnel (window.__plugkit_tcp_relay)
- feat: dgram.Socket polyfill via WebSocket-wrapped datagrams (window.__plugkit_udp_relay)
- feat: inspector.open() real CDP endpoint via postMessage channel (Runtime.evaluate/Debugger.enable/Profiler.*)
- feat: v8 CPU profiler backed by PerformanceObserver (CPUProfile.startProfiling/stopProfiling)
- feat: v8.writeHeapSnapshot — minimal valid V8 heap snapshot JSON format, Chrome DevTools importable
- feat: X509Certificate sync access via crypto.preloadX509()
- feat: vm cross-realm structuredClone boundary — Array/Object instanceof works across iframe
- feat: cluster module real impl via BroadcastChannel (fork/isMaster/worker.send/'message')
- feat: CompressionStream native gzip/deflate preferred over fflate when available
- feat: WebCodecs exposed as 'codecs' module (VideoEncoder/AudioEncoder/etc)
- feat: web-push module (pushManager.subscribe/getSubscription)
- feat: process.storage.estimate/persist/persisted + process.storageBuckets
- feat: FileSystemObserver integration for real fs.watch events on OPFS
- feat: Firefox Worker module-type compat shim
- feat: observability panel window.__debug.node.polyfills shows backing (native|wasm|fallback) per feature

## [unreleased] 2026-04-20 node parity pass 6 — 23 PRD items shipped
- feat: crypto ECDSA PEM sign/verify (P-256/P-384/P-521)
- feat: crypto.hkdf/hkdfAsync via webcrypto deriveBits
- feat: crypto.createECDH (prime256v1/secp384r1/secp521r1) shared-secret derivation
- feat: KeyObject (createPrivateKey/createPublicKey) + X509Certificate via @peculiar/x509
- feat: streaming zlib (createGzip/Gunzip/Deflate/Inflate) via fflate class API
- feat: vm module (runInThisContext/runInNewContext/runInContext via iframe)
- feat: module.register() ESM loader hooks (resolve/load pipeline)
- feat: http2.connect fetch-backed ClientHttp2Session
- feat: WASI real impl via @bjorn3/browser_wasi_shim
- feat: diagnostics_channel real pub/sub + tracingChannel
- feat: trace_events real recorder with event buffer
- feat: worker_threads.Worker backed by real Web Worker + Blob URL
- feat: child_process exec/spawn via WebContainer when available
- feat: fs.watch real events via IDB snapshot diff polling
- feat: REPL command handling (.clear/.exit/.help/.load/.save/.editor) + multi-line balance detection
- feat: Buffer pool (Buffer.poolSize=8192) for small allocUnsafe
- feat: process.binding('util') selective exposure, execArgv, features
- feat: process.memoryUsage from performance.memory
- feat: http.Agent / https.Agent real fetch pool with maxSockets
- feat: Error.prepareStackTrace V8-hook via Object.defineProperty on Error.prototype.stack
- feat: window.__debug.node registry for runtime observability
- feat: net/tls stubs with clearer error messages

## [unreleased] 2026-04-20 node parity pass 5
- feat: zlib sync (fflate via esm.sh /es2022 bundle) — gzipSync/gunzipSync/deflateSync/inflateSync
- feat: crypto.sign/verify + createSign/createVerify with PEM key import (RSA-SHA256 via webcrypto pkcs8/spki)
- feat: module resolution — full conditional exports (node/import/require/default/browser), subpath patterns (*), #internal imports map, type:module ESM detection
- feat: util.inspect — BigInt 'n' suffix, Symbol keys, colors:true ANSI, showHidden for non-enumerable
- feat: Error.captureStackTrace polyfill, process.execArgv from NODE_OPTIONS, --enable-source-maps flag, expanded allowedNodeEnvironmentFlags, process.features

## [unreleased] 2026-04-20 node parity pass 3
- feat: crypto sha1/sha512/md5 pure-JS + hmac (RFC 2104) + pbkdf2Sync + randomBytes via Web Crypto — all byte-for-byte match with real node
- feat: util.inspect circular refs use node format '<ref *N> { ... [Circular *N] }' exactly
- feat: package.json exports field resolution + node_modules walk-up parent dirs
- feat: require('module') with builtinModules, createRequire, _resolveFilename, Module, wrap, wrapper
- feat: require throws Error with .code='MODULE_NOT_FOUND' and requireStack
- feat: fs.promises mirrors sync API; fs.watch FSWatcher stub
- feat: net/dgram throw descriptive errors on use (not silent stubs)
- feat: worker_threads throws descriptive; execSync throws with explanation
- feat: process.stdin.setRawMode no-op (inquirer compatibility)
- feat: globalThis.process/Buffer set during eval (real node globals)
- feat: __filename/__dirname injected into ESM preamble
- feat: REPL eval loop — input → try-expr-then-stmt → util.inspect result; .exit/.help/.clear commands; prompt '> ' during REPL
- new: shell-node-crypto.js (sha1/256/512/md5/hmac/pbkdf2), shell-node-resolve.js (exports/walk-up/module/fs.promises/net/dgram/worker_threads stubs)

## [unreleased] 2026-04-20 node parity pass 2
- feat: util.inspect matches node format (braces-with-spaces, Map(N){k=>v}, arrays, circular, <Buffer ...>)
- feat: console.log/info/warn/error use util.format (printf-style %s/%d/%o)
- feat: crypto.createHash pure-JS sha256 — matches node hex output byte-for-byte
- feat: Buffer.write/compare/equals/indexOf/includes/subarray/readUIntXX/Buffer.compare/allocUnsafe
- feat: fs.rmSync/rmdirSync/accessSync/realpathSync
- feat: child_process.spawn/exec route through shell runPipeline, EventEmitter-style stdout/stderr/exit
- feat: http.request/http.get via fetch, return IncomingMessage-style with statusCode/headers/on(data,end)
- feat: process.execPath/argv0/title/memoryUsage/uptime/getuid/umask/release; env defaults PATH/HOME/USER/SHELL/TERM/LANG
- feat: ESM detection — code with import/export wrapped in Blob URL + dynamic import
- feat: unhandledrejection → lastExitCode=1 + node-style stack
- feat: stack trace trailer "Node.js v23.10.0" on error
- feat: .env loading at script start
- feat: node: prefixed specifiers (node:fs, node:path, etc.)
- feat: zlib.gzip/gunzip via pako (async, auto-loaded from esm.sh)
- new: shell-node-stdlib.js (util/crypto/zlib), shell-node-io.js (cp/http/proc env/ESM/stack/dotenv)

## [unreleased] 2026-04-20 node/npm CLI parity
- feat: node reports v23.10.0 + full process.versions map (27 fields, matches real CLI)
- feat: npm reports 10.9.2, npm_lifecycle_event/npm_package_name/npm_package_version env injection, pre/post<script> lifecycle hooks
- feat: process.exit(n) throws NodeExit, propagates to ctx.lastExitCode
- feat: script errors set lastExitCode=1 with stack trace display
- feat: node reads stdin via pipe (echo x | node script.js) through proc.stdin._feed
- feat: require.resolve + require.cache for module introspection
- feat: npx builtin (npx cowsay hi)
- feat: node -h/--help, node -p fixed (stdout.write not console.log)
- refactor: extracted runNode + runNpmResult into shell-exec.js (shell.js stays <200L)

## [unreleased] 2026-04-18 browser validation
- fix: require('express') returned instance not factory (MODULES wrapper called createExpress twice)
- fix: SW registration non-blocking — shell boots immediately, SW registers in background
- fix: splitTopLevel sep semantics — sep is preceding operator not following, fixes && || chain evaluation
- fix: lastExitCode-based lastOk — false builtin sets exit code 1 without throwing

## [unreleased] 2026-04-18
- feat: full CLI overhaul — shell-parser.js (tokenize/expand/parsePipes/splitTopLevel/parseRedirects), shell-builtins.js (POSIX builtins: ls -la, rm -r, cp -r, grep -inH, cd -, history), shell-npm.js (install/uninstall/ls/run/init with package.json read/write), shell.js refactored to use modules; IDB_KEY bumped to thebird_fs_v4; defaults.json updated with all new files
## [Unreleased]

### Added
- `docs/defaults.json`: bundled real project files (package.json, index.js, server.js, lib/*, lib/providers/*) so browser jsh has a working thebird source tree on boot — user can immediately run `npm install && node server.js` without needing to write files first
- `docs/shell.js`: `npm install` with no args reads cwd `package.json` dependencies + peerDependencies, installs all of them (multi-pkg via single command)
- `docs/shell-node.js`: `preloadAsyncPkgs` now walks the full require graph from entry file (BFS through relative requires) so transitive external package deps get loaded before sync require runs. Previously only scanned top-level code — server.js → ./index.js → @google/genai chain failed
- `docs/index.html`: callExpressRoute response object supports both Node http-style (writeHead/write/end/setHeader) and express-style (send/json/status). Request object now has `url`, `method`, async iterator for empty body — matches what `http.createServer` handlers expect

### Changed
- `docs/terminal.js`: IDB_KEY bumped `thebird_fs_v2` → `thebird_fs_v3` to force refresh of browser fs cache (users with stale idb will re-fetch defaults.json with the real project files)

### Added (prev)
- `docs/shell-node.js`: `http` and `https` core builtins — `http.createServer(handler)` registers wildcard route in `window.__debug.shell.httpHandlers[port]` (same mechanism as express.listen), so `node server.js` now works for servers that use raw `require('http')`
- `docs/shell-node.js`: `buffer`, `child_process`, `net`, `zlib`, `assert` builtin stubs so common Node scripts don't die on trivial requires
- `docs/shell-node.js`: `preloadAsyncPkgs(code)` scans source for `require('pkg')` calls, resolves each via dynamic `import(esm.sh/pkg)`, populates `pkgCache`. Synchronous `require()` then reads from cache — bridges Node CJS semantics to browser ESM loading
- `docs/shell-node-modules.js`: new file holding `createExpress`, `createHttp`, `createSqlite`, `createConsole`, `createProcess` factories (split out to keep shell-node.js under 200 lines)

### Changed
- `docs/shell.js`: `npm install` supports multiple packages per invocation; writes an `await import(...)` stub to `node_modules/<pkg>/index.js` as a marker, real resolution happens via `preloadAsyncPkgs` in nodeEval
- `docs/shell-node.js`: external (non-relative, non-builtin) require throws clear `Cannot find module: X (run: npm install X)` instead of generic error
- `docs/shell-node-modules.js` createExpress: routes now store `{ path, fn }` where `fn` runs full middleware chain via `runFns`, matching `index.html` callExpressRoute's `match.fn(req, res)` expectation (was previously `{ path, fns }` which broke route invocation)

### Fixed
- `docs/shell.js`: httpHandlers now returned on shell object instead of assigned to window.__debug.shell separately — terminal.js overwrote the debug object (which had httpHandlers) with the createShell() return value (which had none), making express routes invisible to index.html callExpressRoute(). Fix: remove internal window.__debug.shell assignment, include httpHandlers and all debug getters on the returned shell object so terminal.js assignment preserves the reference
- `test.js`: consolidate e2e-test.js coverage into test.js (express routing e2e + httpHandlers fix regression); delete e2e-test.js to enforce single-test-file policy

### Fixed
- `docs/app.js`: Normalize message content format to Anthropic array structure `[{ type: 'text', text: '...' }]` to prevent double-conversion in streamGemini/streamOpenAI (was sending string content)
- `docs/agent-chat.js`: Add lastError tracking in window.__debug.agent for error visibility and debugging
- `docs/shell.js`: Expose onPreviewWrite callback on returned shell object for preview refresh integration
- `docs/terminal.js`: Add shell reference to window.__debug for tool access; reduce preview refresh debounce 5s → 1s for quicker feedback
- `docs/preview-sw.js`: Add missing service worker for preview iframe routing (handle EXPRESS_REQUEST messages from main thread)
- `test.js`: Create integration test suite validating bootstrap, defaults.json, tools, errors, observability structures

### Changed
- `docs/defaults.json`: Split and optimized for Git constraints — reduced from 154.83 MB to 1.23 MB by including only 16 critical bootstrap files (app.js, agent-chat.js, terminal.js, shell.js, vendor/xterm-bundle.js, vendor/xstate.js, vendor/ui-libs.js, vendor/thebird-browser.js, etc.). Excludes large unused vendors (winterjs.wasm 46 MB, wasmer_js_bg.wasm 6.3 MB, rippleui.css 4.5 MB, sql-wasm.wasm 0.6 MB, acp-sdk.js 0.6 MB) not required for WebContainer bootstrap path.
- `docs/terminal.js`: Updated xterm.js theme with green foreground (#33ff33) to match Claude Code TUI aesthetic. Maintains AAA contrast ratio (14.61:1 on black background).

### Added
- `docs/node-builtins.js`: Full Node.js module polyfills — path, fs (IDB-backed), events (EventEmitter), url, querystring, Buffer class with encoding support
- `docs/shell-node.js`: Enhanced Node env — relative require, JSON require, per-file __dirname, process.stdout/stderr/nextTick/argv/hrtime, console.dir/table/time/assert/count, express with route params/middleware/static/json, os/util/crypto/stream modules
- `docs/shell.js`: Added node -e/-v flags, touch/head/tail/wc/grep/which commands, npm i alias

### Changed
- `docs/shell-node.js`: Rewritten to import from node-builtins.js; require() resolves relative paths, .json, directory/index.js
- `docs/shell.js`: Trimmed from 206L to 189L; ls shows directory entries properly

### Added
- `lib/errors.js`: Typed error hierarchy — BridgeError, AuthError, RateLimitError, TimeoutError, ContextWindowError, ContentPolicyError, ProviderError with classifyError factory. GeminiError kept as alias.
- `lib/errors.js`: `redactKeys()` — auto-redacts API keys (AIza, sk-, key- patterns) in error messages to `...XXXX`
- `lib/errors.js`: `parseRetryAfterHeader()` — parses standard HTTP Retry-After header (seconds and date formats) in addition to Gemini-specific retry info
- `lib/stream-guard.js`: `guardStream()` — wraps async iterables with per-chunk timeout (30s default) and repeated-chunk detection (100 threshold)
- `lib/circuit-breaker.js`: `createCircuitBreaker()` — per-provider failure tracking with auto-recovery after cooldown
- `lib/capabilities.js`: `getCapabilities()` / `stripUnsupported()` — provider capability metadata with automatic feature stripping and warnings
- `lib/router-stream.js`: Router logic extracted from index.js — circuit breaker and capability checks integrated
- `docs/tui.css`: TUI (text user interface) theme — monospace, green-on-black, box-drawing borders, scanline overlay, ASCII spinner

### Changed
- `docs/index.html`: Restyled to TUI aesthetic — ASCII art header, bracket-style tabs, removed Tailwind/RippleUI dependencies
- `docs/app.js`: Chat UI uses TUI-styled classes — monospace messages with `> ` / `< ` prefixes, bracket buttons

### Changed
- `index.js`: Trimmed from 177 to 104 lines by extracting router logic to lib/router-stream.js
- `index.d.ts`: Added types for BridgeError hierarchy, StreamGuardOptions, CapabilitySet, CircuitBreakerOptions
- `lib/providers/openai.js`: Passes response headers to error objects for Retry-After parsing; integrates guardStream

### Added
- `docs/app.js`: Cerebras as OpenAI-compatible provider option (https://api.cerebras.ai/v1)
- `docs/shell.js`: `createShell({ term, onPreviewWrite })` — POSIX shell + Node REPL using browser V8 eval + xstate v5 state machine. Dispatch table of built-ins: ls, cat, echo, pwd, cd, mkdir, rm, cp, mv, env, export, clear, help, node, npm install, exit. Pipe support via ` | ` split. `window.__debug.shell` exposes state, cwd, env, history, httpHandlers, nodeMode. `http.createServer` polyfill registers handlers in httpHandlers map.
- `docs/shell-node.js`: `createNodeEnv({ ctx, term })` — persistent V8 eval scope with process, console, require (IDB node_modules), Buffer shim, http.createServer polyfill, fetch, timers.
- `docs/vendor/xstate.js`: replaced broken stub with self-contained 46KB jsdelivr bundle (xstate@5.30.0) exporting createMachine, createActor — no external imports.
- `docs/terminal.js`: rewritten — removes all Wasmer/WinterJS; boots xterm, loads IDB, registers preview SW, creates shell via shell.js with 5s debounced hot-reload on idbWrite. window.__debug.term and window.__debug.shell live.

### Fixed
- Gemini tool result wrapping: string results wrapped as `{ output: result }` to satisfy Gemini Struct requirement for `function_response.response`
- Browser bundle rebuilt with fix

## [Unreleased - agent-tools]

### Added
- `docs/agent-chat.js`: 3 new tools — `list_files` (IDB snapshot keys), `read_terminal` (xterm buffer snapshot, last N lines), `send_to_terminal` (write to jsh stdin via shellWriter); `read_file` falls back to IDB snapshot when container not ready; `write_file` writes to both container and IDB snapshot; `window.__debug.agent.lastTool` tracks last dispatched tool
- `docs/terminal.js`: exposes `window.__debug.shellWriter` (jsh stdin writer), `window.__debug.idbSnapshot` (live file map), `window.__debug.idbPersist` (persist snapshot to IndexedDB)

## [Unreleased - browser-sdk]

### Added
- `docs/vendor/thebird-browser.js`: thebird `streamGemini`/`generateGemini` bundled for browser via esbuild (712KB, includes @google/genai browser build)
- `docs/agent-chat.js`: rewritten to use thebird `streamGemini` directly; TOOLS map with `read_file`, `write_file`, `run_command` dispatch to `window.__debug.container` (WebContainer); `window.__debug.agent` live state; removes raw Gemini REST API dependency
- `docs/app.js`: removed `convertMessages` (now handled internally by thebird); passes raw Anthropic-format messages to `agentGenerate`

# Changelog

## [Unreleased]

### Added
- `docs/agent-chat.js`: Gemini function-calling agentic loop; tools `read_file`, `write_file`, `run_command` dispatch to `window.__debug.container` (WebContainer FS + spawn)
- `docs/app.js`: imports `agentGenerate` from `agent-chat.js`; chat `send()` now runs agentic tool loop; `window.__debug` constructor uses `Object.assign` merge to not overwrite terminal.js keys; `streamGenerate` removed; `convertMessages` simplified

### Added (prev)
- `docs/index.html`: GEMINI_API_KEY input + Run Agent button in Terminal tab toolbar for in-browser agent validation
- `docs/terminal.js`: `window.__debug.runAgent(key, task)` spawns `node agent.js` with env, pipes output to terminal, tracks `{ running, output, exitCode }` in `window.__debug.validation`

### Fixed
- `docs/terminal.js`: build nested WebContainer mount tree from flat path keys (fixes `EIO: invalid file name` for files in subdirectories like `lib/providers/openai.js`); bump IDB_KEY to `thebird_fs_v2` to force re-fetch of defaults.json for users with stale cache

### Added
- `docs/defaults.json`: JSON blob of all thebird lib files + `server.js` + `agent.js` fetched by terminal.js on first boot
- `docs/terminal.js`: fetches `defaults.json` instead of hardcoded DEFAULT_FILES; jsh PTY shell with resize; `server-ready` wires iframe src + `window.__debug.previewUrl`; all debug keys registered
- `docs/index.html`: COEP fix via `window.coi = { coepDegrade: () => false }` (prevents Tailwind CDN block); Preview iframe `allow` attribute removed (invalid Feature Policy); `window.__debug` observability for container, term, shell, srv, previewUrl
- `agent.js` (in container): agentic loop using `@anthropic-ai/sdk` pointing at `http://localhost:3000` (thebird proxy), tools: `read_file`, `write_file`, `run_command`

### Added (prev)
- `wasi/cli.ts`: Deno CLI — Anthropic-format prompt → Gemini streaming via REST, flags: `--model`, `--system`
- `deno.json`: tasks `cli` (run) and `cli:compile` (single binary)

## [Unreleased - 2]

### Added
- `server.js`: HTTP proxy on port 3456, serves Anthropic Messages API wire format (streaming SSE + non-streaming JSON), backed by thebird → Gemini. Observability at `GET /debug/server`.
- `examples/sdk-validate.js`: Anthropic SDK (`@anthropic-ai/sdk`) client pointing at local proxy, validates both streaming and non-streaming paths.
- `@anthropic-ai/sdk` added to dependencies.

## [Unreleased - 3]

### Added
- `docs/terminal.js`: WebContainer-powered in-browser terminal with xterm.js, IndexedDB FS persistence, npm install on boot, @anthropic-ai/sdk pre-installed. `window.__debug.container` and `window.__debug.term` live.
- `docs/index.html`: tabs (Chat / Terminal), coi-serviceworker shim for SharedArrayBuffer on GitHub Pages, xterm CSS.

## [Unreleased - 4]

### Added
- `docs/index.html`: Preview tab with iframe (`#preview-frame`), `switchTab` extended to dispatch over `['chat','term','preview']`.
- `docs/terminal.js`: DEFAULT_FILES now includes `server.js` (HTTP server on port 3000, JSON status endpoint) and updated `index.js` (loads @anthropic-ai/sdk, hits server). Server auto-starts after `npm install`. `container.on('server-ready')` wires iframe src + `window.__debug.previewUrl`. Shell upgraded from `sh` loop to `jsh` with PTY resize. `window.__debug.srv` and `window.__debug.shell` live.


## shell predictability fixes (2026-04-18)
- Pipe stdin passthrough: grep/sed detect piped content as first arg (stdinFirst pattern)
- Tokenizer: preserves \\n inside double-quotes so echo -e works correctly
- $? expansion, $() command substitution, inline var assignment (X=val cmd)
- echo -e with \\n \\t escape sequences
- New builtins: sed, sort, uniq, tr
- shell-builtins.js split into shell-builtins-text.js (both under 200L)