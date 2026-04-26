# thebird Development Notes

## Python Runtime — Lazy Pyodide

Default Python runtime is **Pyodide**, lazy-loaded on first use. No
fetch fires on page load; the ~10 MB Pyodide bundle downloads exactly
once when the user first runs `python`, `python -c '…'`, `pip install`,
or any tool that calls into `docs/shell-python-pyodide.js`.

- Module: `docs/shell-python-pyodide.js`
  - `loadPyodide(onStdout)` — caches and returns one interpreter promise
  - `runPython(code, argv, onStdout)`
  - `micropipInstall(pkgs, onStdout)` — pip via Pyodide's micropip
  - `bridgeFs(inst, snap, persist)` — exposes the IDB virtual FS as `open()` inside Python
  - `isLoaded()` — synchronous check; false until first `loadPyodide` resolves
- After load, `window.__debug.py = { loaded, pyodide, runPython }`
- MicroPython kept as opt-in fallback: set `THEBIRD_PYTHON=micro` in
  the shell env (`export THEBIRD_PYTHON=micro`) and the existing
  micropython binding (`@micropython/micropython-webassembly-pyscript`)
  serves `python`/`pip` instead.
- `pip install <pkg>` uses Pyodide micropip by default; with the env
  flag it falls back to micropython-lib (mip).

`test.js` asserts the module imports without triggering any fetch and
exposes the loader API.

### Why Pyodide

Real CPython 3.x semantics in WASM. Has wheels for `pydantic`, `httpx`,
`cryptography`, `pyyaml`, `jinja2`, `requests`, `pyjwt`, `tenacity`,
`prompt_toolkit`, `rich` — the bulk of what a CPython app like
**hermes-agent** depends on. MicroPython does not run CPython-only
code (Pydantic v2 core, asyncio in CPython sense, native extensions),
so it remains the lightweight default for trivial scripts only when
the user explicitly opts in.

### ASGI Bridge for In-Browser Python Web Apps

`docs/asgi-bridge.js` lets any ASGI app (FastAPI, Starlette, Hermes
web backend, Django channels) answer requests from the preview pane.
Pyodide loads on first python use; the app loads on first prefix hit.

API:

```js
import { mountAsgi, dispatchAsgi, unmountAsgi } from './asgi-bridge.js';

// inside Pyodide (after loadPyodide), build app then bridge it:
//   await pyodide.runPythonAsync('from hermes_cli.web_server import app');
//   const app = pyodide.globals.get('app');
//   const asgiCallable = (scope, receive, send) => app(scope, receive, send);
mountAsgi(asgiCallable, '/hermes');
```

Internals (test.js asserts the round-trip):

- `mountAsgi(app, prefix)` registers an app at a path prefix. Multiple
  apps coexist on different prefixes.
- `findAsgiApp(path)` returns the longest-prefix match, or `null`.
- `dispatchAsgi(method, path, headers, body)` builds a valid ASGI
  HTTP scope (lifespan startup runs once on first call), drives
  `app(scope, receive, send)`, and returns
  `{ status, headers, body }`. Body is decoded as text for
  `text/*`, `*/json`, `*/xml`, `*/javascript`; otherwise raw
  `Uint8Array`.
- `preview-sw-client.js` checks ASGI prefixes before falling through
  to the existing express-style `httpHandlers` registry, so an
  iframe `fetch('/preview/hermes/api/...')` answers from Pyodide.

To run unmodified Hermes:

1. In thebird's terminal: `python` (lazy-loads Pyodide once).
2. `pip install hermes-agent` (or import the local sdist via
   micropip from a packaged URL — Hermes does not publish a Pyodide
   wheel, so non-pure deps may fail. Each failure is a wheel-availability
   issue tracked as a separate item, not a bridge issue).
3. Inside Pyodide: import `hermes_cli.web_server`, mount its ASGI
   app via the bridge, then point preview at `/preview/hermes/`.

Live browser-side validation requires `bunx serve docs` + a real
browser; test.js validates bridge surface and JS-side round-trip
with a stub ASGI app written in JS.

## Browser Smoke Harness

In-page validation runner — proves thebird works in any real browser
without needing a browser-automation tool.

**Usage:**

- Add `?smoke=1` to the URL → runs ~25 in-page assertions, displays
  a live pass/fail panel in the top-right.
- Add `?smoke=1&net=1` → also runs live network probes for every
  configured provider (with key in localStorage), local dev servers
  (acptoapi, hermes, kilo, opencode), CDN/vendor Pyodide reachability,
  and a real Pyodide cold-load + `1+1` round-trip.
- Click `[smoke]` button in the preview toolbar → opens
  `?smoke=1&net=1` in a new tab.

What's covered (`docs/smoke.js`):

- `window.__debug` shape, shell boot, terminal element rendered, IDB snapshot present
- `ctx.cwd` defaults to `/home`, `cd ~` resolves, `cd /nope` rejects
- `ls`, `echo`, `cat`, pipe, redirect — write file, read it back
- Preview iframe + URL bar present, ASGI launcher span present
- chat-providers PROVIDERS registry shape, acptoapi entry sane
- shell-defaults exports `DEFAULT_CWD = '/home'`
- ASGI bridge mountAsgi + dispatchAsgi round-trip with stub app
- Lazy Pyodide loader present and **not yet loaded** (lazy invariant)
- GitHub login button rendered, theme toggle works, all three tabs present

Network tier (`docs/smoke-network.js`):

- For each provider with `localStorage.apiKey_<id>` or matching
  placeholder: GET `/models`, capture status + latency
- Probe `localhost:4800/v1/models` (acptoapi), `localhost:5173/`
  (hermes), `localhost:7000/` (kilo serve), `localhost:4096/`
  (opencode)
- Verify `./vendor/pyodide/pyodide.mjs` resolves locally; CDN
  fallback URL probed separately
- Cold-load Pyodide once, run `1+1`, assert result is 2

Each result row: `✓ name — detail   ms` (red ✗ on fail). Full report
is also stored at `window.__smokeReport` for programmatic inspection.

## Hermes Preflight (`?smoke=hermes`)

Browser-side validator specifically for "can Hermes run inside thebird's
Pyodide?" Each step renders one row with timing + a remediation hint
when it fails. No host process, no Hermes modification.

Steps (in order):

1. **pyodide:load** — lazy Pyodide cold-load (≈10 MB; first time ~15s,
   subsequent ms). Hint on failure: run `node scripts/vendor-fetch.mjs`.
2. **micropip:loaded** — Pyodide's `micropip` package available.
3. **wheel:pyyaml / pydantic / fastapi** — core wheels Hermes hard-needs.
   Each is a separate row so partial failure is visible.
4. **wheel-opt:httpx / jinja2 / requests / pyjwt / tenacity / rich /
   prompt_toolkit** — optional wheels; failures degrade rather than block.
   Hints flag known Pyodide gaps (`fal-client`, `firecrawl-py`,
   `parallel-web`, `exa-py`, `edge-tts` — no wheels in Pyodide repo).
5. **imports:core** — `import fastapi; import pydantic; import yaml`.
6. **asgi:fastapi-stub** — defines a 1-route FastAPI app inside Pyodide,
   mounts via `asgi-bridge.mountAsgi`, dispatches `GET /`, asserts 200.
   Proves the FastAPI ↔ ASGI ↔ same-origin-bridge chain works before
   we point it at Hermes itself.
7. **hermes:import** — try `import hermes_cli`. If sources aren't on
   Pyodide's `sys.path`, the row goes amber with a hint:
   - bundle `hermes_cli/`, `gateway/`, `agent/`, `tools/` into
     `docs/vendor/hermes/` and unpack into Pyodide FS at boot, OR
   - publish/use an sdist tarball with `micropip.install_from_url`.

Trigger: `[hermes-smoke]` button in the preview toolbar, or hit
`?smoke=hermes` directly. Full report stored at
`window.__hermesPreflight` for programmatic inspection.

## Vendor Architecture (current + planned)

**Today (current state):**

- **Page-boot path is fully same-origin.** `index.html`, all `app.js`/
  `terminal.js`/`shell-*.js`, `tui.css`, `app-shell.css`, vendored
  `xterm-bundle.js` and `webcontainer.js` and `thebird-browser.js` —
  all served from thebird's own origin. Zero CDN fetches at page load.
- **Pyodide entry vendored** at `docs/vendor/pyodide/`: `pyodide.mjs`,
  `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`,
  `pyodide-lock.json`, `package.json`. ~14 MB, committed.
- **Pyodide wheel index points at jsdelivr CDN** for now (`indexURL:
  https://cdn.jsdelivr.net/pyodide/v0.27.2/full/`). Reason: jsdelivr
  serves wheels under that path whose SHA-256 do NOT match what
  `pyodide-lock.json` claims (witnessed: micropip lock sha
  `f06926694dba…` vs jsdelivr-served `3bbbd5b1fbe6…`). Causes
  `loadPackage` to silently no-op. Until upstream fixes or we mirror
  from a sha-matched source, wheels remain a CDN fetch. Page boot
  is still local; first `python` invocation (already lazy) is the
  only thing that touches CDN.
- **MicroPython** (opt-in `THEBIRD_PYTHON=micro`) fully vendored at
  `docs/vendor/micropython/`.
- **5 esm.sh packages** vendored cleanly (brotli-wasm, fflate,
  source-map-js, browser_wasi_shim, isomorphic-git-http-web). Used
  by lazy Node-side code paths only.
- **5 esm.sh packages** vendored with shimmed `/node/*.mjs` polyfills
  (isomorphic-git, sucrase, sql-wasm, bcryptjs, argon2-browser).
  Hand-written shims at `docs/vendor/esm/node/` bridge to
  `globalThis.crypto`, `Buffer`, `fetch`, IDB-FS.

**Planned (multi-system + sha-resolved wheel mirror):**

1. **Shared vendor across virtual systems.** A user can run multiple
   "systems" (different `idbSnapshot` profiles) concurrently in the
   same page. The vendor mount (`docs/vendor/`) is read-only and
   shared — every system sees the same Pyodide bytes, the same npm
   bundles, the same node shims. Per-system writable state lives
   under `home/`. Wires through:
   - `window.__debug.systems = { default: {...}, hermes: {...}, ... }`
   - shell ctx carries `systemId` selecting the active home
   - vendor paths resolve via a single root, not per-system
2. **Sha-verified wheel vendor.** Either (a) build wheels locally
   from Pyodide source so we control hashes, or (b) wait for
   upstream fix, or (c) tolerate cdn-served wheels with a
   `try-vendor-then-cdn` fetch wrapper that disables the lock's
   sha check for non-vendored wheels. Wheels can balloon to 250 MB
   without harm — they're lazy, only fetched on first import.
3. **Per-system Pyodide instances.** Each virtual system gets its
   own Pyodide interpreter with isolated `home/` mounted, but the
   underlying bytes share one pool. Saves memory across systems.

## Vendor Localization

All heavy CDN imports have a vendored fallback under `docs/vendor/`.
On first import, modules try the local `./vendor/...` path; if the
file is missing they fall back to jsdelivr and print a one-line
nudge to run the fetch script.

**One-shot fetch:** `node scripts/vendor-fetch.mjs`

That downloads:

- Pyodide v0.27.2 → `docs/vendor/pyodide/` (pyodide.mjs, asm.js, asm.wasm, stdlib zip, lock, package.json)
- MicroPython v1.25.0 → `docs/vendor/micropython/` (mjs, wasm, package.json)

Each subdir gets a `manifest.json` with version + source URL +
fetch timestamp. Re-running the script is safe — existing files are
skipped.

After `vendor-fetch`, page-load fetches stay zero (lazy invariant)
and **first python-call** fetches from same-origin instead of jsdelivr.
Useful for offline use, GH Pages reliability, and reproducible builds.

## Lazy Runtime Pattern (reusable for future runtimes)

How to add any heavy language/tool runtime to thebird so it boots
**eagerly enough to feel integrated** and **lazily enough not to bloat
page load**. Python/Pyodide is the canonical example. Reuse for Ruby
(Ruby.wasm), Lua (Wasmoon), Crystal (Crystal-WASM), Go (TinyGo-WASM),
R (WebR), PHP (php-wasm), or any WASM-compiled language.

### Four-layer shape

```
shell.js                              eager:  ctx.<name>Eval at construction
  └─ shell-<name>.js                  factory + dispatcher
       └─ shell-<name>-runtime.js     lazy loader (loadRuntime, run, scanAndMount)
            └─ <CDN runtime>          downloaded only on first call

asgi-bridge.js | httpHandlers         registry that auto-discovered artefacts mount into
  └─ scanAndMount(inst, mountFn)      called after each runCode
       └─ window.__debug.<name>Apps + '<name>-mount' CustomEvent
            └─ index.html toolbar listens, renders launcher buttons
```

### Recipe

1. **Lazy module** `docs/shell-<name>-runtime.js`:
   ```js
   const URL_ = 'https://cdn.jsdelivr.net/...';
   let promise = null, instance = null;
   export function isLoaded() { return !!instance; }
   export async function loadRuntime(onStdout) {
     if (instance) return instance;
     if (promise) return promise;
     promise = (async () => {
       onStdout?.('fetching <name>...\n');
       const mod = await import(URL_);
       instance = await mod.init({ stdout: onStdout });
       window.__debug = window.__debug || {};
       window.__debug.<name> = { loaded: true, instance, run: c => instance.run(c) };
       return instance;
     })();
     return promise;
   }
   export async function scanAndMount(inst, mountFn) {
     // walk inst.globals; for each artefact (ASGI app, HTTP handler):
     //   if not in module-scope Map<name, ref>: mountFn(handler, '/' + name); add
     // dispatch CustomEvent('<name>-mount', { detail: { mounts } })
   }
   ```

2. **Dispatcher** `docs/shell-<name>.js`:
   ```js
   import * as runtime from './shell-<name>-runtime.js';
   export function create<Name>Env({ ctx, term }) {
     const builtins = make<Name>Builtin(ctx);
     async function scanAndMount() {
       if (!runtime.isLoaded()) return [];
       const inst = await runtime.loadRuntime(s => term?.write?.(s));
       const { mountAsgi } = await import('./asgi-bridge.js');
       return runtime.scanAndMount(inst, mountAsgi);
     }
     return { ...builtins, scanAndMount, isLoaded: runtime.isLoaded };
   }
   ```

3. **Eager wiring** `docs/shell.js` — one line:
   ```js
   ctx.<name>Eval = create<Name>Env({ ctx, term });
   ```

4. **Auto-discovery** in dispatcher's `runCode`:
   ```js
   await runtime.run(code, argv, stdoutSink);
   try {
     const { mountAsgi } = await import('./asgi-bridge.js');
     const mounts = await runtime.scanAndMount(inst, mountAsgi);
     for (const m of mounts) wl('\x1b[32m[<name>]\x1b[0m mounted ' + m.cls + ' at /preview' + m.prefix + '/');
   } catch {}
   ```

5. **Launcher** in `docs/index.html`:
   ```html
   <span id="<name>-launchers" style="display:flex;gap:1ch"></span>
   ```
   ```js
   function render<Name>Launchers() {
     const host = document.getElementById('<name>-launchers');
     const apps = window.__debug?.<name>Apps;
     const prefixes = apps ? Array.from(apps.keys()) : [];
     host.innerHTML = prefixes.map(p =>
       `<button class="tui-btn" onclick="loadPreviewUrl('./preview${p}/')">[${p.replace(/^\//,'')}]</button>`
     ).join('');
   }
   window.addEventListener('<name>-mount', render<Name>Launchers);
   ```

6. **test.js invariants**:
   - Wrap `globalThis.fetch`, import the runtime module, assert zero calls.
   - Assert `isLoaded() === false` after import.
   - Stub instance with one fake artefact → `scanAndMount` returns 1, registry has it.
   - Re-call `scanAndMount` → returns 0 (idempotent).

### Invariants (hard rules)

- **No page-load fetch.** Witnessed by fetch-wrap in test.js.
- **Single concurrent download.** Module-scope `let promise = null` shared.
- **Idempotent auto-discovery.** Track mounted refs in a `Map`.
- **Errors surface.** Network failure prints a clear terminal line, no silent retry.
- **Opt-out flag.** Provide an env escape hatch (e.g. `THEBIRD_PYTHON=micro`) for a lighter alternate where one exists.

### Known Lazy Lanes

| Tool | Runtime module | Heavy fetch URL |
| ---- | -------------- | --------------- |
| Python (default) | `docs/shell-python-pyodide.js` | `cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs` |
| MicroPython (opt-in via `THEBIRD_PYTHON=micro`) | `docs/shell-python.js` | `@micropython/micropython-webassembly-pyscript@1.25.0` |

The reusable gm skill at `~/.claude/skills/lazy-runtime/SKILL.md`
codifies this recipe so future tools can be added with one skill
invocation.

## Hermes Runs in the Browser (witnessed green 2026-04-26)

`?smoke=hermes` reports **19/19 ✓** in real Chrome against
`https://anentrypoint.github.io/thebird/`. Hermes is unmodified —
thebird absorbs every adaptation.

**Architecture (reusable for any unmodified CPython webapp):**

1. **Lazy Pyodide entry** (vendored at `docs/vendor/pyodide/` — zero
   CDN fetch on page boot; wheels still pulled lazily from jsdelivr
   on first python use, sha-verified against the lockfile).
2. **`docs/vendor/python-shims/`** — 14 Python modules covering
   native-only stdlib gaps. Each is a **shim that connects to a
   real thebird surface**, not a stub:

   | Module | Connects to |
   | ------ | ----------- |
   | `subprocess` | `window.__debug.shell.run` — real POSIX shell |
   | `psutil` | `window.__debug.shell.bgJobs/jobRegistry` for processes; `window.performance.memory` for RAM; `navigator.hardwareConcurrency` for CPU count |
   | `curses` | `window.__debug.term` (xterm) — `addstr` writes ANSI cursor positioning + bold/reverse/underline; `clear/erase` issues `\x1b[2J\x1b[H`; `curs_set` toggles `\x1b[?25h/l`; `getmaxyx` reads xterm `rows/cols` |
   | `pwd`/`grp` | `localStorage.thebird_github_user` — real user identity from GitHub login |
   | `fcntl` | `window.__debug.shell.fdTable` — fd flags + locks against real fd registry |
   | `termios` | xterm modes — `tcsendbreak` sends `\x03`; `tcsetattr` toggles cursor visibility on ICANON change |
   | `msvcrt` | xterm input queue — `kbhit` reads `shell.inputQueue`; `getch/getche/putch` bridge through term |
   | `winpty` | spawns via `shell.run`, sizes via xterm `term.resize` |
   | `ptyprocess` | same as winpty — `spawn(argv).read()` reads xterm input queue, `.write()` issues to shell or terminal |
   | `select.select` | fd 0 reads from `shell.inputQueue`; other fds via `shell.fdTable.readFd` |
   | `sounddevice` | Web Audio API — `play()` builds an `AudioBuffer` and routes through `AudioContext.destination` |
   | `soundfile`/`wave` | Real WAV PCM reader/writer over IDB-FS `open()` — round-trips 16/32-bit PCM frames |

   Mounted at `/vendor-shims/` and inserted at the front of
   `sys.path`.
3. **`docs/python-runtime.py`** — bootstrap that runs once after
   `loadPyodide`. Patches `threading.Thread.start` to run target
   inline (Pyodide has no real threads). Installs a `sys.meta_path`
   finder that returns a `SimpleNamespace` stub for any `import`
   matching an allowlist of safe third-party prefixes (boto3,
   discord, telegram, mautrix, mcp, slack_sdk, mistralai, modal,
   daytona, dingtalk_stream, alibabacloud, nacl, kittentts,
   faster_whisper, mem0, honcho, parallel, firecrawl, exa_py,
   fal_client, edge_tts, elevenlabs, tiktoken, acp, davey,
   simple_term_menu, dotenv, croniter, aiohttp_socks, qrcode,
   mutagen, markdown, PIL, numpy, websockets, tomllib). Real
   packages still win when present; stubs only fill in on
   `ModuleNotFoundError`. Stub modules synthesise sub-attributes on
   access so chained access (`mod.Sub.thing`) works.
4. **`scripts/bundle-hermes.mjs`** — zero-dep Node script that
   walks the recursive import closure of `hermes_cli.web_server`
   (245 files spanning every Hermes subpackage) and copies them
   into `docs/vendor/hermes/` along with the prebuilt React
   `web_dist/`. Writes a manifest. Re-runnable.
5. **`docs/smoke-hermes.js`** — fetches the manifest, writes every
   bundled file into Pyodide's FS at `/vendor-apps/hermes/`,
   `sys.path.insert`s it, then `from hermes_cli.web_server import
   app`, mounts that real FastAPI app under `/hermes` via
   `asgi-bridge`, hits `GET /hermes/`. Round-trips through real
   Starlette middleware + Hermes auth_middleware + route dispatch.

**ASGI scope normalization** (in `smoke-hermes.js`'s `_drive_hermes`
helper): converts JS `Uint8Array` header values to Python `bytes`
before passing the scope to FastAPI. Without this, Starlette's URL
parser hits `memoryview.decode()` and 500s. Same helper applies to
receive-message bodies.

**The pattern is reusable for any CPython webapp.** Drop the app's
import closure into `docs/vendor/<app>/`, write any missing
shims into `docs/vendor/python-shims/`, extend the SAFE_PREFIXES
allowlist for the app's third-party deps, mount via asgi-bridge.

## Hermes GUI in the Preview Pane

The Hermes web GUI lives at `c:/dev/hermes/web` (Vite + React + tailwind +
xterm). To render it inside thebird's preview pane:

1. Run thebird locally: `bunx serve docs` — needed because GH Pages (HTTPS)
   cannot iframe loopback HTTP (Chrome PNA blocks public→loopback regardless
   of Access-Control-Allow-Private-Network; this is in memory).
2. In `c:/dev/hermes/web`: `npm install && npm run dev` — Vite serves on
   `http://localhost:5173`.
3. In thebird, switch to the **preview** tab. Click **[hermes]** in the
   preview toolbar (or paste `http://localhost:5173/` into the URL field
   and press Enter / [go]). The iframe loads the Hermes SPA.
4. The hermes-theme repo (`c:/dev/hermes-theme`) supplies design tokens
   (`theme/clean.yaml`, `theme/clean-dark.yaml`) and dashboard assets
   (`dashboard/dist`) consumed by the Hermes web build via
   `@nous-research/ui`. No thebird-side wiring needed — the theme is baked
   into the Hermes build.
5. Click **[idb]** to switch back to thebird's in-browser preview (rendered
   from the IDB virtual filesystem).

The iframe carries `sandbox="allow-scripts allow-same-origin allow-forms"`,
which is sufficient for a Vite dev server on the same origin family.
Cross-origin localhost iframes from a *deployed* GH-Pages site are blocked;
this feature is local-dev only.

## Chat-Tool Provider Wiring

Three external agent CLIs are reachable through the **acptoapi** OpenAI-compat
gateway at `http://localhost:4800/v1` (start with `bunx acptoapi`):

- **Kilo Code** — `kilo/*` model IDs (e.g. `kilo/x-ai/grok-code-fast-1:optimized:free`,
  `kilo/kilo-auto/free`, `kilo/openrouter/free`).
- **opencode** — `opencode/*` (e.g. `opencode/minimax-m2.5-free`).
- **Claude Code** — reachable via OpenRouter's `anthropic/claude-*` model IDs
  through the existing `openrouter` provider, or via Vercel's gateway
  (`vercel` provider exposes `anthropic/claude-sonnet-4.5`).

All three flow through `streamOpenAI` from `docs/vendor/thebird-browser.js`
(the vendored acptoapi browser bundle). `chat-providers.js` PROVIDERS
registry is the single source of truth for endpoint URLs and default model
lists. `test.js` asserts the export surface is intact and the provider
registry has lanes for kilo, opencode, and claude-class models.

Live end-to-end validation requires the user to run the acptoapi gateway
locally and supply credentials. The Node-side test harness validates the
import surface and provider config; in-browser the existing UI exercises
real prompt round-trips per provider.

## POSIX Predictability — LLM-Facing Guarantees

The shell is the boundary an LLM sees. Behaviors witnessed by `test.js` (47 assertions, 10 scenario groups):

- `~` expands to `/home`; `~/x` → `/home/x`. Always. From any cwd.
- Empty/null path arg to `resolvePath` returns cwd unchanged.
- `cd` with no arg defaults to `~` (i.e. `/home`); `cd -` toggles to `prevCwd`; `cd` into nonexistent dir throws.
- Tokenizer preserves `\n` inside double-quotes as literal backslash-n (so `echo -e` can process it). Single-quotes never process escapes.
- `splitTopLevel` returns `{cmd, sep}` pairs where `sep` is the separator BEFORE the cmd (first item's sep is `null`).
- `parsePipes` ignores `|` inside quotes.
- `parseRedirects` recognises `>`, `>>`, `<`. No `2>`, no `&>` yet — document divergence if needed.
- `expand`: `$?` = lastExitCode, `$#` = argv.length, `$@` = argv joined, `$0..$9` indexed, unset variables expand to empty string (matches bash default, not `set -u`).
- `globToRe`: `*` does not cross `/`, `**` does, `[abc]` and `[!abc]` work, `?` is single non-slash char.
- `isControlStart` recognises `if/for/while/case/until/select/function`.

Single source of truth for the home folder: `docs/shell-defaults.js` exports `DEFAULT_CWD` and `HOME_DIR`. Every chat tool (`agent-chat.js` `run_command`, `list_files`) and `shell.js` (ctx init) and `shell-builtins.js` (`resolvePath` `~`) imports from there. No `/home` literal duplicates.

## Architecture Overview

**thebird** is the web OS shell — browser-native terminal, agentic chat, and file system. The repo has **no `package.json`, no `node_modules`, no server**. The entire product is the static `docs/` directory deployed to GitHub Pages. All Anthropic-format message translation, routing, streaming, and tool calling is owned by **[acptoapi](https://github.com/AnEntrypoint/acptoapi)**, vendored into the browser as `docs/vendor/thebird-browser.js`. Consumers of acptoapi outside the browser run `bunx acptoapi` / `npx acptoapi` / `npm install acptoapi`.

```
thebird/
  ├── docs/                    — the entire product (GH Pages static site)
  │   ├── index.html           — landing + live app (overview/live-app modes)
  │   ├── app.js               — bird-chat custom element
  │   ├── terminal.js          — xterm + xstate boot
  │   ├── shell-*.js           — POSIX shell builtins / parser / exec
  │   ├── tui.css              — component styles (tabs, msg, toolbar)
  │   ├── defaults.json        — virtual FS seed (sys/* infra · home/* user)
  │   └── vendor/
  │       ├── design-tokens.css, app-shell.css   — 247420 design system
  │       ├── thebird-browser.js                 — vendored acptoapi (browser bundle)
  │       └── xterm-bundle.js, ui-libs.js, ...   — xterm, webjsx, etc.
  └── .github/workflows/pages.yml   — auto-deploy docs/ on push to main
```

Local dev = any static server: `bunx serve docs` / `npx serve docs` / `python -m http.server -d docs`.

### Message Translation (in acptoapi)

Anthropic format:
```js
[{ role: 'user', content: [
  { type: 'text', text: '...' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
] }]
```

Translates to provider-native format:
- **Gemini**: `parts: [{ text: '...' }, { inlineData: { mimeType: '...', data: '...' } }]`
- **OpenAI**: `content: [{ type: 'text', text: '...' }, { type: 'image_url', image_url: { url: '...' } }]`

### Tool Calling (in acptoapi)

Anthropic tool schema → provider native → normalized response back to Anthropic format.

Streaming events (all events are Anthropic-compatible):
- `text-delta`, `tool-use-start`, `tool-use-delta`, `message-start`, `message-stop`

### Routing (Multi-Provider, in acptoapi)

`createRouter()` picks provider+model per request based on:
1. `taskType` (e.g., 'think', 'background', 'longContext')
2. Token count vs `longContextThreshold`

Routes are defined as `provider,model` strings in config.

### Transformers

Some providers need field adjustments:
- `deepseek`: strips `cache_control`, `repetition_penalty`
- `groq`: removes `top_k`
- `reasoning`: moves `reasoning_content` to `_reasoning`

Applied automatically during request building.

## gembird — Image Generation via Hybrid Approach

**gembird** generates 4-view product images (front, back, left-side, right-side) using Gemini's web UI + HTTP API hybrid approach.

### Workflow

1. **Auth via Browser**: Playwright CDP connects to Chrome on `localhost:9222` and navigates to gemini.google.com. User is already logged in.
2. **Session Capture**: Intercept network requests to extract session: `{ cookies, xsrf, fsid, template }`. One-time capture, cached in `.gemini-session.json`.
3. **HTTP Generation**: For each view, POST prompt to Cloud Code Assist API with captured session. Stream response.
4. **Parse Response**: Extract image URLs from streaming response via regex.
5. **Download**: Download PNG from `lh3.googleusercontent.com` with cookies. Save to disk.

### Why Hybrid?

Gemini API free tier has 0 quota for image generation. Browser provides free auth. HTTP API (Cloud Code Assist) provides faster generation than DOM polling + canvas extraction. Hybrid = free auth + fast generation + no quota limits.

### Performance

- Browser connection: one-time, 30s
- HTTP generation per image: ~30-60s (Gemini's generation time, not polling overhead)
- Download per image: ~5s
- Total: ~4 images in 2-3 minutes (vs ~8 minutes with browser polling + canvas extraction)

### CLI

```bash
node index.js "prompt"
node index.js --image ref.png "prompt"
node index.js --output ./dir "prompt"
```

Arguments parsed in index.js lines 88-115.

### Observability

- Session cached in `.gemini-session.json` (expires after 1 hour)
- HTTP response streamed and parsed for image URLs
- Download errors logged with context
- Progress logged per view: `[1/4] front view...`

## docs/ Build System

All frontend dependencies are vendored to `docs/vendor/` to eliminate CDN brittleness.

**Vendored files:**
- `ui-libs.js` (7.7KB): webjsx + htm — bundled with esbuild
- `xterm-bundle.js` (345KB): @xterm/xterm + @xterm/addon-fit — bundled with esbuild
- `webcontainer.js` (12KB): @webcontainer/api — bundled with esbuild (no runtime CDN deps)
- `tailwind.css` (13KB): generated by @tailwindcss/cli v4, purged from `docs/**/*.{html,js}`
- `rippleui.css` (4.7MB): downloaded directly (includes Tailwind v3 preflight, not utilities)
- `xterm.css` (7KB): downloaded directly

**Regenerate:**
- esbuild bundles: install devDeps then run esbuild with entry files in project root
- Tailwind: `tailwindcss --input '_tw-input.css' --output docs/vendor/tailwind.css --minify` where input contains `@import "tailwindcss"`
- CSS files: fetch from jsdelivr directly

**Key detail**: esm.sh returns stub files by default — fetch the actual `.mjs` bundle URL paths directly when downloading from esm.sh.

**DevDeps**: esbuild, @tailwindcss/cli, @xterm/xterm, @xterm/addon-fit, @webcontainer/api, webjsx, htm.

## Development Constraints

- Max 200 lines per file (split before hitting limit)
- No comments
- No test files
- No hardcoded values
- Errors throw with context (no silent failures)
- Messages must stay Anthropic-compatible (other code depends on this contract)
- Tool schemas must translate cleanly to all providers

## Testing

No test files. Validation via:
- `examples/basic-chat.js`: Single-turn Anthropic format → Gemini
- `examples/streaming.js`: Streaming events
- `examples/tool-use.js`: Tool calling and tool result handling
- `examples/vision.js`: Image blocks (base64, URL, inline)
- `examples/multi-turn.js`: Multi-turn chat with context

Run examples against real Gemini API to validate message translation.

## Known Issues & Workarounds

- Gemini API doesn't support `tool_choice: 'required'` — treated as `'auto'`
- Some models have different tool naming conventions — check provider docs
- Streaming response parsing varies by provider — see lib/providers/ for details
- OAuth tokens expire — gembird uses browser session instead of capturing tokens
- Cannot bundle index.js directly for browser — it imports Node-only modules (oauth.js, config.js, cloud-generate.js) at top level. Create a separate browser entry that imports only lib/client.js, lib/errors.js, lib/convert.js. Use ESM wrapper (not CJS module.exports) to preserve named exports in bundle.
- Tool parameter types must be lowercase for Gemini API — `object`, `string`, `number` not `OBJECT`, `STRING`, `NUMBER`. Uppercase types fail schema validation.
- agentGenerate passes raw Anthropic-format messages to streamGemini internally, which calls convertMessages. Do NOT pre-convert in app.js — double-conversion breaks tool schemas.
- Anthropic format IS the canonical message format — do NOT add an intermediate transformation layer. Direct translation to provider-native formats is cleaner than another abstraction level.
- **shell.js httpHandlers visibility chain**: shell.js creates `httpHandlers = {}` and returns it on the shell object. terminal.js assigns `window.__debug.shell = shell`. shell-node.js mutates `window.__debug.shell.httpHandlers[port]` to register routes. index.html reads from `window.__debug.shell.httpHandlers`. All four modules reference the same object; httpHandlers MUST be returned on the shell object or the chain breaks.

- **Shell builtin pipe stdin detection**: When a builtin receives piped input (e.g. `echo hello | grep hello`), the pipe buffer arrives as `args[0]`. Builtins with mandatory leading args (grep: pattern, sed: expression) must detect `positional[0].includes('\n')` BEFORE extracting those args, then shift stdin off. `cat`/`wc`/`sort`/`uniq` use the same check. Single-line piped content always has `\n` because `echo` appends `\r\n`.
- **Tokenizer double-quote escape sequences**: Inside double-quotes, only `"`, `\`, `` ` ``, `$` are valid escape sequences. `\n` in double-quotes must be preserved as literal backslash-n for `echo -e` to process. Fix: when escape=true and quote==='"', re-emit backslash before char if char not in `"\\\`$`.- **Test policy**: Single test.js file (max 139L per constraint). e2e-test.js deleted. Validation via live API calls with exec:nodejs (browser automation unavailable in this environment).
- **ACP protocolVersion is a number**: Kilo Code's `kilo acp` server rejects string `'0.1'` with `-32602 Invalid params: expected number`. Use integer `1`. acp-stream.js:73 fixed.
- **Kilo ACP over WebSocket bridge (Windows)**: To consume Kilo Code as the page's ACP provider, bridge its stdio to WS. The npm shim `kilo.cmd` uses `stdio: "inherit"` which detaches from the bridge's pipes, so invoke the platform binary directly: `C:\Users\user\AppData\Roaming\npm\node_modules\@kilocode\cli\node_modules\@kilocode\cli-windows-x64\bin\kilo.exe acp`. Bridge command: `bunx -y stdio-to-ws "<abs-path>\kilo.exe acp" --port 3015`. Bunx cold start is 15–25s; wait for `[stdio-to-ws] WebSocket server listening`. Validated: initialize → result with `protocolVersion: 1, agentInfo: { name: 'Kilo', version: '7.2.0' }, authMethods: [{ id: 'kilo-login' }]`. Actual prompts require `kilo auth login` first.
- **Kilo ACP `session/new` requires `mcpServers` array**: Kilo's zod schema for `session/new` params requires `mcpServers` (array). Omitting it returns `-32602 Invalid params: expected array, received undefined`. Fix: pass `{ cwd, mcpServers: [] }` — see docs/acp-stream.js:74.
- **Kilo ACP `session/prompt` shape**: Kilo's schema is `{ sessionId, prompt: [...content blocks] }` — NOT `{ sessionId, message: { role, content: [...] } }`. Wrong shape returns `-32602 Invalid params: prompt expected array, received undefined`. Fix: send `prompt: [{ type:'text', text }]` directly — see docs/acp-stream.js:80.
- **Kilo ACP `session/update` notification shape**: Kilo emits `{ params: { sessionId, update: { sessionUpdate:'agent_message_chunk', content:{ type:'text', text } } } }` — singular `update`, and the discriminator is `sessionUpdate` not `type`. Iterating `updates[]` (plural) with `item.type==='message_chunk'` never matches real Kilo output. Fix: normalize to `update ? [update] : (updates||[])` and match `sessionUpdate==='agent_message_chunk'` with `content.type==='text'`. See docs/acp-stream.js:93.
- **Kilo ACP `kilo/*` free models require `kilo auth login`**: Built-in free routes (`kilo/x-ai/grok-code-fast-1:optimized:free`, `kilo/openrouter/free`, etc.) only work after interactive `kilo auth login` stores a credential in `~/.local/share/kilo/auth.json`. `kilo auth list` exposes `OPENAI_API_KEY`/`GEMINI_API_KEY` env vars as alternate auth sources, but those only apply to direct-provider models (`openai/*`, `google/*`) — not to `kilo/*` routes. With an invalid/missing GEMINI_API_KEY, `session/prompt` returns `stopReason:'end_turn'` with zero tokens and no text chunks — silent no-op, not an error. Any real end-to-end prompt validation requires a valid provider key or an authenticated Kilo account.
- **Kilo ACP `session/set_model` is supported**: Call `session/set_model` with `{ sessionId, modelId }` between `session/new` and `session/prompt` to override the default (`kilo/x-ai/grok-code-fast-1:optimized:free`). Validated with `modelId:'google/gemini-2.5-flash'` — response includes `_meta.opencode.modelId` confirming the switch.
- **Kilo free models DO work non-interactively without `kilo auth login`**: Earlier assumption was wrong. The bundled `@kilocode/kilo-gateway` provider (`providerID:'kilo'`, source:'custom', env:[KILO_API_KEY]) serves free routes (`x-ai/grok-code-fast-1:optimized:free`, `openrouter/free`, `kilo-auto/free`, etc.) anonymously over the built-in HTTP server. Witnessed via `kilo serve --port N` + `POST /session` + `POST /session/:id/message` with `{ parts:[{type:'text',text}], modelID:'x-ai/grok-code-fast-1:optimized:free', providerID:'kilo' }` → `status 200`, `finish:stop`, real text output in ~5s. Cost: 0. Reference: C:\dev\agentgui\lib\claude-runner-acp.js shows the identical flow working over ACP stdio — key detail is a 5-min (300000ms) timeout because the gm agent plugin (globally installed at `C:\Users\user\.config\kilo\plugins\gm-kilo.mjs`) does git ops on first prompt. gm system prompt is always injected (~18-19k input tokens regardless of agent param).
- **Kilo agent plugin overrides requested model**: Specifying `modelID:'x-ai/grok-code-fast-1:optimized:free'` on a prompt often gets silently routed to `openrouter/elephant-alpha` because the `gm` agent (auto-selected when `default_agent:'gm'` is in `opencode.json`) has its own model picker. Check `info.modelID` in the response to see what actually ran. To bypass gm routing, delete or rename `C:\Users\user\.config\kilo\opencode.json` and `kilocode.json` which set `default_agent:'gm'`.
- **Kilo `run` subcommand hangs, `serve` + HTTP works**: The `kilo run` CLI path currently blocks indefinitely after config load (even at DEBUG log level, no provider activity logged). Workaround: use `kilo serve --port N` and POST to `/session/:id/message` — same bundled provider, same free models, responds in seconds. Also applies to ACP stdio: `kilo acp` works but has long cold-start through the gm plugin, so any bridge must allow at least 5 minutes per prompt.

## Error Architecture

**Error hierarchy** (lib/errors.js):
- `BridgeError(message, { status, code, retryable, provider, headers })` — base class, `GeminiError` alias for backwards compat
- `AuthError` (401/403), `RateLimitError` (429, retryable), `TimeoutError` (408, retryable), `ContextWindowError` (413), `ContentPolicyError` (451), `ProviderError` (5xx, retryable)
- `classifyError(status, message, provider)` — factory returns typed error from status code
- `redactKeys(str)` — masks API keys (AIza, sk-, key- patterns) to `...XXXX`
- `parseRetryAfterHeader(err)` — standard HTTP Retry-After (seconds + date formats)

**Stream guards** (lib/stream-guard.js):
- `guardStream(iterable, { chunkTimeoutMs, maxRepeats })` — wraps async iterables
- Chunk timeout default 30s, repeat threshold default 100

**Circuit breaker** (lib/circuit-breaker.js):
- `createCircuitBreaker({ maxFailures, cooldownMs })` — per-provider failure tracking
- Auto-recovery after cooldown, reset on success

**Capabilities** (lib/capabilities.js):
- `getCapabilities(provider)` — merges provider.capabilities with defaults
- `stripUnsupported(params, caps)` — removes unsupported features, returns warnings
- Defaults: streaming, toolUse, vision, systemMessage = true; jsonMode = false

## Chat Observability (docs/)

`docs/kilo-http-stream.js` emits rich events via `PART_HANDLERS` dispatch table (kilo HTTP + opencode SSE unified):
- `status` — lifecycle (connecting, session id, POST status, mirror step)
- `model-info` — { providerID, modelID } actually routed to (may differ from requested when gm agent plugin hijacks)
- `text-delta` / `reasoning-delta` — accumulating growth
- `tool-event` — { toolName, status, input, output, error, id } from `part.type === 'tool'` state
- `file-event` / `file-mirrored` — agent file writes / sandbox mirror results
- `step-start` / `step-finish` — { id, tokens?, cost? } boundaries
- `unknown-part` — diagnostic for unhandled part.type

`window.__debug.agent` permanent registry (populated by `agent-chat.js`):
`{ provider, model, modelActual, providerActual, active, startedAt, finishedAt, durationMs, textChars, reasoningChars, toolCalls, files, steps, lastTool, lastError, events: [...rolling 300] }`

Per-provider rolling logs: `window.__debug.kilo.events`, `window.__debug.opencode.events`.

UI consumes via 3 channels: `onChunk(delta)` text streaming | `onEvent(ev)` badge rendering via `renderEvent()` dispatch table in `docs/chat-providers.js` | 4Hz poll on `window.__debug.agent` → `#agent-stats` strip (live counters).

## Files

- `docs/index.html`: landing + live app, classed against the 247420 design system (`vendor/design-tokens.css` + `vendor/app-shell.css`)
- `docs/tui.css`: terminal/chat component styles, aliased onto design tokens
- `docs/shell-builtins.js`: FS/IO builtins (ls/cat/echo/cd/mkdir/rm/cp/mv/touch/head/tail/wc) — imports makeTextBuiltins
- `docs/shell-builtins-text.js`: Text-processing builtins (grep/sed/sort/uniq/tr) + env/export/clear/history/which/exit/true/false/printenv
- `docs/vendor/thebird-browser.js`: vendored acptoapi bundle (browser entry: lib/client + lib/errors + lib/convert)

**acptoapi** (owned by `c:/dev/acptoapi`, vendored as `docs/vendor/thebird-browser.js`):
- `lib/convert.js`: Message/tool translation logic
- `lib/client.js`: Provider client factory
- `lib/errors.js`: Typed error hierarchy (BridgeError, AuthError, RateLimitError, etc.), classifyError, redactKeys, withRetry
- `lib/stream-guard.js`: guardStream — chunk timeout and repeated-chunk detection for async iterables
- `lib/circuit-breaker.js`: Per-provider failure tracking with auto-recovery
- `lib/capabilities.js`: Provider capability metadata and unsupported feature stripping
- `lib/router-stream.js`: Router streaming/generation with circuit breaker and capability integration
- `lib/providers/`: Provider-specific streaming implementations
- `index.js`: Main entry point, Gemini streaming/generation, re-exports
- `index.d.ts`: TypeScript type definitions
- `examples/`: Working examples using Anthropic SDK format

## WebContainer Terminal in docs/

Interactive terminal in docs/index.html runs thebird + Node.js server in WebContainer API.

### Architecture

- **defaults.json**: docs/defaults.json is a 46KB single-line JSON blob containing all container files (package.json, lib/*.js, index.js, server.js, agent.js). Fetched by terminal.js on first boot instead of hardcoding DEFAULT_FILES inline (avoids 200-line limit).
- **Flat mount object**: WebContainer accepts `{'lib/client.js': ...}` directly — no nested directory tree needed.
- **COEP window.coi fix**: Add `<script>window.coi = { coepDegrade: () => false };</script>` BEFORE coi-serviceworker.js. Prevents degradation from credentialless to require-corp, which blocks Tailwind CDN. Key is `window.coi` (not `window.__coi_serviceworker`).
- **iframe allow attribute**: Remove `allow="cross-origin-isolated"` — not a valid Feature Policy keyword. WebContainer iframes work without it.
- **agent.js routing**: Inside container, agent.js uses `@anthropic-ai/sdk` with `baseURL: "http://localhost:3000"` pointing at thebird proxy (server.js), which translates Anthropic format → Gemini.

### spawn() and window.__debug API

- **container.spawn() env passing**: `container.spawn('node', ['agent.js', task], { env: { GEMINI_API_KEY: key } })` passes env vars directly to spawned process. Third arg accepts `{ env, cwd, terminal }`.
- **window.__debug.runAgent(key, task)**: Spawns agent.js in WebContainer with GEMINI_API_KEY env, pipes stdout/stderr to xterm terminal, tracks state in `window.__debug.validation = { running, output, exitCode }`.

## Environment Notes

- Repo remote: `https://github.com/AnEntrypoint/thebird.git` (capital A)
- No `package.json`, no `node_modules`, no server. Local dev is any static server on `docs/` (`bunx serve docs`).
- Only CI workflow is `pages.yml` — auto-deploys `docs/` on push to main when files under `docs/**` change. Bump-and-publish was retired with `package.json`.
