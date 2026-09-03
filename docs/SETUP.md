# Setup, tools, and known limitations

This is the full reference the in-app quick-start panel is too short for:
how to actually get a working chat, every tool the agent can call and what
each one does, and the real limitations you will hit.

## 1. Setup

thebird is two independent pieces that happen to run on the same machine:

| Piece | What it is | Command | Port |
|---|---|---|---|
| The web OS | Static files, no build step | `bunx serve docs` (or `npx serve docs`, or `python -m http.server -d docs`) | `:3000` (serve's default) |
| The LLM gateway | Optional local daemon that lets the in-page agent actually reach a model | `bunx acptoapi@latest` | `:4800` |
| The playwriter bridge | Optional companion process letting gm's `browser`/`cdp` verbs drive a REAL separate Chrome tab instead of the same-origin iframe shim | `npm run playwriter-bridge` (needs `playwriter browser start` + `playwriter session new` running first) | `:4801` -> playwriter relay `:19988` |

Minimal path to a working chat:

1. `bunx acptoapi@latest` — binds `127.0.0.1:4800`, autolaunches ACP daemons,
   exposes an OpenAI-compatible `POST /v1/chat/completions`. Leave it running
   in its own terminal.
2. `bunx serve docs` — starts the static file server for the OS itself.
3. Open `http://localhost:3000/os.html` in a browser and open the **chat**
   or **assistant** app from the desktop/menubar.

You do **not** need step 1 to boot the OS — every other app (terminal,
files, notes, level editor, ...) works with zero backend. You only need
acptoapi (or a configured API key, see below) for the agent to produce real
LLM responses instead of the offline-friendly fallback message.

### Without acptoapi: bring your own key

Open the **freddie keys** app and paste a key for GROQ / CEREBRAS /
OPENROUTER / MISTRAL / OPENAI / ANTHROPIC. With a key configured, the chat's
"internal" in-page chain calls that provider directly from the browser — no
local daemon needed at all. This is the only path that works on a
zero-install deployment (e.g. the GitHub Pages live instance), since a
visitor there cannot run `bunx acptoapi` on your behalf.

### Routing mode (hybrid / internal / external)

The chat config strip above the composer (gear/config icons) sets
`acptoapi.mode`:

- **hybrid** (default) — try the external `:4800` daemon first, fall back to
  in-page provider keys if it's unreachable. Most resilient; use this unless
  you have a reason not to.
- **internal** — skip the daemon entirely, only use in-page keys.
- **external** — only POST to the configured `baseUrl`; never fall back to
  in-page keys. Use this to force reliance on acptoapi's queues/ACP daemons.

Full detail (queues, `auto` model routing, reachability probe) is in
`docs/acptoapi-integration.md`.

### Model

Leave the model as `auto`. thebird never pins a specific provider/model by
default — pinning one makes the chat fail outright the moment that provider
is rate-limited or misconfigured, instead of falling through acptoapi's
scored provider pool.

### Verifying it worked

- acptoapi up: `curl http://localhost:4800/v1/models` returns a model list.
- OS up: `http://localhost:3000/os.html` loads a desktop with a menubar.
- Chat working: send any message in the chat app; a real model reply (not
  the "All LLM providers are currently offline" message) confirms the
  chain reached a provider.

### Optional: real-Chrome browser automation via playwriter

thebird's `gm` tool exposes a `browser`/`cdp` verb pair that, on a normal
native gm host, drives a real CDP-speaking browser (lightpanda by default,
or a real Chrome). thebird's page runs entirely inside a browser tab's JS
sandbox and can neither spawn lightpanda nor launch Chrome itself — by
default those verbs instead drive a hidden same-origin `<iframe>` (see
`docs/lib/freddie-host-gm-bridge.js`'s `host_browser_exec`), which works
for same-origin pages but cannot reach cross-origin sites, real extensions,
your logged-in cookies, or anything a genuine separate Chrome session
provides.

[remorses/playwriter](https://github.com/remorses/playwriter) (a Chrome
extension + CLI that attaches to your ALREADY-RUNNING Chrome via
`chrome.debugger`, rather than spawning a new headless process) fills that
gap — but playwriter's own relay server deliberately answers CORS only to
`chrome-extension://` origins, so thebird's page can never `fetch()` it
directly. `scripts/playwriter-bridge.mjs` is the same-origin-reachable
companion process that closes that gap: a thin Node HTTP proxy thebird's
page CAN reach, which forwards server-to-server (no CORS involved between
two Node processes) to playwriter's relay.

To use it:

1. Install and start playwriter once: `npx playwriter@latest browser start`
   (launches Chrome for Testing with the bundled extension), then
   `npx playwriter@latest session new` to create a session.
2. `npm run playwriter-bridge` — starts the bridge on `127.0.0.1:4801`,
   proxying to playwriter's relay on `127.0.0.1:19988` by default (override
   with `--port`/`--relay-port`/`--relay-host`/`--relay-token`).
3. From thebird's page, dispatch the `gm` tool's `browser`/`cdp` verbs as
   usual — `host_browser_exec` probes `http://127.0.0.1:4801/health` (only
   when the page itself is on `localhost`/`127.0.0.1`, mirroring acptoapi's
   own loopback gating) and, when the bridge answers healthy, routes the
   call through a real playwriter-driven Chrome tab instead of the iframe
   shim. When the bridge is unreachable — not started, or the page is
   served from a non-loopback origin like GitHub Pages — every call falls
   back to the iframe shim exactly as it did before this bridge existed.

This is entirely optional. Nothing in thebird's own boot path depends on
the playwriter bridge; it only changes what `browser`/`cdp` verb calls can
reach once you choose to run it.

## 2. The full tool list (what the agent can actually do)

Every chat/assistant window in thebird runs the same agent loop against the
same fixed set of tools — this is not configurable per-app. Source:
`docs/lib/freddie-host-tools.js` (builtins) and `docs/lib/freddie-host-plugkit.js`
(the `gm` tool).

| Tool | What it does | Notes / gotchas |
|---|---|---|
| `read` | Read a file from the current instance's virtual filesystem. | Relative paths resolve under the configured working folder (`cfg.agent.cwd`, set in chat config); absolute paths (`/x`) bypass it. |
| `write` | Write a file to the instance filesystem. | Ending a reply with `FILE: <path>` + `RUN: <command>` lines makes the terminal actually execute what was written (e.g. `RUN: node reverse.test.js`). A `package.json` with a `dependencies` block is installed for real before `RUN:` executes. |
| `edit` | Replace `old_str` with `new_str` in an existing file. | Fails with `old_str not found` if the string isn't an exact match — no fuzzy matching. |
| `grep` | Regex search across every file in the instance fs. | Whole-fs scan, not indexed — slow on very large trees; prefer `gm codesearch` for big codebases. |
| `list` | List files under a path prefix. | Same cwd-relative resolution as `read`/`write`. |
| `memory` | Persistent key/value store (`get`/`set`/`list`), backed by a plugkit libsql DB scoped to the instance. | Distinct from `gm memorize`/`gm recall` — this is flat KV, not vector search. |
| `chat` | Calls the configured LLM through the never-reject failover chain: acptoapi (`:4800`) -> user-added OpenAI-compatible gateways -> freddie (`:3030`). | Always returns `{content}`, even on total failure (returns a friendly "all providers offline" message with a cached-last-good-response fallback when the browser is genuinely offline). This is also what powers `delegate`. |
| `delegate` | Hands a sub-task to the `chat` tool. | Recursion-guarded at depth 3 to prevent runaway self-delegation loops. |
| `web_search` | DuckDuckGo HTML-mode search. | CORS-dependent browser fetch — can fail silently in locked-down network environments; no API key required. |
| `gm` | The gm-skill engine: vector memory + code search + a small fs/env/browser/sql surface, backed by plugkit.wasm. | Call as `{"verb":"recall","query":"..."}` or the forgiving shape `{"recall":{"query":"..."}}`. Verbs: `recall` (vector memory search), `memorize {text}`, `codesearch {query}`, `codeinsight_index {root}`, `fs_read`/`fs_write`/`fs_stat`/`fs_readdir`/`fs_rm {path[,data]}`, `env_get {key}`, `fetch {url}`, `browser_spawn`/`browser_eval`/`browser_close`, `sql_open`/`sql_query`/`sql_exec`/`sql_close`. |

Two additional things sit next to (not inside) the tool set:

- **CLI surface** (`sessions`, `cron`) — reachable from the terminal's `cli`
  registry (`sessions` lists saved chat sessions; `cron create <expr> <prompt>`
  / `cron list` / `cron delete <id>` manage the in-browser cron scheduler),
  not exposed to the LLM as callable tools.
- **`gm` cold start** — the first `gm` call in a fresh page load pays for
  `plugkit.wasm` (~3.6MB) and, on first embed, `bert.wasm` (~136MB) to load.
  Expect the first `recall`/`memorize`/`codesearch` call to take noticeably
  longer than subsequent ones; a call issued during that window can return
  `wasm_aborted` — the fix is simply retrying, not treating it as a hard
  failure.

## 3. Known limitations

- **No automated test suite ships with this project.** There is no
  `validate.html`, no `test/`/`__tests__/` directory, no CI job that runs
  tests. Validation is exclusively manual: boot the real OS and drive it by
  hand, optionally using the `scripts/witness-*.mjs` puppeteer probes as
  debugging aids (see `docs/MANUAL-VALIDATION.md`). If you're looking for a
  green checkmark to trust, there isn't one — the only real signal is
  running the code path yourself.
- **No LLM access without either acptoapi running or a manually-entered API
  key.** thebird never fetches LLM providers directly on its own initiative
  — the `chat` tool's failover chain is acptoapi -> user-added gateways ->
  freddie; if none of those are reachable, every chat/agent call resolves to
  a friendly offline message, not a real answer. This is by design (never
  silently cross the "thebird doesn't own the LLM boundary" contract) but it
  means a completely fresh clone with nothing else running gives you a
  fully-functional desktop OS and a chat window that cannot say anything
  useful yet.
- **`web_search` depends on an unauthenticated public DuckDuckGo endpoint** —
  no API key, so no reliability guarantee; it can be rate-limited, blocked
  by network policy, or simply flaky, and there is no fallback search
  provider.
- **`gm`'s vector-embedding path needs the ~136MB `bert.wasm` to finish
  loading before it stops silently degrading to bm25-only search.** On a
  slow connection or first cold load, `recall`/`codesearch` calls issued too
  early will work but return keyword-only results, not vector-ranked ones.
- **No in-browser cron scheduler UI** beyond the CLI `cron` commands — cron
  jobs are created/listed/deleted via typed commands in the terminal, there
  is no dedicated app/window for managing them visually.
- **The level editor is scene/behavior authoring only, not a full game
  engine** — it covers placing objects, an ECS play-test runner, and a
  list-based (not node-graph) event-chain system. Anything beyond that
  scene/chain model needs a hand-written user app (see "Writing your own
  app" in `AGENTS.md`).
- **User-authored apps (`apps/*.js` in an instance's own fs) must be fully
  self-contained** — no relative or bare-specifier imports, because each
  module loads through a fresh `blob:` URL. Only absolute `https://` imports
  (e.g. from unpkg) work.
- **Per-instance isolation means state does not cross instances** by
  design — two thebird instances in the same browser tab never share
  filesystem, chat history, or config. This is a deliberate multi-tenancy
  boundary, not a bug, but it surprises people expecting a single shared
  "the OS."
- **Windows checkouts can see a byte-level line-ending mismatch against the
  committed vendor lock hash** even when `git status` reports clean, because
  `core.autocrlf=true` writes CRLF to disk while git's own diff normalizes
  it away. If a vendor-lock parity check ever looks wrong, compare
  `git show HEAD:<path>` against the on-disk bytes directly rather than
  trusting `git status`.

## See also

- `AGENTS.md` — architecture, layered-stack contract, GUI boundary rule, the
  full memo index.
- `docs/acptoapi-integration.md` — deep dive on the LLM gateway routing
  modes, queues, and the never-reject contract.
- `docs/MANUAL-VALIDATION.md` — how to run the witness probes and what each
  one asserts.
- `ARCHITECTURE.md` — system-level explanation of the OS design.
