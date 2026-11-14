# Lazy Craft apps

GridCraft, WordCraft and PDFCraft are native CLI apps discovered from `.thebird/craft-apps.json`. They are registered as normal thebird webservers at host startup, but no native process starts until a task, open, or MCP call needs it. The Node-side MCP adapter spawns the CLI for that call, captures its PID, waits for exit, and returns stdout/preview data; there is no resident stdio MCP process.

## Normal commands

```bash
node bin/thebird-craft.js ensure gridcraft|wordcraft|pdfcraft
node bin/thebird-craft.js sample
node bin/thebird-craft.js status
node bin/thebird-craft.js processes
node bin/thebird-craft.js intent "review sheet.xlsx"
node bin/thebird-craft.js open .thebird/webservers/gridcraft/documents/sample.csv
node bin/thebird-craft.js descriptor pdfcraft
node bin/thebird-craft.js stop
```

`ensure` registers all three apps and writes `.thebird/webservers/gridcraft/`, `wordcraft/`, and `pdfcraft/` folders with standard `/`, `/settings`, `/mcp`, favicon, documents, and previews. It does not launch a craft binary.

## MCP contract

`GET /__thebird/craft` lists lazy apps and intent routing. `POST /__thebird/craft/intent` accepts `{ "text": "review sheet.xlsx" }` and returns the right descriptor. `POST /__thebird/craft/task` accepts `{ "text", "file", "method" }`, activates the app, generates a visible document card via SSE, and returns native CLI output.

Descriptor endpoints: `/__thebird/mcp/gridcraft`, `/__thebird/mcp/wordcraft`, `/__thebird/mcp/pdfcraft`. Calls use `POST` with `{ "method": "gridcraft.cat", "params": { "file": "sample.csv" } }` and similar `wordcraft.text`, `pdfcraft.render`, `*.info`, `*.open`, `*.convert`. Exact tool names are in each descriptor.

Intent routing:
- sheet/xlsx/xlsm/xls/csv/tsv/ods/cell/formula -> `gridcraft`
- doc/docx/doc/odt/rtf/word/document -> `wordcraft`
- pdf/render/extract/combine/split -> `pdfcraft`

Browser SDK: `window.THEBIRD_CRAFT.apps()`, `.intent(text)`, `.task(text,file,method)`, `.open(file)`, `.call(app,method,params)`. The txiki/fx bridge accepts `webserver craft <op> ...`.

## Display and live feedback

`web/craft-workspace.js` subscribes to `/__thebird/events`. On `document` or `progress` events it registers a `THEBIRD_FEATURES` card with filename, app, status, preview image/path and text output. Generated previews live under `/sites/<app>/previews/`. Registration, discovery, calls and display happen in-session; no host restart is needed.

## Sample/witness documents

`node bin/thebird-craft.js sample` creates a CSV sheet sample, a text document sample, and converts a text source into a PDF sample. `npm run host:check` calls the lazy HTTP/MCP paths for all three types, checks that no craft process is resident, and asserts visible document workspace/card markers in headless Chromium DOM.
