---
key: mem-cd9fc6e25ced7a7d-485
ns: default
created: 1787224066101
updated: 1787224066101
---

## Resolved mutable: playwriter-relay-port

relay-client.ts: RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988. cdp-relay.ts hono app registers POST /cli/execute and POST /cli/session/new gated by privilegedRouteMiddleware (Bearer token or ?token= query), CORS origin callback whitelists ONLY chrome-extension://<EXTENSION_IDS> origins -- confirmed a normal http:// page origin is rejected by this relay's own CORS policy, necessitating a companion same-origin bridge process.
