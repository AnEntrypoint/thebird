# Design

thebird is a bash terminal that runs in the browser. The page does the work, and Node only serves the files.

## Decisions

- Browser-only execution. Commands run in a Web Worker (`web/shell-worker.js`) over the OPFS tree. No host process runs commands.
- bashkit is the shell (`web/bash-shell.js`), a WebAssembly bash that gives bash semantics without a host.
- In-page builtins cover what bashkit lacks: git over isomorphic-git, sqlite3 over txiki.js's tjs:sqlite, python3 and pip over Pyodide, curl and wget over txiki.js fetch.
- The page has no call path to the host. The static server answers GET and HEAD only and binds 127.0.0.1 by default.
- txiki.js runs in the browser, and it is the primary goal of thebird. An earlier evaluation rejected it as a native runtime with no browser build; the owner reversed that on 2026-11-08: "txiki.js must be built to run in the browser, with no exceptions. It is the primary purpose of thebird; everything else exists to get txiki.js complete." The browser build is gated by `scripts/vendor-txiki.mjs`, and txiki.js counts as running in the page only once that gate links the wasm with zero undefined symbols. Node stays only as the static server.
- No external execution engine. The earlier CLI, library, REPL, verb passthrough and relay POST endpoints are gone, so the page runs every command itself.
- No library API and no CLI. The package exports nothing; the product is the page.
- Browser code uses the modules in `web/shims/` in place of `node:` imports.
- Third-party bundles are committed unmodified. Generated runtimes (bashkit, fx, gm) are built from their upstream sources and pinned by SHA-256 in a manifest.
- gm is gm's stdio MCP server in the page, not a reimplementation. floosie's browser bundle carries its `rpc` chunks and routes each line to an app on the hub; gm attaches as the default endpoint, so many apps can join the same hub. Its three served tools and gm's served skills are the real ones. A wasm core built from gm's portable C++ supplies JSON normalization and SHA-256; the tool verbs and append-only run log run in browser JavaScript over the OPFS shim. `gm stdio` takes one single-quoted JSON-RPC line and answers one line, the page's own stdio instead of a host pipe.

## Layers

1. Page: `web/terminal.html`, `web/terminal.js`, `web/pty-adapter.js`, `web/shell-client.js`. xterm.js draws the screen and handles escape sequences; the adapter keeps the input line, history, Tab and the run queue, and passes keys and paste in and output bytes out.
2. Worker: `web/shell-worker.js`. Hydrates OPFS, creates `/workspace`, answers run, complete, cwd and cancel messages, and flushes OPFS after each message.
3. Shell: `web/bash-shell.js` over bashkit, with the lookup prologue from `web/shell-lookup.js`.
4. Builtins: `web/git-in-page.js`, `web/sqlite-in-txiki.js`, `web/python-in-page.js`, `web/curl-in-page.js`, `web/fx-in-page.js`, `web/gm-in-page.js`, and the commit gate `web/commit-gate.js`.
5. Storage and shims: `web/shims/`, with the OPFS-backed filesystem in `web/shims/fs.js`.
6. Static server: `src/relay.js`, started by `bin/thebird-relay.js`.

Details, limits and measurements are in `ARCHITECTURE.md`.

## Rules

- Browser code imports nothing from Node.
- Repo-owned code has no comments.
- A `node:` import in in-page code needs a shim in `web/shims/` first.
