# Architecture map

One page, high level. Load-bearing detail lives in rs-learn memos (see AGENTS.md) — this file is only the map.

## What thebird owns

A browser-native web OS: window manager, IndexedDB filesystem, POSIX-ish terminal/shell, an agentic
chat surface, per-app "apps" (files, notes, level editor, snake, etc.), and per-instance Service
Worker isolation so multiple OS instances can run side by side in one browser profile. Everything
ships as static files under `docs/` — no build step, no bundler, no server-side code of its own.

thebird owns **functional/behavioral code only**. It ships **zero design CSS** — every visual rule
(theme, window chrome, per-component styling) is authored upstream and consumed as a vendored kit.

## How it fits with design and freddie

```
anentrypoint-design  --(unpkg @latest for 247420.css)-->  thebird (served pages)
                     --(npm @latest tarball, vendored)-->  thebird (docs/vendor/)
        ^                                                     |
        |                                                     v
   visual/GUI code                                    freddie (LLM-facing API,
   (theme.css, shell.js,                                consumed via acptoapi,
    AppShell, dashboard)                                 vendored into docs/vendor/)
```

- **design** (`anentrypoint-design`) owns ALL visual code for the OS shell and shared components
  (window chrome, dashboard, chat widget). thebird never writes CSS by hand for these surfaces.
  The top-level `247420.css` bundle loads live from `unpkg.com/anentrypoint-design@latest` in
  every served page (`docs/index.html`, `docs/os.html`, `site/theme.mjs`'s `app.html` template,
  and the docs demo pages) — no local vendoring, always latest, no re-vendoring step. The
  finer-grained `kits/os/*.css` pieces (colors_and_type, app-shell, theme, freddie-dashboard,
  app-panes) and `xterm.css` still refresh into `docs/vendor/` via `scripts/refresh-design.mjs`.
- **freddie** owns the LLM-facing agent runtime (tools, sessions, providers). thebird never talks
  to an LLM provider or to freddie's Node process directly. The only path in is `acptoapi`
  (freddie's HTTP surface, an OpenAI-compatible `/v1/chat/completions`), which thebird calls either
  as an external daemon (`bunx acptoapi`, port 4800) or via an in-page internal chain — see
  `docs/acptoapi-integration.md`. Freddie's browser-side learning bridge (`gm-learn.js`) is exposed
  through `globalThis.__GM_DISPATCH__`, set up by `docs/freddie-host.js`.
- gm (plugkit-served instruction stream) and the rs-* tooling family are consumed transitively
  through freddie/acptoapi and through `.gm/workflows/*` fan-out audits used during development —
  they are not part of the shipped runtime.

thebird is the only one of the three that is a static, install-free artifact: it has no server
process, no daemon, no database beyond the browser's own IndexedDB.

## Boot / build sequence

**Dev:**
1. `bunx acptoapi@latest` — binds `:4800`, autolaunches ACP daemons (freddie's runtime), exposes
   `/v1/chat/completions` + a response cache.
2. `bunx serve docs` — serves the static `docs/` tree, no build.
3. Open in browser → `docs/os.html` boots the window manager (`docs/wm.js`), restores any
   persisted xstate actor snapshots per stateful surface (wm/shell/camera/chat/…), registers a
   per-instance Service Worker (`docs/sw-i<N>/`), and mounts apps from `docs/apps.js`'s registry.
   Chat defaults route to `auto` over `localhost:4800`.

**CI / deploy** (`.github/workflows/gh-pages.yml`):
1. Checkout, stamp the commit SHA into every Service Worker file (forces cache-bust on deploy).
2. Vendor `plugkit.wasm` same-origin at build time (always-latest gm, no manual bump commits).
3. `flatspace build` folds `docs/` into the published site alongside the landing page (`site/`).
4. Deploy to GitHub Pages.

**Validation** is exclusively exhaustive manual troubleshooting/debugging — no automated test
suites, no test-running CI (`validate.html`, `witness-ci.yml`, and `witness-core.yml` were all
removed; see AGENTS.md "Validation policy"): `scripts/witness-*.mjs` puppeteer probes are run
manually against a live `bunx serve docs`; `scripts/doctor.mjs` runs a fast static
consistency check (vendor stamps present, SW instance stubs match the instance cap) with no live
server needed. `scripts/syntax-check.yml` runs `node --check` over every `docs/*.js`/`scripts/*.mjs`
file as the cheapest regression gate.
