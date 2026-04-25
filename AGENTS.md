## thebird Virtual Filesystem Architecture

### defaults.json as idbSnapshot Seed

`defaults.json` is a 46KB single-line JSON blob that seeds `window.__debug.idbSnapshot` — the virtual filesystem visible inside thebird's web-based shell. This is NOT the source for running JavaScript modules. Actual modules (app.js, terminal.js, shell.js, vendor bundles, etc.) load from `docs/*.js` over HTTP via the web server.

The virtual FS uses a flat mount object: `{'lib/client.js': {...}, 'sys/node-builtins.js': {...}}` directly, no nested directory tree. WebContainer mounts this structure at shell startup.

### System vs User Namespace

- **System internals** (85+ files): app.js, terminal.js, shell.js, lib/*, vendor/*, node-builtins.js, builtins, etc. → prefix with `sys/`
- **User-facing project**: README.md, index.html, style.css, package.json → prefix with `home/`
- **Shell context**: `ctx.cwd` defaults to `/home` (set in shell.js:27)

This convention separates implementation from user project namespace. When adding new system features visible in the virtual FS, use `sys/` prefix. Starter content for users goes under `home/`.

### Agent Tool Filtering & Preview Behavior

- **agent-chat.js `list_files` tool**: defaults to `prefix='home/'` to show only user project files. Agents can explicitly request `prefix:'sys/'` to access system internals, but the default privacy-filters system away from user view.
- **Preview pane** (`docs/index.html` `refreshPreview`): prefers `home/index.html` over root `index.html`, ignores all `sys/*.html` files. UX isolation of system from user-visible preview.

