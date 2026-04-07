# thebird

Anthropic SDK to multi-provider bridge. Drop-in adapter that translates Anthropic-style messages, tool calls, and content blocks to Google Gemini or any OpenAI-compatible API — with routing, transformers, streaming, vision, retry logic, and full TypeScript types.

## Install

```bash
npm install thebird
```

## Quick Start

**Gemini (direct)**

```js
const { generateGemini, streamGemini } = require('thebird');
// requires GEMINI_API_KEY env var

const { text } = await generateGemini({
  model: 'gemini-2.0-flash',
  messages: [{ role: 'user', content: 'Hello!' }]
});
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

### Params

| Param | Type | Default | Description |
|---|---|---|---|
| `model` | `string \| { id }` | `'gemini-2.0-flash'` | Model id |
| `messages` | `Message[]` | required | Conversation history |
| `system` | `string` | — | System instruction |
| `tools` | `Tools` | — | Tool definitions |
| `apiKey` | `string` | `GEMINI_API_KEY` | Override API key |
| `temperature` | `number` | `0.5` | Sampling temperature |
| `maxOutputTokens` | `number` | `8192` | Max tokens |
| `topP` | `number` | `0.95` | Top-p |
| `topK` | `number` | — | Top-k |
| `safetySettings` | `SafetySetting[]` | — | Safety thresholds |

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

## TypeScript

```ts
import { createRouter, streamRouter, generateGemini, RouterConfiguration, ProviderConfig, RouterConfig } from 'thebird';
```

## Utilities

```js
const { convertMessages, convertTools, cleanSchema } = require('thebird');
```

## License

MIT
