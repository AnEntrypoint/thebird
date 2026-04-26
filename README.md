# thebird

Browser-native web OS — agentic chat, POSIX terminal, live preview, IndexedDB filesystem. **No server. No install. No build.**

## Live

**[anentrypoint.github.io/thebird](https://anentrypoint.github.io/thebird/)**

- **Chat** — agentic AI with tool calling. Provider key stored in localStorage, never proxied.
- **Terminal** — POSIX shell (xstate v5) over IndexedDB. `ls`, `cat`, `cd`, `mkdir`, `rm`, `cp`, `mv`, `echo`, `env`, `export`, `node`, `npm install`, `git`. Node REPL with `require()` from IDB `node_modules`.
- **Preview** — service worker serves files from IDB at `/preview/*`. Hot-reloads on write.

All deps vendored to `docs/vendor/`. No CDN at runtime.

## Folder layout

```
thebird/
├── docs/              # the entire product — static GH Pages site
│   ├── index.html     # landing + live app (overview / live-app modes)
│   ├── app.js         # bird-chat custom element
│   ├── terminal.js    # xterm + xstate boot
│   ├── shell-*.js     # POSIX shell builtins / parser / exec
│   ├── tui.css        # component styles (tabs, msg, toolbar)
│   ├── defaults.json  # virtual FS seed (sys/* infra · home/* user)
│   └── vendor/        # design-tokens.css, app-shell.css, xterm, webjsx, ...
└── .github/workflows/pages.yml   # auto-deploy docs/ on push to main
```

No `package.json`, no `node_modules`, no `serve.js`. The site **is** the project.

## Local dev

```bash
bunx serve docs        # or: npx serve docs · python -m http.server -d docs
```

Any static server works. WebContainer features that need cross-origin isolation degrade gracefully via `coi-serviceworker.js`.

## acptoapi

Anthropic-format streaming, multi-provider routing, tool calling — everything model-side — lives in [acptoapi](https://github.com/AnEntrypoint/acptoapi).

```bash
bunx acptoapi          # one-shot CLI
npx acptoapi           # same, npm
npm install acptoapi   # SDK in your own project
```

## Design system

Chrome (topbar, status bar, panels, cards, kv tables, chips) follows [247420 / design](https://github.com/AnEntrypoint/design). Tokens vendored at `docs/vendor/design-tokens.css` + `docs/vendor/app-shell.css`.

## License

MIT
