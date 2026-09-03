# acptoapi integration in thebird

How thebird's freddie chat surfaces reach an LLM, how that is configured, and the
contract between the **internal** in-page chain and the **external** `acptoapi`
daemon. This is the "deep understanding" reference for the acptoapi layer.

## The two surfaces

`acptoapi` (`c:/dev/acptoapi`, npm `acptoapi`) is a multi-provider gateway that
exposes an OpenAI-compatible `POST /v1/chat/completions`. thebird can use it two
ways:

1. **External daemon** — the user runs `bunx acptoapi@latest` locally. It binds
   `127.0.0.1:4800` (configurable via `PORT` / `ACPTOAPI_BIND`), autolaunches ACP
   daemons, and serves `auto` routing + seamless never-reject fallback. thebird
   POSTs chat completions to it. Cross-origin from `https://anentrypoint.github.io/thebird/`
   works because acptoapi v1+ ships `Access-Control-Allow-Origin:*` and
   `Access-Control-Allow-Private-Network:true`.

2. **Internal in-page chain** — thebird calls providers **directly from the
   browser** using keys configured in the Freddie Keys app (GROQ/CEREBRAS/
   OPENROUTER/MISTRAL/OPENAI/ANTHROPIC). No server needed; the page is the gateway.

## Choosing between them — the chat config surface

The OS chat panel's config strip (`docs/chat-config.js`, mounted by
`docs/freddie-chat.js`) writes an `acptoapi` block into the per-instance freddie
host config (`host.fs.getConfig().acptoapi`):

```jsonc
{
  "acptoapi": {
    "mode": "hybrid" | "internal" | "external",
    "baseUrl": "http://127.0.0.1:4800",
    "queue": "",                 // selected external named queue (queue/<name>)
    "internalQueue": []          // ordered ['provider/model', …] for the in-page chain
  }
}
```

- **hybrid** (default): try the external chain first (`baseUrl` + any
  `cfg.gatewayChain[]`), then fall through to the internal direct-provider keys.
  This is the resilient default — if the daemon is down, in-page keys still serve.
- **internal**: skip the external server entirely; only the in-page direct-key
  chain runs. The `internalQueue` order, if set, reorders which providers are tried.
- **external**: only POST to the configured `baseUrl`; never use in-page keys.
  Use this to genuinely rely on the external daemon (and its ACP daemons / queues).

This routing lives in `buildBrowserCallLLM()` in `docs/freddie-chat.js`:
`useExternal = mode !== 'internal'` gates the gateway chain; `mode === 'external'`
empties the in-page `compat` provider list and the anthropic fallback.

## Queues — external vs internal

acptoapi has **named queues** (ordered model chains) loaded from
`~/.acptoapi/queues.json` (`ACPTOAPI_QUEUES`), addressed as `model: "queue/<name>"`.

- **External queue**: the chat config queue selector lists `queue/<name>` ids
  discovered from the daemon's `GET /v1/models`. Selecting one sends
  `model: "queue/<name>"` so acptoapi routes the request through that server-side
  queue.
- **Internal queue**: the config's internal-queue editor takes a comma-separated
  ordered list of `provider/model` strings, persisted to `acptoapi.internalQueue`.
  `buildBrowserCallLLM` reorders the in-page `compat` provider list to follow it,
  so the browser walks the user-defined order. This lets you "rely on internal
  queues" without any external server.

## `auto` resolution & provider routing

When the model is `auto` (the thebird default — never pin a provider, see the
freddie-default-model-auto memo), acptoapi flattens all available providers into
one pool sorted by SWE-bench score and walks it with fallback. thebird sends
`model: 'auto'` unless the user picks a specific model or an external queue.

## Reachability & base url

The config strip's `.cc-acp-status` pill probes `GET <baseUrl>/v1/models` and
shows ● (reachable) / ○ (unreachable). `baseUrl` defaults to `127.0.0.1:4800`
but is fully editable, so a remote/alternate acptoapi host works.

## Never-reject contract

Both the external daemon (acptoapi v1.0.114 seamless-fallback: clean 200 on chain
exhaustion, never leaks a rate-limit) and the in-page chain
(`buildBrowserCallLLM`'s final friendly "No LLM backend reachable" message) are
designed never to throw a raw error into the chat UI. The agent loop always
completes a turn.

## Files

- `docs/chat-config.js` — config UI + `getAcptoapiConfig(fs)` helper.
- `docs/freddie-chat.js` — `buildBrowserCallLLM` (mode/baseUrl/queue/internalQueue
  routing) + `runAgentTurn`.
- `docs/lib/acptoapi-browser.js` — browser shim mirroring the acptoapi SDK subset
  (buildAutoChain/chat/getStatus/PROVIDER_KEYS) for code that imports `acptoapi`.
- `docs/freddie-host.js` — the `chat` tool's gateway chain + file tools that
  resolve relative paths under `cfg.agent.cwd`.

## Related memos

`acptoapi-daemon-autolaunch-published`, `freddie-default-model-auto`,
`freddie-loopback-fastfail`, `acptoapi-strong-chain-and-acp-daemons`,
`acptoapi-local`, `brand-css-drift-bypass` (theming).
