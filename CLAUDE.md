# thebird Development Notes

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
