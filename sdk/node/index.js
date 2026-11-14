import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const formFor = (settings = {}) => ({
  version: 1,
  title: 'Webserver settings',
  fields: Object.entries(settings).map(([name, spec]) => ({ name, ...spec })),
  submit: { method: 'POST', action: '/settings', enctype: 'application/json' },
});

const descriptorFor = (id, mcp = {}) => ({
  version: 1,
  name: id,
  transport: 'thebird-local-proxy',
  endpoint: '/__thebird/mcp/' + id,
  tools: mcp.tools ?? [],
  resources: mcp.resources ?? [],
  prompts: mcp.prompts ?? [],
});

export function createWebserver(options = {}) {
  const id = String(options.id ?? 'site');
  const cwd = resolve(options.cwd ?? dirname(new URL(import.meta.url).pathname));
  const publicDir = resolve(options.publicDir ?? join(cwd, 'public'));
  const settingsFile = resolve(options.settingsFile ?? join(cwd, 'settings.json'));
  const settingsSpec = options.settings ?? {};
  const methods = options.methods ?? {};
  const defaults = Object.fromEntries(Object.entries(settingsSpec).map(([name, spec]) => [name, spec.default ?? null]));
  const readSettings = async () => ({ ...defaults, ...JSON.parse(await readFile(settingsFile, 'utf8').catch(() => '{}')) });
  const html = (title) => '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><link rel="icon" href="/favicon.ico"></head><body data-site="' + id + '"><h1>' + title + '</h1><p>Normal Node webserver</p><script type="module" src="/__thebird/sdk/browser.js"></script></body></html>';
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/settings' && req.method === 'GET') return json(formFor(settingsSpec));
    if (url.pathname === '/settings' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const settings = { ...(await readSettings()), ...body };
      await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n');
      return json({ ok: true, settings });
    }
    if (url.pathname === '/mcp' && req.method === 'GET') return json(descriptorFor(id, options.mcp));
    if (url.pathname === '/mcp' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const method = methods[body.method];
      if (!method) return json({ ok: false, error: 'unknown method ' + body.method }, 404);
      return json({ ok: true, result: await method(body.params ?? {}) });
    }
    if (url.pathname === '/__thebird/hmr.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end("new EventSource('/__thebird/events').addEventListener('webservers', () => location.reload());\n"); }
    if (url.pathname === '/favicon.ico') {
      const file = join(publicDir, 'favicon.ico');
      if (existsSync(file)) { res.writeHead(200, { 'content-type': 'image/x-icon' }); return res.end(await readFile(file)); }
      return json({ icon: 'fallback' });
    }
    if (url.pathname === '/' && req.method === 'GET') { const settings = await readSettings(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html(settings.title ?? id)); }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = join(publicDir, name);
      if (!file.startsWith(publicDir) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200); return res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    }
    res.writeHead(405); res.end('method not allowed');
  };
  return {
    id,
    handler,
    descriptor: descriptorFor(id, options.mcp),
    settingsForm: formFor(settingsSpec),
    start(port = options.port ?? 0) {
      const server = createServer(handler);
      return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, url: 'http://127.0.0.1:' + server.address().port + '/', close: () => new Promise((done) => server.close(done)) })));
    },
  };
}

export default { createWebserver };
