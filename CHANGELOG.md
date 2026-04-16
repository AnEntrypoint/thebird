## [Unreleased]

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
