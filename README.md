# thebird

Anthropic SDK → Gemini streaming bridge. Drop-in proxy that translates Anthropic-format messages and tool calls to Google Gemini's API.

## Install

```bash
npm install thebird
```

## Usage

```js
const { streamGemini } = require('thebird');

const tools = {
  get_weather: {
    description: 'Get weather for a location',
    parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
    execute: async (args) => ({ temp: '72F', location: args.location })
  }
};

const result = streamGemini({
  model: 'gemini-2.0-flash',
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  tools
});

for await (const chunk of result.fullStream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.textDelta);
  if (chunk.type === 'tool-call') console.log('Tool:', chunk.toolName, chunk.args);
  if (chunk.type === 'tool-result') console.log('Result:', chunk.result);
}
```

## API

### `streamGemini({ model, system, messages, tools, onStepFinish, apiKey })`

- **model** — Gemini model ID string (default: `gemini-2.0-flash`)
- **system** — System instruction string
- **messages** — Anthropic-format messages (`[{ role, content }]`)
- **tools** — Object of tool definitions with `execute` functions
- **onStepFinish** — Optional async callback after each step
- **apiKey** — Optional Gemini API key (default: `GEMINI_API_KEY` env var)

Returns `{ fullStream, warnings }` where `fullStream` is an async generator yielding:

| Event | Fields |
|-------|--------|
| `start-step` | — |
| `text-delta` | `textDelta` |
| `tool-call` | `toolCallId`, `toolName`, `args` |
| `tool-result` | `toolCallId`, `toolName`, `args`, `result` |
| `finish-step` | `finishReason`: `stop` \| `tool-calls` \| `error` |
| `error` | `error` |

## Message Format

Accepts Anthropic message format:

```js
// String content
{ role: 'user', content: 'Hello' }

// Array content with tool use/results
{ role: 'assistant', content: [
  { type: 'text', text: 'Let me check...' },
  { type: 'tool_use', name: 'get_weather', input: { location: 'Paris' } }
]}
```

## License

MIT
