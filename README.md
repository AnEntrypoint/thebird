# thebird

A bash terminal that runs in the browser. Commands run in bashkit, a WebAssembly bash, inside a Web Worker, over files kept in the browser's OPFS storage. In-page builtins provide `git`, `sqlite3`, `python3`, `pip`, `curl` and `wget`. The only Node code is a static server that serves the page.

The earlier gm-backed CLI and library were removed.

Live: https://anentrypoint.github.io/thebird/ (GitHub Pages, deployed from `main` by `.github/workflows/pages.yml`).

## Requirements

- Node >= 22, for the static server.
- Chromium, for the witness. Set `CHROME_BIN`; the default is `/usr/bin/chromium-browser`.

After a fresh clone, generate the vendored runtimes (both need network):

```bash
node scripts/vendor-bashkit.mjs
node scripts/vendor-pyodide.mjs
```

## Run

```bash
npm start
node bin/thebird-relay.js --port 8080 --host 127.0.0.1
```

Open the URL the server prints. `--port` defaults to an OS-assigned port and `--host` to `127.0.0.1`. The server answers GET and HEAD only.

## Query parameters

- `?run=<command>` runs each `run` value in order when the page loads. The body gets `data-done="true"` when they finish. Repeat the parameter for more commands.

## What works

- Bash syntax and common commands from bashkit: pipelines, variables, loops, functions, redirects, sed, awk, grep, find, jq, sha256sum and others.
- `git init`, `status`, `log`, `diff`, `add`, `commit -m`, and local `branch` and `checkout`. `commit` runs the in-page gate.
- `sqlite3 <database> <sql>`, with the database kept as a file in OPFS. It runs through txiki.js's `tjs:sqlite` module.
- `python3 -c <code>` and `python3 <file>`, run by Pyodide.
- `pip install <package>...` for pure-Python packages from PyPI.
- `curl` and `wget`, for hosts that send CORS headers to the page.
- `which`, `type` and `command -v` give the same answer for each name.

## Limits

- No background jobs. A bare `&` is refused.
- No `node` and no host binaries; they exit 127.
- No git remotes. `push`, `fetch` and `pull` are refused.
- pip takes plain names only. Version specifiers, URLs and packages in the Pyodide set are refused. Installed packages last for the page session.
- Each command line has a 300 s limit. See `ARCHITECTURE.md`.

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
npm run lint:comments
npm run lint:architecture
npm run witness
```

`npm run witness` drives headless Chromium through `scripts/browser-driver.mjs` and checks the in-page shell end to end.
