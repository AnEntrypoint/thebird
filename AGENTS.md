# thebird

A Node CLI and library whose every operation dispatches through gm tooling.

- Runtime surface: `bin/thebird.js`, `bin/thebird-relay.js`, `src/index.js`,
  `src/api.js`, `src/gm.js`, `src/gm-client.js`, `src/gm-remote.js`,
  `src/relay.js`, `src/commands.js`, `src/runner.js`, `src/cli.js`,
  `web/terminal.html`, `web/terminal.js`.
- Browser-safe: `src/api.js`, `src/commands.js`, `src/runner.js`,
  `src/gm-client.js`, `src/gm-remote.js`, `web/terminal.js`. They import
  nothing from Node and run in a browser. Node-only: `src/gm.js`,
  `src/relay.js`, `src/index.js`, `src/cli.js`, `bin/`.
- The browser terminal runs in a page served by the relay. Its gm calls go
  to the relay over same-origin HTTP (`GET /meta`, `POST /call`), so shell,
  git, jobs and filesystem run on the host. The relay binds 127.0.0.1 by
  default, runs commands as the user, and answers only JSON POSTs, which a
  cross-origin page cannot send without a CORS preflight the relay does not
  answer. Keep it that way.
- gm is the only execution engine. Do not reimplement filesystem, search,
  shell, git, job, log, wiki, row or fetch behavior locally.
- `createGmClient()` resolves `--gm-home` / `GM_HOME` / an installed `gm`
  package / `../gm` / `./gm`, then imports gm's `createTools()` verb engine.
- CLI commands and library methods must be thin mappings to gm verbs.
- Unknown gm verbs pass through unchanged, so new gm verbs need no thebird change.
- `job_start` maps to gm's `run_shell` with `background: true` because gm's in-process engine has no separate job-start verb.
- Validation is `npm run witness`, which runs the real CLI paths plus the
  Node-side runner and library checks. There is no test suite.
- Use Conventional Commits.
