# thebird

A Node CLI and library whose every operation dispatches through gm tooling.

- Runtime surface: `bin/thebird.js`, `src/index.js`, `src/api.js`,
  `src/gm.js`, `src/commands.js`, `src/runner.js`, `src/cli.js`.
- `src/api.js`, `src/commands.js` and `src/runner.js` import nothing from
  Node and run in a browser given a gm client. Keep them free of `node:`
  imports and `process`; only `src/gm.js`, `src/index.js`, `src/cli.js` and
  `bin/` may use Node.
- gm is the only execution engine. Do not reimplement filesystem, search,
  shell, git, job, log, wiki, row or fetch behavior locally.
- `createGmClient()` resolves `--gm-home` / `GM_HOME` / an installed `gm`
  package / `../gm` / `./gm`, then imports gm's `createTools()` verb engine.
- CLI commands and library methods must be thin mappings to gm verbs.
- Unknown gm verbs pass through unchanged, so new gm verbs need no thebird change.
- `job_start` maps to gm's `run_shell` with `background: true` because gm's in-process engine has no separate job-start verb.
- Validation is running the real CLI paths; there is no test suite.
- Use Conventional Commits.
