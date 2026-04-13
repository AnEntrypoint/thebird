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
