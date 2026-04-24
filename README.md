# thebird

Web OS — browser-native terminal, agentic chat, and file system powered by WebContainer and IndexedDB. Anthropic-format message routing is handled by [acptoapi](https://github.com/AnEntrypoint/acptoapi).

## Live Demo

**[anentrypoint.github.io/thebird](https://anentrypoint.github.io/thebird/)**

- **Chat tab** — Agentic chat via `acptoapi` running in-browser (`docs/vendor/thebird-browser.js`). Tools: `read_file`, `write_file`, `list_files` (IDB-backed), `run_command`, `read_terminal`, `send_to_terminal`. No proxy server required. API key stored in localStorage.
- **Terminal tab** — Browser-native POSIX shell (xstate v5 state machine, V8 eval) backed by IndexedDB filesystem. Built-in: `ls`, `cat`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `echo`, `env`, `export`, `node`, `npm install`. Node REPL with persistent scope, `require()` from IDB node_modules, `http.createServer` polyfill.
- **Preview tab** — iframe served by a service worker reading files from IDB at `/preview/*`. Hot-reloads 5s after any file write.

All JS and CSS dependencies are vendored locally in `docs/vendor/` — no CDN required at runtime.

## Architecture

```
thebird (web OS shell)
  └── acptoapi (npm)        ← Anthropic format → Gemini / OpenAI-compat bridge
        └── @google/genai   ← Gemini native streaming
```

thebird is the web OS. `acptoapi` owns all Anthropic↔provider translation, streaming, routing, transformers, and TypeScript types. `server.js` exposes a local Anthropic-compatible proxy backed by acptoapi.

## Local Dev

```bash
npm install
node serve.js      # serves docs/ at http://localhost:8080
node server.js     # Anthropic-compat proxy at http://localhost:3456 (needs GEMINI_API_KEY)
```

## acptoapi

For the Anthropic-to-provider bridge (streaming, routing, tool calls, vision, retry logic, TypeScript types), see [acptoapi](https://github.com/AnEntrypoint/acptoapi).

```bash
npm install acptoapi
```

## License

MIT
