# thebird Development Notes

## Architecture Overview

**thebird** is an Anthropic SDK adapter that translates message format and tool calls to multiple LLM providers (Gemini, OpenAI-compatible APIs). It's a drop-in bridge — you write Anthropic-format code, thebird routes to any provider.

### Message Translation

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

### Tool Calling

Anthropic tool schema → provider native → normalized response back to Anthropic format.

Streaming events (all events are Anthropic-compatible):
- `text-delta`, `tool-use-start`, `tool-use-delta`, `message-start`, `message-stop`

### Routing (Multi-Provider)

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

## gembird — Image Generation via Browser

**gembird** generates 4-view product images (front, back, left-side, right-side) using Gemini's web UI.

### Why Browser Automation?

Gemini API free tier has 0 quota for image generation. Web UI works without limits. Tradeoff: slower than API, depends on UI stability, but no quota needed.

### Workflow

1. Playwright CDP connection to Chrome on `localhost:9222`
2. Navigate to gemini.google.com
3. For each view:
   - Type prompt asking for that view
   - Poll for new `<img alt="AI generated">` (120s timeout)
   - Extract via canvas: `canvas.drawImage(img) → canvas.toDataURL('image/png')`
   - POST base64 to local HTTP save server
4. Save 4 PNGs to output dir

### CLI

```bash
node index.js "prompt"
node index.js --image ref.png "prompt"
node index.js --output ./dir "prompt"
```

Arguments parsed in index.js lines 144-172.

### Observability

- Chrome console logs Gemini errors
- 120s timeout is conservative; real generation ~30-60s
- If extraction fails, check `img[alt*="AI generated"]` selector

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

## Files

- `lib/convert.js`: Message/tool translation logic
- `lib/client.js`: Provider client factory
- `lib/errors.js`: Error handling and retry logic
- `lib/providers/`: Provider-specific streaming implementations
- `index.js`: Main entry point, streaming and generation wrappers
- `index.d.ts`: TypeScript type definitions
- `examples/`: Working examples using Anthropic SDK format
