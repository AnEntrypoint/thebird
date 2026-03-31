# thebird

Anthropic SDK to Google Gemini bridge. Drop-in adapter that translates Anthropic-style messages, tool calls, and content blocks to the Gemini API — with streaming, non-streaming, vision, retry logic, and full TypeScript types.

## Install

```bash
npm install thebird
```

Requires `GEMINI_API_KEY` environment variable, or pass `apiKey` directly.

## Quick Start

```js
const { generateGemini, streamGemini } = require('thebird');

// Non-streaming
const { text } = await generateGemini({
  model: 'gemini-2.0-flash',
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(text);

// Streaming
const { fullStream } = streamGemini({
  model: 'gemini-2.0-flash',
  messages: [{ role: 'user', content: 'Tell me a story.' }]
});
for await (const event of fullStream) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
}
```

## API

### `generateGemini(params)` → `Promise<{ text, parts, response }>`

Non-streaming generation. Automatically handles multi-step tool call loops until a final text response is returned.

### `streamGemini(params)` → `{ fullStream, warnings }`

Returns an async iterable of events. Handles agentic tool loops — yields events for each step until the model produces a non-tool response.

### Shared params

| Param | Type | Default | Description |
|---|---|---|---|
| `model` | `string \| { id }` | `'gemini-2.0-flash'` | Model name or object with `id`/`modelId` |
| `messages` | `Message[]` | required | Conversation history |
| `system` | `string` | — | System instruction |
| `tools` | `Tools` | — | Tool definitions with optional `execute` |
| `apiKey` | `string` | `GEMINI_API_KEY` env | Override API key |
| `temperature` | `number` | `0.5` | Sampling temperature |
| `maxOutputTokens` | `number` | `8192` | Max output tokens |
| `topP` | `number` | `0.95` | Top-p sampling |
| `topK` | `number` | — | Top-k sampling |
| `safetySettings` | `SafetySetting[]` | — | Gemini safety thresholds |

`streamGemini` also accepts:

| Param | Type | Description |
|---|---|---|
| `onStepFinish` | `() => Promise<void>` | Called after each reasoning step |

## Message Format

Messages follow the Anthropic SDK format:

```js
// Simple text
{ role: 'user', content: 'Hello' }

// Content blocks
{ role: 'user', content: [
  { type: 'text', text: 'What is in this image?' },
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '...' } }
]}

// Tool result (from assistant loop)
{ role: 'user', content: [
  { type: 'tool_result', name: 'my_tool', content: '{"result": 42}' }
]}
```

## Vision / Images

Four image formats are supported:

```js
// 1. Anthropic SDK style — base64
{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '<base64>' } }

// 2. Anthropic SDK style — URL
{ type: 'image', source: { type: 'url', url: 'https://...' } }

// 3. Gemini native — inline base64
{ inlineData: { mimeType: 'image/jpeg', data: '<base64>' } }

// 4. Gemini native — file URI
{ fileData: { mimeType: 'image/jpeg', fileUri: 'gs://...' } }
```

Example:

```js
const result = await generateGemini({
  model: 'gemini-2.0-flash',
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
      { type: 'text', text: 'Describe this image.' }
    ]
  }]
});
```

## Tool Calling

Define tools as an object keyed by name. The `execute` function is called automatically during agentic loops.

```js
const tools = {
  get_weather: {
    description: 'Get the weather for a city.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' }
      },
      required: ['city']
    },
    execute: async ({ city }) => ({ temperature: 22, condition: 'Sunny' })
  }
};

const { text } = await generateGemini({
  model: 'gemini-2.0-flash',
  messages: [{ role: 'user', content: "What's the weather in Paris?" }],
  tools
});
```

Tool schemas are automatically cleaned — `additionalProperties` and `$schema` are stripped for Gemini compatibility.

## Streaming Events

`fullStream` yields a sequence of typed events:

| Event type | Fields | Description |
|---|---|---|
| `start-step` | — | Beginning of a reasoning step |
| `text-delta` | `textDelta: string` | Streamed text chunk |
| `tool-call` | `toolCallId, toolName, args` | Model called a tool |
| `tool-result` | `toolCallId, toolName, args, result` | Tool execution result |
| `finish-step` | `finishReason: 'stop' \| 'tool-calls' \| 'error'` | Step completed |
| `error` | `error: Error` | Error during step |

```js
const { fullStream } = streamGemini({ model: 'gemini-2.0-flash', messages, tools });

for await (const event of fullStream) {
  switch (event.type) {
    case 'text-delta': process.stdout.write(event.textDelta); break;
    case 'tool-call': console.log('Calling tool:', event.toolName, event.args); break;
    case 'tool-result': console.log('Result:', event.result); break;
    case 'finish-step': console.log('Done, reason:', event.finishReason); break;
    case 'error': console.error('Error:', event.error); break;
  }
}
```

## Safety Settings

```js
const { text } = await generateGemini({
  model: 'gemini-2.0-flash',
  messages: [...],
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }
  ]
});
```

## Retry Logic

All API calls automatically retry on 5xx errors and 429 rate limits with exponential backoff (max 3 retries, delays up to ~16 seconds).

```js
const { GeminiError } = require('thebird');

try {
  const result = await generateGemini({ ... });
} catch (err) {
  if (err instanceof GeminiError) {
    console.log('Status:', err.status);
    console.log('Retryable:', err.retryable);
  }
}
```

## Error Handling

```js
const { GeminiError } = require('thebird');

// GeminiError properties:
// err.message  — human-readable message
// err.status   — HTTP status code (e.g. 429, 500)
// err.code     — error code string if available
// err.retryable — whether automatic retry was attempted
```

## TypeScript

Full types are bundled — no `@types/` package needed.

```ts
import { generateGemini, streamGemini, GeminiError, Message, Tools, StreamEvent } from 'thebird';

const messages: Message[] = [{ role: 'user', content: 'Hello' }];
const { text } = await generateGemini({ messages });
```

## Utilities

```js
const { convertMessages, convertTools, cleanSchema } = require('thebird');

// Convert Anthropic messages to Gemini contents format
const contents = convertMessages(messages);

// Convert tools map to Gemini function declarations array
const declarations = convertTools(tools);

// Strip additionalProperties/$schema from a JSON schema
const cleaned = cleanSchema(rawSchema);
```

## Examples

See the [`examples/`](./examples/) directory:

- [`basic-chat.js`](./examples/basic-chat.js) — Simple text generation with system prompt
- [`tool-use.js`](./examples/tool-use.js) — Tool/function calling (streaming and non-streaming)
- [`vision.js`](./examples/vision.js) — Image understanding with all three image formats
- [`streaming.js`](./examples/streaming.js) — All streaming event types with stats
- [`multi-turn.js`](./examples/multi-turn.js) — Multi-turn chat history pattern

## License

MIT
