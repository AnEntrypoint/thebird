# Design

thebird is a thin mapping layer over gm. Every operation dispatches through
gm's verb engine. thebird adds no filesystem, shell, git, search, job, log,
wiki, row or fetch behaviour of its own.

## Layers

- `src/commands.js` and `src/runner.js` hold the command names and the argument
  parser. Both are browser-safe.
- `src/api.js` holds the library methods as a table of gm verb mappings. It is
  browser-safe.
- `src/gm.js` is the Node-only locator for gm and its `createTools()` engine.
- `src/gm-client.js` is the client that Node, the relay and the browser worker
  share. It maps `job_start` to `run_shell` in the background.
- `src/relay.js` is a Node HTTP server on 127.0.0.1. It serves the browser
  terminal and forwards JSON calls to gm.

## Browser

- The default page runs gm in `web/gm-worker.js` over the OPFS tree. The
  `web/shims/` modules replace the `node:` modules that gm imports.
- The in-page shell is bashkit, in `web/bash-shell.js`. It has a `git` builtin
  backed by isomorphic-git, in `web/git-in-page.js`.
- `web/commit-gate.js` is the in-page commit gate. It is not gm's gate. It
  checks syntax, ASCII, the required docs and a scratch round trip, and it
  reports the gm checks it does not run.
- Measurements and known gaps are in `ARCHITECTURE.md`.

## Rules

- Mappings stay thin, so a new gm verb needs no thebird change.
- Browser-facing code imports nothing from Node.
- The relay answers only JSON POSTs from 127.0.0.1, and it runs commands as the
  user who started it.
