# Changelog

## [Unreleased]

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
