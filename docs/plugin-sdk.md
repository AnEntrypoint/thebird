# thebird Plugin SDK — Design Spec (Pass 1)

Status: **DRAFT / spec-only**. No loader code exists yet. This document defines the contract so Pass 2 can implement it.

Goal: let a user paste a GitHub URL (or npm spec) into thebird and get a working app — without rebuilding `docs/`, without a server, and without sacrificing the per-instance Service-Worker isolation that the rest of the OS depends on.

---

## 1. Manifest Schema

A plugin is identified by a single JSON document, either:

- a top-level file named `thebird-plugin.json` at the repo root, **or**
- a `"thebird"` field inside `package.json` (same shape).

### 1.1 Required fields

| Field         | Type                       | Notes                                                                                  |
|---------------|----------------------------|----------------------------------------------------------------------------------------|
| `id`          | string (kebab-case)        | Globally unique within an instance. Reverse-DNS recommended (`com.acme.notes`).        |
| `title`       | string                     | Human label shown in launcher / window chrome.                                         |
| `version`     | semver string              | Used by the update check.                                                              |
| `entry`       | string (URL or rel path)   | ESM module URL. Relative paths resolve against the manifest URL.                       |
| `permissions` | string[]                   | Explicit grants (see §4). Empty array = pure-iframe sandbox, no host API.              |
| `tier`        | `"sandboxed" \| "trusted"` | Which loader path (see §6). Defaults to `"sandboxed"`.                                 |

### 1.2 Optional fields

| Field             | Type                | Notes                                                                  |
|-------------------|---------------------|------------------------------------------------------------------------|
| `icon`            | string (URL/data:)  | Square raster or SVG. Falls back to first glyph of `title`.            |
| `defaultSize`     | `{w:number,h:number}` | Initial window size; clamped by `docs/wm.js`.                        |
| `slashCommands`   | `Array<{name,desc}>`| Registered with freddie via `freddie.registerSlashCommand`.            |
| `surfaces`        | string[]            | Which thebird kits it slots into: `"window"`, `"dock"`, `"tray"`, `"freddie-panel"`, `"context-menu"`. Default `["window"]`. |
| `essential`       | boolean             | Mirrors `apps.js` `system` flag — collapsed under System submenu when `true`. |
| `integrity`       | string              | Subresource Integrity hash for `entry` (sha384-…). Required for `trusted` tier when source is mutable. |
| `csp`             | string              | Extra CSP appended to iframe sandbox (sandboxed tier only).            |
| `homepage`        | string (URL)        | Shown in "About this plugin" pane.                                     |

### 1.3 Example

```json
{
  "id": "com.acme.notes",
  "title": "Notes",
  "version": "0.3.1",
  "entry": "./dist/plugin.mjs",
  "tier": "trusted",
  "permissions": ["idb-scope", "gm-dispatch", "network-host:api.acme.dev"],
  "icon": "./icon.svg",
  "defaultSize": { "w": 560, "h": 420 },
  "slashCommands": [{ "name": "/note", "desc": "Append to today's note" }],
  "surfaces": ["window", "freddie-panel"],
  "integrity": "sha384-…"
}
```

---

## 2. Source Resolution

The SDK accepts a single string from the user and resolves it to `{manifestUrl, baseUrl, ref}`.

### 2.1 Accepted forms

| Form                                              | Resolves to                                                                              |
|---------------------------------------------------|------------------------------------------------------------------------------------------|
| `github://owner/repo[@ref][#path]`                | Custom shorthand. `ref` defaults to default branch; `path` defaults to repo root.        |
| `https://github.com/owner/repo[/tree/ref/path]`   | Parsed the same way; UI-friendly paste form.                                             |
| `https://github.com/owner/repo/blob/ref/file.json`| Direct manifest URL — bypass discovery.                                                  |
| `https://raw.githubusercontent.com/.../file.json` | Direct manifest URL.                                                                     |
| `https://anywhere.example/manifest.json`          | Generic HTTPS. Subject to CORS; same-origin or `access-control-allow-origin: *` only.    |
| `npm:<pkg>[@version]`                             | Resolved via `https://esm.sh/<pkg>@<version>/thebird-plugin.json` (or `package.json#thebird`). |
| `jsdelivr:<owner>/<repo>[@ref]`                   | `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/thebird-plugin.json`.                  |

### 2.2 CDN tradeoffs

| CDN                       | Pros                                                  | Cons                                                              |
|---------------------------|-------------------------------------------------------|-------------------------------------------------------------------|
| **jsDelivr (`/gh/`)**     | Permissive CORS, immutable when ref is a tag/SHA, fast. | Caches aggressively (~12h on `@main`).                            |
| **esm.sh**                | Auto-bundles npm; rewrites bare imports.              | Adds wrapper; can break plugins that touch `import.meta.url`.      |
| **GitHub Pages**          | Author-controlled; long-term stable.                  | Requires `owner.github.io/repo`; not all repos publish Pages.     |
| **`raw.githubusercontent.com`** | Always current.                                  | **No CORS** for cross-origin fetch → unusable for `entry`. Only viable via SW proxy. |

### 2.3 Integrity pinning

- `@main` / `@master` / branch refs → SDK logs a **mutability warning** and refuses `trusted` tier without an `integrity` hash.
- Tag refs (`@v1.2.3`) → SDK rewrites to the tag's resolved commit SHA at install time and stores both in the install record (so reproducible).
- SHA refs (`@<40-hex>`) → trusted as-is.
- `sandboxed` tier may run mutable refs (the iframe sandbox limits blast radius), but the user gets a yellow "unpinned" badge in the install dialog.

### 2.4 Default discovery order at a base URL

1. `thebird-plugin.json` at the repo root.
2. `package.json` → read `.thebird` field.
3. `dist/thebird-plugin.json` (for repos that build).
4. Failure → ask the user for the manifest path manually.

---

## 3. Host API Surface (`window.thebird` inside trusted; `postMessage` for sandboxed)

Minimal and deliberately small. Pass 2 may add more; Pass 1 commits only to the following:

### 3.1 Registration

```
thebird.apps.register({ id, title, icon, defaultSize, essential, factory })
```

Mirrors the internal `reg(...)` call in `docs/apps.js` (line 462). `factory` is `(winEl, ctx) => void` and is called every time a window opens.

### 3.2 Filesystem (scoped)

```
thebird.fs.read(path) -> Promise<Uint8Array | string>
thebird.fs.write(path, data) -> Promise<void>
thebird.fs.list(prefix) -> Promise<string[]>
thebird.fs.remove(path) -> Promise<void>
```

All paths are silently prefixed with `/plugins/<plugin-id>/`. A plugin cannot read another plugin's scope, nor the OS root, without `fs-root` (not exposed in Pass 1).

### 3.3 gm

```
thebird.gm.dispatch(skillName, args) -> Promise<result>
thebird.gm.recall(query) -> Promise<hits[]>
```

Gated by `gm-dispatch` permission.

### 3.4 freddie

```
thebird.freddie.registerSlashCommand(name, handler)
thebird.freddie.send(text) -> Promise<string>
```

Gated by `freddie-slot` permission. `registerSlashCommand` only available if the plugin's manifest declared the command in `slashCommands` (defence-in-depth — the user already consented at install).

### 3.5 Theme

```
thebird.theme.token(name) -> string         // reads --os-bg-0, --panel-text, etc.
thebird.theme.onChange(cb) -> unsubscribe   // fires on auto/dark/light flip
```

Always available; no permission needed (read-only).

### 3.6 Lifecycle hooks (optional exports from `entry`)

```js
export function activate(host) { ... }   // called once per OS boot
export function deactivate() { ... }     // called on uninstall / disable
```

If absent, the SDK simply imports the module for side effects and calls `apps.register` directly.

---

## 4. Permissions Model

**Default deny.** Every privileged host call is gated by a string in the manifest's `permissions` array. The install dialog enumerates them in plain English and the user must approve before activation.

| Permission           | Grants                                                                                | Risk                                   |
|----------------------|---------------------------------------------------------------------------------------|----------------------------------------|
| `gm-dispatch`        | `thebird.gm.dispatch`, `thebird.gm.recall`                                            | Runs skills with the user's identity.  |
| `idb-scope`          | `thebird.fs.*` (own scope only)                                                       | Local persistence; cannot escape scope. |
| `network-host:<h>`   | `fetch()` to host `<h>` from sandboxed iframe (CSP `connect-src` allowlist).          | Network egress to one host.            |
| `freddie-slot`       | Slash-command registration + `freddie.send`                                           | Can prompt the LLM as the user.        |
| `surface:<name>`     | Mount UI into `dock` / `tray` / `freddie-panel` / `context-menu`                     | UI real-estate beyond a window.        |
| `theme-write`        | Override theme tokens at runtime (`trusted` tier only; not in Pass 1).                | (Reserved.)                            |

### 4.1 Sandboxed iframe attributes (tier `sandboxed`)

```
sandbox="allow-scripts allow-forms allow-pointer-lock"
```

No `allow-same-origin` → plugin can't read host cookies, localStorage, or other plugins' IDB.
Add `allow-popups` only if the plugin's manifest opted in via `"surfaces": ["popup"]` (not in Pass 1).
CSP injected via `<meta http-equiv>` inside the iframe document:

```
default-src 'none';
script-src <plugin-origin> 'wasm-unsafe-eval';
style-src 'unsafe-inline';
connect-src <network-host grants>;
img-src data: blob: <plugin-origin>;
```

### 4.2 Permission revocation

Stored in IDB under the instance's plugin registry. User can flip a permission off in the Plugins app (deferred to Pass 3) without uninstalling — the SDK rebuilds the plugin's CSP on next activate.

---

## 5. Lifecycle

### 5.1 Install

1. User pastes URL → SDK resolves per §2 → fetches manifest.
2. Validate against §1 schema (JSON-schema check, no AJV — handwritten validator to avoid dep bloat).
3. Show install dialog with: title, version, source, permissions (human-readable), tier, mutability warning if applicable.
4. On approval: fetch `entry` (and any sibling assets the manifest enumerates in an optional `assets[]` field; deferred), compute SHA-384, compare to `integrity` if present.
5. Cache manifest + entry + assets to IDB store `thebird-plugins` (per-instance, owned by SW — see [[SW per-instance isolation]]).
6. Append to instance's plugin registry record `{id, source, resolvedSha, installedAt, permissions, tier, enabled:true}`.

### 5.2 Activate

- Fires during OS boot, after `apps.js` finishes registering built-ins.
- For each enabled plugin record:
  - `trusted`: dynamic `import(blob:URL)` of cached entry → call `activate(host)` or rely on side-effect `apps.register`.
  - `sandboxed`: create hidden `<iframe sandbox=...>` whose `srcdoc` boots a tiny bootstrap that imports the cached entry and connects the postMessage bridge.
- Activation errors are caught per-plugin; one bad plugin must not break boot. Log to `monitor` app.

### 5.3 Update

- Manual: "Check for updates" button refetches manifest from original `source`.
- If `version` differs OR (mutable ref AND `entry` SHA differs): show update dialog (re-prompt if permissions grew).
- Auto-update only for plugins pinned to a tag/SHA (no-op) or explicitly opted-in (deferred).

### 5.4 Uninstall

- Remove from registry.
- Purge IDB scope `/plugins/<id>/` and cached bundle.
- Tear down iframe / call `deactivate()` on trusted plugins.
- Slash-commands and surface mounts are unregistered.

---

## 6. Two Plugin Tiers

### 6.1 Sandboxed (default, generalized)

- For arbitrary npm/GitHub projects that weren't written with thebird in mind.
- Runs in a cross-origin iframe (`srcdoc` + null origin) with strict CSP.
- Host API exposed via `postMessage` bridge — same surface as §3 but async-only.
- DOM lives inside the iframe; thebird window chrome wraps it. Resize events forwarded.
- Can't directly touch the OS DOM (no theme-class injection, no global event listeners outside the iframe).
- Good fit: existing web apps, React/Vue SPAs, static HTML tools.

### 6.2 Trusted (specialized)

- For plugins authored against the thebird SDK.
- Imported as ESM directly into the main world (`import(blob:URL)` of cached bundle).
- Synchronous access to `window.thebird`.
- Can render into the same DOM as built-in apps → matches OS look-and-feel.
- Required for: plugins that want to register slash commands that need fast call paths, plugins that integrate with WM keybinds, plugins that read theme tokens reactively.
- **Must** declare every permission. **Must** ship `integrity` hash for the entry bundle when source is on a mutable ref.

The install dialog defaults to whichever tier the manifest specifies but lets the user downgrade `trusted` → `sandboxed` if they don't trust the source (with a warning that the plugin may not function).

---

## 7. Files Pass 2 Will Touch (Do Not Edit Now)

| File                              | Pass-2 change                                                                                 |
|-----------------------------------|-----------------------------------------------------------------------------------------------|
| `docs/apps.js`                    | Expose `reg` as `thebird.apps.register`; iterate installed plugins after built-ins (~line 475). |
| `docs/os-shell.js`                | Add "Plugins" entry under System submenu; wire install dialog launcher.                       |
| `docs/wm.js`                      | No structural change; new windows created via existing `openApp` path.                        |
| `docs/freddie-loader.js`          | Export `registerSlashCommand` / `send` for trusted-tier plugins.                              |
| `docs/sw-i<N>/index.js` (×16)     | New IDB store `thebird-plugins` per instance; route `/plugin-asset/<id>/<path>` fetches from cache. |
| `docs/sw-instance.js`             | Same store + routes for dynamic-instance fallback.                                            |
| `docs/lib/` (new files)           | `plugin-sdk.js` (host API), `plugin-loader.js` (resolve + install + activate), `plugin-bridge.js` (postMessage bridge for sandboxed tier), `plugin-validator.js` (manifest schema check). |
| `docs/apps/plugins-app.js` (new)  | UI for install / list / enable / uninstall.                                                   |
| `docs/thebird-brand.css`          | Tiny additions for install-dialog + sandboxed-iframe chrome; consider upstreaming to `anentrypoint-design` per [[GUI boundary rule]]. |
| `scripts/witness-*.mjs` (manual)  | Add a `witness-plugin-sdk.mjs` probe: plugin install round-trips through IDB, sandboxed plugin can't read host IDB, permission-less plugin cannot call gm. (No `validate.html` — validation is manual via witness scripts; see `docs/MANUAL-VALIDATION.md`.) |
| `AGENTS.md` / memory              | New memo `[[plugin-sdk-pass-2]]` describing loader internals.                                 |

---

## 8. Open Questions (Need Human Decision Before Pass 2)

1. **github:// fetch path.** Direct `raw.githubusercontent.com` lacks CORS. Do we (a) require jsDelivr (locks plugins to jsDelivr's freshness), (b) proxy through the per-instance SW (adds attack surface), or (c) require authors to publish to GitHub Pages?
2. **npm tarball handling.** `esm.sh` rewrites bare imports but mangles `import.meta.url`. Do we accept that limitation, or ship our own tiny tarball-unpacker (WASM-tar) and serve from SW?
3. **Multi-window plugins.** One `factory` call per `openApp`. Should plugins be allowed to spawn additional windows programmatically (`thebird.windows.open(...)`), or is one window per app sufficient for v1?
4. **Cross-plugin messaging.** Out-of-scope for Pass 1, but should the bridge reserve a namespace now (`thebird.bus.publish/subscribe`) so we don't break compat later?
5. **Trusted-tier signing.** Beyond SRI on the bundle, should we accept a signed manifest (minisign / sigstore) so users can pin "I trust this author" rather than "I trust this SHA"?
6. **Plugin Marketplace / Index.** Out-of-scope for Pass 1 but affects manifest fields. Should we reserve `categories[]`, `screenshots[]`, `license` now?
7. **Per-instance vs global install.** Plugins currently install into one instance's SW-scoped IDB. Do users expect "install once, available in every instance" (would require shared store; conflicts with isolation rule), or per-instance (current proposal — simpler, isolated, but redundant for power users running many instances)?
8. **Service-Worker route ownership.** Adding `/plugin-asset/...` routes inside each `sw-iN/index.js` is repetitive. Generate them at build time, or fetch a shared chunk via `importScripts`? (The latter breaks GH-Pages-static guarantee from [[SW per-instance isolation]].)
9. **WASM plugins.** `'wasm-unsafe-eval'` is in the default CSP, but do we want a per-plugin opt-in flag to keep CSP minimal by default?
10. **Failure UX.** When a plugin's source 404s after install (repo deleted, CDN purge), do we keep running from cache silently, or surface a "stale source" warning?

---

## 9. Out of Scope for Pass 1

- Plugin marketplace / discovery server.
- Inter-plugin RPC (see Q4).
- Hot-reload during development (deferred to a Pass-4 dev-mode flag).
- Native-host bridges (Tauri/Electron) — thebird is browser-only by [[GUI boundary rule]].
- Signed permission-grant receipts.

---

**End of spec.** Pass 2 starts by implementing `docs/lib/plugin-validator.js` + `docs/lib/plugin-loader.js` against this contract, after the open questions in §8 are resolved.
