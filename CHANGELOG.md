# Changelog

## [Unreleased]

### Added
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
