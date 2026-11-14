import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { readRegistry, registerServer, unregisterServer, statusServers, serverFolder, validateId } from './webserver-registry.js';
import { ensureCraftApps, readCraftConfig, craftDescriptor, callCraft, appForFile, appForIntent, createSamples, craftStatus, craftRuntime } from './craft-registry.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4173;
export const DEFAULT_ROOT = '_site';
const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.br': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const FAVICON = Buffer.from('AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==', 'base64');
const json = (res, value, status = 200, isolated = true) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (isolated) { headers['cross-origin-opener-policy'] = 'same-origin'; headers['cross-origin-embedder-policy'] = 'require-corp'; }
  res.writeHead(status, headers); res.end(JSON.stringify(value));
};
const bodyJson = async (req) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); };

export function resolveSiteRoot(root = DEFAULT_ROOT, cwd = process.cwd()) { return resolve(cwd, root); }
function requestPath(url) { try { return decodeURIComponent(new URL(url, 'http://localhost').pathname); } catch { return null; } }
function safePath(siteRoot, pathname) { const relative = normalize(pathname).replace(/^([/\\]|\.\.[/\\])+/, ''); const target = resolve(siteRoot, '.' + sep + relative); return target === siteRoot || target.startsWith(siteRoot + sep) ? target : null; }
async function findFile(siteRoot, pathname) { let target = safePath(siteRoot, pathname); if (!target) return null; try { const info = await stat(target); if (info.isDirectory()) target = join(target, 'index.html'); const file = await stat(target); return file.isFile() ? target : null; } catch { return null; } }
export function contentType(file) { const name = file.endsWith('.js.br') || file.endsWith('.mjs.br') ? file.slice(0, -3) : file; return TYPES[extname(name)] ?? 'application/octet-stream'; }

async function sendResolvedFile(req, res, file, isolated) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }); return res.end('method not allowed'); }
  const info = await stat(file);
  const headers = { 'content-type': contentType(file), 'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (isolated) { headers['cross-origin-opener-policy'] = 'same-origin'; headers['cross-origin-embedder-policy'] = 'require-corp'; }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(await readFile(file));
}

async function sendFile(req, res, siteRoot, pathname, isolated) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }); return res.end('method not allowed'); }
  const file = await findFile(siteRoot, pathname);
  if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
  const info = await stat(file);
  const headers = { 'content-type': contentType(file), 'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (isolated) { headers['cross-origin-opener-policy'] = 'same-origin'; headers['cross-origin-embedder-policy'] = 'require-corp'; }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
}

const settingsForm = (id) => ({ version: 1, id, title: 'Settings for ' + id, submit: { method: 'POST', action: '/sites/' + id + '/settings', enctype: 'application/json' }, fields: [{ name: 'title', type: 'text', label: 'Title', default: id }, { name: 'accent', type: 'text', label: 'Accent color', default: '#6fe1c6' }] });
const mcpDescriptor = (id) => ({ version: 1, name: id, transport: 'thebird-local-proxy', endpoint: '/__thebird/mcp/' + id, tools: [{ name: 'ping', description: 'Return pong', input: {}, output: { type: 'string' } }, { name: 'settings', description: 'Read current settings', input: {}, output: { type: 'object' } }], resources: [{ name: 'page', uri: '/sites/' + id + '/' }, { name: 'settings', uri: '/sites/' + id + '/settings' }], prompts: [{ name: 'rollout', text: 'Roll out a normal Node feature in ' + id }] });

async function siteFile(projectRoot, id, path) { const folder = serverFolder(projectRoot, id); const pub = join(folder, 'public'); const rel = path === '/' ? 'index.html' : path.replace(/^\//, ''); const file = safePath(pub, rel); return await stat(file).then((info) => info.isFile() ? file : null).catch(() => null) ?? (rel === 'favicon.ico' ? null : null); }

export async function startWebHost({ host = DEFAULT_HOST, port = DEFAULT_PORT, root = DEFAULT_ROOT, cwd = process.cwd(), isolated = true, projectRoot = cwd } = {}) {
  const siteRoot = resolveSiteRoot(root, cwd);
  const info = await stat(siteRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error('site root is not a directory: ' + siteRoot);
  if (isolated) for (const path of ['web/features.json', 'web/features.js', 'web/features-bridge.js', 'web/features-in-txiki.js', 'web/features-program.js', 'web/vendor/txiki/tjs.wasm']) { const present = await stat(join(siteRoot, path)).catch(() => null); if (!present?.isFile()) throw new Error('canonical site is stale or incomplete: ' + path + ' is missing; run node scripts/build-pages.mjs'); }
  await ensureCraftApps(projectRoot);
  const clients = new Set();
  const broadcast = (type, payload = {}) => { const data = JSON.stringify({ type, at: new Date().toISOString(), ...payload }); for (const res of clients) res.write('event: webservers\ndata: ' + data + '\n\n'); };
  const registrySnapshot = async () => ({ version: 1, servers: await statusServers(projectRoot), prompts: ['Use npm, bash and normal Node files. Register with: node bin/thebird-webserver.js register <id>'] });
  const api = async (req, res, pathname) => {
    if (pathname === '/__thebird/registry' && req.method === 'GET') { json(res, await registrySnapshot(), 200, isolated); return true; }
    if (pathname === '/__thebird/registry' && req.method === 'POST') { const body = await bodyJson(req); const entry = await registerServer(projectRoot, body.id, body); broadcast('registered', { id: entry.id }); json(res, { ok: true, entry }, 200, isolated); return true; }
    if (pathname === '/__thebird/registry' && req.method === 'DELETE') { const body = await bodyJson(req); const ok = await unregisterServer(projectRoot, body.id); broadcast('unregistered', { id: body.id }); json(res, { ok }, 200, isolated); return true; }
    if (pathname === '/__thebird/events' && req.method === 'GET') { const headers = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }; if (isolated) { headers['cross-origin-opener-policy'] = 'same-origin'; headers['cross-origin-embedder-policy'] = 'require-corp'; } res.writeHead(200, headers); res.write('event: webservers\ndata: ' + JSON.stringify({ type: 'connected', servers: (await registrySnapshot()).servers }) + '\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return true; }
    if (pathname === '/__thebird/progress' && req.method === 'POST') { const body = await bodyJson(req); broadcast('progress', body); json(res, { ok: true, progress: body }, 200, isolated); return true; }
    if (pathname === '/__thebird/mcp' && req.method === 'GET') { json(res, { version: 1, endpoints: (await statusServers(projectRoot)).map((server) => '/__thebird/mcp/' + server.id) }, 200, isolated); return true; }
    if (pathname === '/__thebird/craft' && req.method === 'GET') { json(res, { version: 1, lazy: true, status: await craftStatus(projectRoot), intent: { sheet: 'gridcraft', doc: 'wordcraft', pdf: 'pdfcraft' } }, 200, isolated); return true; }
    if (pathname === '/__thebird/craft/intent' && req.method === 'POST') { const body = await bodyJson(req); const app = appForIntent(body.text ?? body.file ?? ''); const suggestions = app ? [await craftDescriptor(projectRoot, app)] : []; json(res, { ok: Boolean(app), app: app?.id ?? null, descriptors: suggestions }, 200, isolated); return true; }
    if (pathname === '/__thebird/craft/task' && req.method === 'POST') { const body = await bodyJson(req); await createSamples(projectRoot); const app = appForIntent(body.text ?? body.file ?? '') ?? appForFile(body.file ?? ''); if (!app) { json(res, { error: 'no craft app for task' }, 400, isolated); return true; } const method = body.method ?? (app.kind === 'sheet' ? 'cat' : 'text'); const result = await callCraft(projectRoot, app.id, method, { file: body.file ? body.file.split('/').pop() : undefined }); broadcast('document', { id: app.id, file: result.file, status: 'open', preview: result.preview, stdout: result.stdout.slice(0, 500) }); json(res, { ok: result.ok, task: body.text ?? body.file, app: app.id, result }, 200, isolated); return true; }
    if (pathname === '/__thebird/craft/processes' && req.method === 'GET') { json(res, await craftRuntime(projectRoot), 200, isolated); return true; }
    if (pathname === '/__thebird/craft/samples' && req.method === 'POST') { json(res, { ok: true, samples: await createSamples(projectRoot) }, 200, isolated); return true; }
    if (pathname.startsWith('/__thebird/mcp/')) {
      let id; try { id = validateId(pathname.slice('/__thebird/mcp/'.length)); } catch { json(res, { error: 'invalid webserver id' }, 400, isolated); return true; }
      const registry = await readRegistry(projectRoot);
      if (!registry.servers.some((entry) => entry.id === id)) { json(res, { error: 'unknown webserver' }, 404, isolated); return true; }
      if (req.method === 'GET') { const apps = await readCraftConfig(projectRoot); json(res, apps[id] ? await craftDescriptor(projectRoot, apps[id]) : mcpDescriptor(id), 200, isolated); return true; }
      if (req.method === 'POST') { const body = await bodyJson(req); const apps = await readCraftConfig(projectRoot); if (apps[id]) { await createSamples(projectRoot); const result = await callCraft(projectRoot, id, body.method, body.params ?? {}); broadcast('document', { id, file: result.file, status: 'working', preview: result.preview, method: body.method }); json(res, { ok: result.ok, result }, result.ok ? 200 : 500, isolated); return true; } const settings = JSON.parse(await readFile(join(serverFolder(projectRoot, id), 'settings.json'), 'utf8').catch(() => '{}')); const result = body.method === 'ping' ? 'pong' : body.method === 'settings' ? settings : null; json(res, result === null ? { error: 'unknown method' } : { ok: true, result }, result === null ? 404 : 200, isolated); return true; }
    }
    if (pathname.startsWith('/sites/')) {
      const [id, ...parts] = pathname.slice('/sites/'.length).split('/'); const registry = await readRegistry(projectRoot);
      if (!registry.servers.some((entry) => entry.id === id)) { json(res, { error: 'unknown webserver' }, 404, isolated); return true; }
      const sub = '/' + (parts.join('/') || '');
      if (sub === '/settings' && req.method === 'GET') { json(res, settingsForm(id), 200, isolated); return true; }
      if (sub === '/settings' && req.method === 'POST') { const body = await bodyJson(req); const file = join(serverFolder(projectRoot, id), 'settings.json'); const current = JSON.parse(await readFile(file, 'utf8').catch(() => '{}')); const next = { ...current, ...body }; await writeFile(file, JSON.stringify(next, null, 2) + '\n'); broadcast('settings', { id }); json(res, { ok: true, settings: next }, 200, isolated); return true; }
      if (sub === '/mcp' && req.method === 'GET') { const apps = await readCraftConfig(projectRoot); json(res, apps[id] ? await craftDescriptor(projectRoot, apps[id]) : mcpDescriptor(validateId(id)), 200, isolated); return true; }
      if (sub === '/favicon.ico' && req.method === 'GET') { const headers = { 'content-type': 'image/x-icon', 'cache-control': 'no-store' }; if (isolated) { headers['cross-origin-opener-policy'] = 'same-origin'; headers['cross-origin-embedder-policy'] = 'require-corp'; } res.writeHead(200, headers); res.end(FAVICON); return true; }
      const file = await siteFile(projectRoot, id, sub); if (file) { await sendResolvedFile(req, res, file, isolated); return true; }
      const extra = safePath(serverFolder(projectRoot, id), sub); if (extra && await stat(extra).then((info) => info.isFile()).catch(() => false)) { await sendResolvedFile(req, res, extra, isolated); return true; }
      if (sub === '/' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>' + id + '</title><body data-site="' + id + '"><h1>' + id + '</h1>'); return true; }
      json(res, { error: 'not found' }, 404, isolated); return true;
    }
    return null;
  };
  const server = createServer((req, res) => {
    if (isolated) { res.setHeader('cross-origin-opener-policy', 'same-origin'); res.setHeader('cross-origin-embedder-policy', 'require-corp'); }
    const pathname = requestPath(req.url ?? '/'); if (!pathname) { res.writeHead(400); return res.end('bad request'); }
    api(req, res, pathname).then((handled) => { if (handled !== null) return; return sendFile(req, res, siteRoot, pathname, isolated); }).catch((error) => { console.error('thebird web host request', error); if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); if (!res.writableEnded) res.end(error.message); });
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const bound = server.address().port;
  return { host, port: bound, root: siteRoot, isolated, url: 'http://' + host + ':' + bound + '/', broadcast, registry: registrySnapshot, close: () => new Promise((ok) => { for (const client of clients) client.end(); server.closeAllConnections(); server.close(ok); }) };
}

process.on('uncaughtException', (error) => console.error('thebird web host uncaught', error));
process.on('unhandledRejection', (error) => console.error('thebird web host rejection', error));
