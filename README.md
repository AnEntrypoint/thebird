# thebird

A bash terminal that runs in the browser. Commands run in bashkit, a WebAssembly bash, inside a Web Worker, over files kept in the browser's OPFS storage. In-page builtins provide `git`, `sqlite3`, `python3`, `pip`, `curl`, `wget` and fx's WebAssembly core. Apps share floosie's browser stream hub. The only Node code is a static server that serves the page.

The earlier gm-backed CLI and library were removed.

Live: https://anentrypoint.github.io/thebird/ (GitHub Pages, deployed from `main` by `.github/workflows/pages.yml`).

## Requirements

- Node >= 22, for the static server.
- Chromium, for the witness. Set `CHROME_BIN`; the default is `/usr/bin/chromium-browser`.

After a fresh clone, generate the vendored runtime (needs network):

```bash
node scripts/vendor-bashkit.mjs
node scripts/vendor-fx.mjs
node scripts/vendor-floosie.mjs
```

`vendor-fx.mjs` reads the sibling `../fx/fx` checkout, or `FX_REPO`, and uses Zig 0.17.1 from `ZIG` or its local paths. The Pages workflow sets `FX_REPO` to the latest `main` checkout of `AnEntrypoint/gmfx` and rebuilds it on every deployment. `vendor-gm.mjs` reads the sibling `../gm` checkout, or `GM_REPO`, and builds `gm-core.wasm` from gm's portable C++ JSON, SHA-256 and compaction sources with the same Zig toolchain. `vendor-floosie.mjs` builds floosie's bare JS browser bundle from `../floosie`, or `FLOOSIE_REPO`. The Pages workflow checks out the gm and floosie repositories at `main` and rebuilds both on every deployment.

## Run

```bash
npm start
node bin/thebird-relay.js --port 8080 --host 127.0.0.1
```

Open the URL the server prints. `--port` defaults to an OS-assigned port and `--host` to `127.0.0.1`. The server answers GET and HEAD only.

## Canonical local web host

The canonical serving path is the built site served with cross-origin isolation; **txiki.js in the browser is the runtime**, not a Node-side application server. Build and start it on a known localhost port:

```bash
node scripts/build-pages.mjs
npm run host
```

Open `http://127.0.0.1:4173/`. `npm run host` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so `web/vendor/txiki/tjs.wasm`, OPFS/worker paths, cancellation and the vendored fx core work in a normal browser URL. `npm run host:status`, `npm run host:check` and `npm run host:stop` manage that exact host; `npm run host:serve` runs the same host in the foreground. `npm start` remains the source-tree development relay, not the canonical built-site host.

fx and page scripts can program visible cards through `window.THEBIRD_FEATURES` (`web/features.js`), with `register`, `update`, `remove`, `list` and `clear`. `web/features.json` registers a demo card at boot, and `?featureProgram=1` runs `web/features-program.js` inside txiki to register another through `web/features-bridge.js`. See `docs/WEB_HOSTS.md` for the API, txiki bridge and runbook.

`npm run host:check` verifies the pinned txiki wasm, HTTP 200, content types, COOP/COEP headers, the terminal title/engine, and headless Chromium DOM showing both the fx-programmed and txiki-programmed feature cards.

## Query parameters

- `?run=<command>` runs each `run` value in order when the page loads. The body gets `data-done="true"` when they finish. Repeat the parameter for more commands.
- `?featureProgram=1` runs the txiki.js feature demo and adds its visible card to `window.THEBIRD_FEATURES`.

## What works

- Bash syntax and common commands from bashkit: pipelines, variables, loops, functions, redirects, sed, awk, grep, find, jq, sha256sum and others.
- `git init`, `status`, `log`, `diff`, `add`, `commit -m`, and local `branch` and `checkout`. `commit` runs the in-page gate.
- `sqlite3 <database> <sql>`, with the database kept as a file in OPFS. It runs through txiki.js's `tjs:sqlite` module.
- `python3 -c <code>` and `python3 <file>`, run by Pyodide.
- `pip install <package>...` for pure-Python packages from PyPI.
- `curl` and `wget`, for hosts that send CORS headers to the page.
- `fx --version`, `fx --help` and `fx check` from fx's browser WebAssembly core. `fx ask <prompt>` needs `window.THEBIRD_FX = { apiKey, model }` and WebAssembly JSPI. fx and page scripts can also register visible DOM cards through `window.THEBIRD_FEATURES`.
- `feature '<json>'` applies a visible-feature request through the same API; txiki.js programs reach it over `__thebirdBridge`.
- `playwriter --version`, `playwriter status`, `playwriter execute <code>` and `playwriter stdio '<json-rpc>'`. Load the Birdman extension, grant the toolbar button on the thebird tab, then `playwriter execute <code>` controls other tabs over CDP. Execute bodies run in txiki.js with `browser`, `context`, `state` and `console` in scope; no Node playwriter server or upstream browser extension is used.
- `which`, `type` and `command -v` give the same answer for each name.

## Limits

- `run_shell` bodies, git remotes, MCP client processes, auto-update, browser automation and the wiki, review and row verbs are not ported to the in-page wasm core; `run_shell` is refused.
- No background jobs. A bare `&` is refused.
- No `node` and no host binaries; they exit 127.
- No git remotes. `push`, `fetch` and `pull` are refused.
- pip takes plain names only. Version specifiers, URLs and packages in the Pyodide set are refused. Installed packages last for the page session.
- Each command line has a 900 s limit. See `ARCHITECTURE.md`.

## Keys

- Up and Down: history.
- Tab: command names on the first word, otherwise workspace paths.
- Ctrl-C: cancels the running command and drops queued lines.
- Touch: tap the terminal to focus it. Drag on it to scroll the output.
- Ctrl-L clears the output. Ctrl-U clears the line. Ctrl-A and Ctrl-E move to the start and end of the line.
- Left, Right, Home, End and Delete edit the line, Ctrl-K cuts to the end and Ctrl-W cuts the word before the cursor. Paste inserts the text, and each pasted newline submits a line.

History is kept in localStorage under `thebird.history`. It holds the submitted command lines only, capped at 500.

## Validation

```bash
npm run check
npm run host:check
npm run lint:comments
npm run lint:architecture
npm run witness
```

`npm run witness` drives headless Chromium through `scripts/browser-driver.mjs` and checks the in-page shell end to end. `npm run host:check` drives headless Chromium against the canonical isolated host and checks the txiki wasm pin, HTTP status/content types/COOP+COEP, the rendered terminal title and fx/txiki visible-feature DOM.

## Hosted webservers

thebird has a standardized, live hosted-site system. Agents use normal Node, npm and bash commands:

```bash
node bin/thebird-webserver.js register my-app --title 'My App'
cd .thebird/webservers/my-app
npm install
npm start
```

Each registered server gets a normal folder scaffold and live standard routes under `http://127.0.0.1:4173/sites/my-app/`: `/`, `/favicon.ico`, `GET /settings`, `POST /settings` and `GET /mcp`. The canonical host exposes `/__thebird/registry`, `/__thebird/events` (SSE/HMR), `/__thebird/progress` and `/__thebird/mcp/<id>`. The normal `/` page includes a responsive Discord-like shell: collapsible desktop side bar and a fullscreen phone view. `window.THEBIRD_WEBSERVERS` is the browser SDK; `thebird/sdk/node` is the Node SDK. See `docs/WEBSERVER_STANDARD.md`.


## Lazy Craft apps

GridCraft, WordCraft and PDFCraft are lazy native Node CLI adapters registered as live webservers. Use `node bin/thebird-craft.js ensure`, `sample`, `status`, `intent`, `open`, `descriptor`, and `stop`; MCP endpoints are `/__thebird/mcp/<gridcraft|wordcraft|pdfcraft>`. Sheet/doc/PDF intent selects the app, native processes start only per task, and document cards appear live through `THEBIRD_FEATURES`/SSE. See `docs/CRAFT_APPS.md`.
