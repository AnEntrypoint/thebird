# thebird

Browser-native web OS — multi-instance, agentic, serverless. Per-instance Service Worker isolation, OPFS-backed filesystem (IndexedDB fallback), in-browser POSIX shell, freddie-host with vector search and code insight.

## Live

**[anentrypoint.github.io/thebird](https://anentrypoint.github.io/thebird/)** — landing + project chrome (built from `site/` via [flatspace](https://www.npmjs.com/package/flatspace)).

The full web-OS lives in `docs/` and runs against any static server — no install, no build:

```bash
bunx serve docs        # or: npx serve docs / python -m http.server -d docs
```

Then open `http://localhost:3000/os.html`.

For the full setup walkthrough (LLM gateway, provider keys, routing modes),
the complete tool list the in-page agent can call, and known limitations,
see **[`docs/SETUP.md`](docs/SETUP.md)**.

## Multi-instance isolation

Two thebird instances in the same browser tab never share state. Isolation is enforced at the Service Worker thread boundary: each instance gets its own SW at scope `./sw-iN/`. 16 static SW files (`docs/sw-iN/index.js`) are committed for GH Pages (no custom headers required); dynamic `docs/sw-instance.js?inst=iN` is the fallback past instance 16. Regenerate the static files after editing the source SW: `npm run gen-sws`.

## Manual validation

There is no `validate.html` harness — it was removed because its headless CI run flaked on the 61MB `plugkit.wasm` cold-load (false failures that threw maintenance off). Validation is **manual**: boot the OS locally and run the `scripts/witness-*.mjs` puppeteer probes, each of which asserts one surface (boot, apps, chat round-trip, gm vector recall, WM persistence, edge cases, UI interactions, …). See **`docs/MANUAL-VALIDATION.md`** for the full workflow and per-script assertions.

After editing `sw-instance.js`, re-run `node scripts/gen-static-sws.mjs` and commit the regenerated `docs/sw-iN/index.js` so the static per-instance SWs stay in sync.

## Chrome contract

The menubar and taskbar sit at `--os-bar-h: 34px` to match the rendered window titlebar, and `.wm-root` spans the full viewport so the bars paint OVER a maximized window's chrome (z-index 9200 > 9000). The backtick / tilde key (`` ` ``) hides both bars system-wide — toggle again to restore. The setting persists per-instance.

## State restore

Reload restores every instance and every window: ids, geometry, z-order, focus, maximized/minimized flags, active instance, and bars-hidden state. The snapshot is mirrored to every per-instance Service Worker so partial wipes don't lose the desktop. See `memory/tilde-bars-and-restore.md` for the full contract.

## Developer docs

`AGENTS.md` is the primary developer doc — load-bearing contracts (dynamic stack, GUI boundary rule, per-instance isolation, brand tokens, sqlite-shim quirks) and a memo index live there. Read it before touching anything in `docs/`.

## License

MIT
