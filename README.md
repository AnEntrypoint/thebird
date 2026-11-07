# thebird

A Node CLI and library that does the work the old thebird terminal used to do,
with one important change: **gm is the execution engine for everything**.

The gm-backed CLI and library live in `bin/` and `src/`. The legacy browser web
OS tree was deleted in owner-approved commit `cc242f5`. The active surface is:

- `bin/thebird.js` — the CLI entry point
- `src/index.js` — the library API (`createThebird` / `createClient`)
- `src/api.js` — the library method table over a gm client (no Node imports)
- `src/gm.js` — locates gm and creates the Node tool engine (Node only)
- `src/gm-client.js` — the gm client adapter over any tool engine (no Node imports)
- `src/gm-remote.js` — a gm client that calls a relay over HTTP (no Node imports)
- `src/relay.js` — the local relay: hosts gm, serves the browser terminal
- `web/terminal.html`, `web/terminal.js` — the browser terminal page
- `src/commands.js` — the CLI command registry
- `src/runner.js` — tokenizes a command line and maps it to library calls (no Node imports)
- `src/cli.js` — the REPL and one-shot runner

No operation is implemented twice. `createGmClient()` imports gm's own
`createTools()` verb engine; library methods, CLI commands, filesystem access,
search, shell execution, git, jobs, logs, PRDs and fetches all dispatch to gm.

## Requirements

- Node >= 22
- A gm checkout. Resolution order: `--gm-home` / `GM_HOME`, an installed
  `gm` package, `../gm`, then `./gm`. A gm checkout must contain
  `src/tools.mjs` and `src/log.mjs`.

## CLI

```bash
node bin/thebird.js help
node bin/thebird.js --gm-home /path/to/gm ls .
node bin/thebird.js --workspace /path/to/project read package.json 0 20
node bin/thebird.js grep "createGmClient" src
node bin/thebird.js search "dispatch through gm"
node bin/thebird.js shell "node --version"
node bin/thebird.js memory write house-rule "Keep the bird quiet near the lake"
node bin/thebird.js memory search house-rule
node bin/thebird.js gm list_dir '{"path":".","limit":10}'
node bin/thebird.js -i
```

Without arguments on a TTY the CLI opens its REPL. `help` lists every command.
`gm <verb> <json>` is the escape hatch for any current or future gm verb.

## Browser terminal

Serve the repo with the relay, then open the printed URL:

```bash
node bin/thebird-relay.js --workspace /path/to/project
```

By default the page runs gm in a Web Worker, over files kept in the browser's
OPFS storage, so no host process is needed for file, memory, search and PRD
commands. The shell runs in-page, and so do `git init`, `add`, `status`, `log` and
`diff`, and `commit` runs an in-page gate for syntax, ASCII and docs paths. Git
remotes, branches, checkout and job commands need the relay, which runs gm's full
commit gate. Add
`?engine=relay` to send gm calls to the relay on this machine, which runs them
as your user. The relay binds 127.0.0.1, so do not expose its port. See
`ARCHITECTURE.md` for the browser gaps.

## Library

```js
import { createThebird } from 'thebird';

const tb = await createThebird({ gmHome: '/path/to/gm', workspace: process.cwd() });
const files = await tb.list({ path: '.', limit: 20 });
const body = await tb.read({ path: 'package.json' });
await tb.gm('search', { query: 'dispatch through gm', k: 5 });
await tb.close();
```

Every method returns gm's own verb result. Errors from gm become exceptions.

## Old CLI surface

The old terminal's callable tool names — `read`, `write`, `edit`, `grep`,
`list`, `memory`, `chat`, `delegate`, `web_search`, `gm`, `sessions`,
`cron`, `tools`, `skills`, `config`, `batch`, `projects`, `run` and `exec`
— remain reachable. They are compatibility names over gm verbs, not a second
runtime. Old browser-only behavior (LLM gateways, cron timers, virtual
filesystem instances, GUI apps) is intentionally not carried over; use gm
tooling directly for real filesystem, shell, git, job and knowledge operations.

## Validation

Run the witness, which exercises the real CLI paths and the Node-side runner and
library checks:

```bash
npm run check
npm run witness
```
