# thebird

A Node CLI and library that does the work the old thebird terminal used to do,
with one important change: **gm is the execution engine for everything**.

The gm-backed CLI and library live in `bin/` and `src/`. The legacy browser web
OS files — vendored kits, apps, service workers, landing site, refresh scripts
and witness probes — remain in the tree pending an owner-held deletion
decision. The active surface is:

- `bin/thebird.js` — the CLI entry point
- `src/index.js` — the library API (`createThebird` / `createClient`)
- `src/gm.js` — the gm tool-engine adapter
- `src/commands.js` — the CLI command registry
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
node bin/thebird.js gm list_dir '{"path":".","limit":10}'
node bin/thebird.js -i
```

Without arguments on a TTY the CLI opens its REPL. `help` lists every command.
`gm <verb> <json>` is the escape hatch for any current or future gm verb.

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

This project keeps no test suite. Verify the real paths by running the CLI:

```bash
npm run check
node bin/thebird.js help
node bin/thebird.js ls .
node bin/thebird.js gm list_dir '{"path":".","limit":5}'
```
