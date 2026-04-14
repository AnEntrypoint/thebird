# thebird

Anthropic SDK to multi-provider bridge. Drop-in adapter that translates Anthropic-style messages, tool calls, and content blocks to Google Gemini or any OpenAI-compatible API — with routing, transformers, streaming, vision, retry logic, and full TypeScript types.

## How It Works

thebird accepts **Anthropic SDK message format** — the same `{ role, content }` structure you use with `@anthropic-ai/sdk` — and translates it to Gemini or any OpenAI-compatible API. No proxy server needed. You write Anthropic-format messages, thebird streams them through Gemini.

```
Anthropic SDK format  →  thebird  →  Gemini / OpenAI-compatible API
     (messages)         (bridge)         (native streaming)
```

This means you can use `@anthropic-ai/sdk` to build your messages and tool definitions, then pass them directly to thebird for execution against Gemini models.

## Install

```bash
npm install thebird @anthropic-ai/sdk
```

## Quick Start

**Anthropic SDK format → Gemini (streaming)**

```js
const Anthropic = require('@anthropic-ai/sdk');
const { streamGemini } = require('thebird');

// Build messages using Anthropic SDK format — same structure as client.messages.create()
const messages = [
  { role: 'user', content: 'Count from 1 to 5.' }
];

// Stream through Gemini — no server, no proxy
const { fullStream } = streamGemini({
  model: 'gemini-3-flash-preview',
  system: 'You are a helpful assistant.',
  messages
});

for await (const event of fullStream) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
}
```

**Anthropic SDK format → Gemini (non-streaming)**

```js
const { generateGemini } = require('thebird');

const { text } = await generateGemini({
  model: 'gemini-3-flash-preview',
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(text);
```

**Multi-provider router**

```js
const { createRouter } = require('thebird');

const router = createRouter({
  Providers: [
    { name: 'deepseek', api_base_url: 'https://api.deepseek.com/chat/completions', api_key: process.env.DEEPSEEK_API_KEY, models: ['deepseek-chat', 'deepseek-reasoner'], transformer: { use: ['deepseek'] } },
    { name: 'gemini',   api_base_url: 'https://generativelanguage.googleapis.com/v1beta/models/', api_key: process.env.GEMINI_API_KEY, models: ['gemini-2.5-pro'] },
    { name: 'ollama',   api_base_url: 'http://localhost:11434/v1/chat/completions', api_key: 'ollama', models: ['qwen2.5-coder:latest'] },
  ],
  Router: {
    default: 'deepseek,deepseek-chat',
    background: 'ollama,qwen2.5-coder:latest',
    think: 'deepseek,deepseek-reasoner',
    longContext: 'gemini,gemini-2.5-pro',
    longContextThreshold: 60000,
  }
});

// Stream — routes automatically based on taskType and token count
const { fullStream } = router.stream({ messages, taskType: 'think' });
for await (const event of fullStream) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
}

// Generate
const { text } = await router.generate({ messages });
```

**File-based config** — place config at `~/.thebird/config.json` (or set `THEBIRD_CONFIG` env) and use the auto-loading shorthand:

```js
const { streamRouter, generateRouter } = require('thebird');
const { fullStream } = streamRouter({ messages, taskType: 'background' });
```

## Routing

`createRouter` / `streamRouter` pick a provider+model per request:

| Route key | Trigger |
|---|---|
| `default` | Any request not matched by another rule |
| `background` | `taskType: 'background'` |
| `think` | `taskType: 'think'` |
| `webSearch` | `taskType: 'webSearch'` |
| `image` | `taskType: 'image'` |
| `longContext` | Estimated token count > `longContextThreshold` (default 60 000) |
| subagent tag | First user message starts with `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` |
| custom function | `customRouter: async (params, cfg) => 'provider,model'` in config |

Route values are `"providerName,modelName"` strings matching a `Providers` entry.

## Transformers

Apply per-provider request/response transformations. Set on the provider's `transformer.use` array.

```json
{
  "name": "deepseek",
  "transformer": {
    "use": ["deepseek"],
    "deepseek-chat": { "use": [["maxtoken", { "max_tokens": 8192 }], "tooluse"] }
  }
}
```

Built-in transformers:

| Name | Effect |
|---|---|
| `deepseek` | Strips `cache_control`, normalises system to string |
| `openrouter` | Adds `HTTP-Referer` / `X-Title` headers; optional `provider` routing |
| `maxtoken` | Sets `max_tokens` to the given value |
| `tooluse` | Adds `tool_choice: {type:"required"}` when tools are present |
| `cleancache` | Strips all `cache_control` fields recursively |
| `reasoning` | Moves `reasoning_content` to `_reasoning` in response |
| `sampling` | Removes `top_k` / `repetition_penalty` |
| `groq` | Removes `top_k` |

Pass options as a nested array: `["maxtoken", { "max_tokens": 16384 }]`.

## Config File

`~/.thebird/config.json` (or `THEBIRD_CONFIG` env var) — same schema as the inline config object. Supports `$VAR` / `${VAR}` environment variable interpolation anywhere in the file.

```json
{
  "Providers": [
    { "name": "openrouter", "api_base_url": "https://openrouter.ai/api/v1/chat/completions", "api_key": "$OPENROUTER_API_KEY", "models": ["google/gemini-2.5-pro-preview"], "transformer": { "use": ["openrouter"] } }
  ],
  "Router": { "default": "openrouter,google/gemini-2.5-pro-preview" }
}
```

## Gemini Direct API

`streamGemini` / `generateGemini` bypass routing and call Gemini natively via `@google/genai`. Requires `GEMINI_API_KEY`.

## Message Format

Messages follow the Anthropic SDK format. All image block variants are supported:

```js
{ role: 'user', content: [
  { type: 'text', text: 'Describe this image.' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
]}
```

## Streaming Events

| Event | Fields | Description |
|---|---|---|
| `start-step` | — | Beginning of a reasoning step |
| `text-delta` | `textDelta` | Streamed text chunk |
| `tool-call` | `toolCallId, toolName, args` | Model invoked a tool |
| `tool-result` | `toolCallId, toolName, args, result` | Tool execution result |
| `finish-step` | `finishReason` | Step completed |
| `error` | `error` | Error during step |

## Browser Demo

Live at **[anentrypoint.github.io/thebird](https://anentrypoint.github.io/thebird/)**

- **Chat tab** — Agentic chat powered by thebird `streamGemini` running in-browser (bundled in `docs/vendor/thebird-browser.js`). Tools: `read_file`, `write_file`, `list_files` (IDB-backed), `run_command`, `read_terminal`, `send_to_terminal`. No proxy server required. Gemini API key stored in localStorage.
- **Terminal tab** — Browser-native POSIX shell (xstate v5 state machine, V8 eval) backed by IndexedDB filesystem. Built-in commands: `ls`, `cat`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `echo`, `env`, `export`, `node`, `npm install`. Node REPL mode with persistent scope, `require()` from IDB node_modules, `http.createServer` polyfill. No WebContainer or server required.
- **Preview tab** — iframe served by a service worker reading files from IDB at `/preview/*`. Hot-reloads 5s after any file write.

All JS and CSS dependencies are vendored locally in `docs/vendor/` — no CDN required at runtime.

## License

MIT
