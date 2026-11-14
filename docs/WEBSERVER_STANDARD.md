# thebird webserver standard

A hosted webserver is a normal Node/npm project. To an agent, it is a folder on a normal computer: use `bash`, edit files, run `npm install`, and run `npm start`. txiki.js is only an in-page implementation detail; do not write txiki-specific workarounds.

## Normal commands

```bash
node bin/thebird-webserver.js register my-app --title 'My App'
cd .thebird/webservers/my-app
npm install
npm start
node ../../bin/thebird-webserver.js list
node ../../bin/thebird-webserver.js status
node ../../bin/thebird-webserver.js unregister my-app
```

Registration creates `.thebird/webservers/my-app/` with `package.json`, `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`, `public/favicon.ico`, `settings.json`, `README.md` and `AGENTS.md`. The persistent registry is `.thebird/webservers.json`. Registration is live: the canonical host broadcasts over `/__thebird/events`; no restart is needed.

## Standard routes

Every registered webserver is exposed under `/sites/<id>/`:

| Route | Contract |
| --- | --- |
| `GET /` | Normal HTML page. |
| `GET /favicon.ico` | Icon; a fallback is supplied by the host. |
| `GET /settings` | Settings form JSON: `{ version, id, title, fields, submit }`. |
| `POST /settings` | JSON body saved to the server's `settings.json`; returns `{ ok, settings }`. |
| `GET /mcp` | MCP descriptor with tools, resources and prompts. |
| `POST /__thebird/mcp/<id>` | Local MCP method proxy, e.g. `{ "method": "ping", "params": {} }`. |

System-wide live endpoints:

| Route | Contract |
| --- | --- |
| `GET /__thebird/registry` | Current registry, status and user-wide prompts. |
| `POST /__thebird/registry` | Register `{ id, title, description }` live. |
| `DELETE /__thebird/registry` | Unregister `{ id }` live. |
| `GET /__thebird/events` | EventSource/SSE `webservers` events for registry, settings, progress and HMR. |
| `POST /__thebird/progress` | Post `{ id, text, status }` for fx/superagent rollout feedback. |
| `GET /__thebird/mcp` | List live MCP endpoints. |
| `GET /__thebird/mcp/<id>` | Descriptor for one server. |
| `POST /__thebird/mcp/<id>` | Call a standard descriptor method. |

## Shared SDK

Node servers import `thebird/sdk/node`:

```js
import { createWebserver } from 'thebird/sdk/node';
const server = createWebserver({ id: 'my-app', settings, mcp, methods });
server.start();
```

The browser imports `thebird/sdk/browser` or `window.THEBIRD_WEBSERVERS`:

```js
const sdk = window.THEBIRD_WEBSERVERS;
const registry = await sdk.registry();
const form = await sdk.settings('my-app');
await sdk.saveSettings('my-app', { title: 'New title' });
await sdk.mcp('my-app', 'ping');
await sdk.progress({ id: 'my-app', text: 'Rolling out feature', status: 'working' });
sdk.events((event) => console.log('live', event));
```

`window.THEBIRD_FEATURES` remains the visible DOM card API. `sdk.progress()` posts live status that appears as user feedback through the feature surface.

## MCP and fx

MCP descriptors are ordinary JSON. fx and superagent discover them through `/__thebird/mcp` and call methods through `/__thebird/mcp/<id>`. The in-session txiki/fx bridge uses normal `fetch` through `THEBIRD_WEBSERVERS.mcp(...)`; adding/removing a registered webserver changes the live descriptor list immediately. No restart or out-of-band MCP process is required.

## Shell and HMR

The normal `/` page includes a Discord-like shell. Desktop shows a collapsible left bar; phones (`max-width: 700px`) show a fullscreen phone-centric view (`data-layout="phone"`). Every registered server appears with favicon, title, status, settings link, MCP indicator and HMR state. DOM markers include `#webserver-shell`, `data-shell="webservers"`, `data-webserver-id`, `data-webserver-settings`, `data-webserver-mcp`, `data-webserver-hmr`, `data-shell-toggle`, and `data-webserver-prompts`.

SSE `/__thebird/events` drives live UI updates and HMR. The scaffold's `public/app.js` subscribes to `webservers` events and posts progress through `/__thebird/progress`. Changing a registered server folder or registering a new server updates the shell in-session.

## User-wide prompts

`web/prompts.json` is a user-wide template shown in the normal page as a feature card. It lists the exact normal commands and routes. Agents should follow that prompt; it intentionally contains no txiki-specific setup steps.


## Lazy Craft apps

GridCraft, WordCraft and PDFCraft are lazy native Node CLI adapters registered as live webservers. Use `node bin/thebird-craft.js ensure`, `sample`, `status`, `intent`, `open`, `descriptor`, and `stop`; MCP endpoints are `/__thebird/mcp/<gridcraft|wordcraft|pdfcraft>`. Sheet/doc/PDF intent selects the app, native processes start only per task, and document cards appear live through `THEBIRD_FEATURES`/SSE. See `docs/CRAFT_APPS.md`.
