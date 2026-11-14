import { mkdir, readFile, rename, stat, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const REGISTRY_FILE = '.thebird/webservers.json';
export const SERVERS_DIR = '.thebird/webservers';
const idOf = (name) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
const iso = () => new Date().toISOString();

export function registryPath(projectRoot = process.cwd()) { return resolve(projectRoot, REGISTRY_FILE); }
export function serversDir(projectRoot = process.cwd()) { return resolve(projectRoot, SERVERS_DIR); }
export function serverFolder(projectRoot, id) { return join(serversDir(projectRoot), id); }

export async function readRegistry(projectRoot = process.cwd()) {
  try {
    const value = JSON.parse(await readFile(registryPath(projectRoot), 'utf8'));
    return { version: 1, servers: Array.isArray(value.servers) ? value.servers : [] };
  } catch { return { version: 1, servers: [] }; }
}

export async function writeRegistry(projectRoot, registry) {
  const path = registryPath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify({ version: 1, servers: registry.servers }, null, 2) + '\n');
  await rename(temp, path);
}

export const validateId = (name) => {
  const id = idOf(name);
  if (!id) throw new Error('webserver id must contain letters or numbers');
  return id;
};

const packageJson = (id) => JSON.stringify({ name: 'thebird-site-' + id, version: '1.0.0', private: true, type: 'module', scripts: { start: 'node server.js', dev: 'node server.js' }, dependencies: { thebird: 'file:../..' } }, null, 2) + '\n';
const serverJs = (id) => [
  "import { createWebserver } from 'thebird/sdk/node';",
  'const server = createWebserver({',
  '  id: ' + JSON.stringify(id) + ',',
  "  settings: { title: { type: 'text', label: 'Title', default: " + JSON.stringify(id) + " }, accent: { type: 'text', label: 'Accent color', default: '#6fe1c6' } },",
  "  mcp: { tools: [{ name: 'ping', description: 'Return pong', input: {}, output: { type: 'string' } }], resources: [{ name: 'page', uri: '/' }], prompts: [{ name: 'welcome', text: 'Describe this webserver' }] },",
  "  methods: { async ping() { return 'pong'; } }",
  '});',
  'server.start();',
  '',
].join('\n');
const readme = (id) => '# ' + id + '\n\nThis is a normal Node webserver registered with thebird.\n\n```bash\nnpm install\nnpm start\n```\n\nThe host exposes it in-session at `/sites/' + id + '/`. Edit `server.js`, `public/index.html`, `public/app.js` or `public/styles.css`; the browser shell updates through HMR/SSE. Standard routes are `/`, `/favicon.ico`, `GET /settings`, `POST /settings` and `GET /mcp`. Use the shared SDK from `thebird/sdk/node`.\n';
const agents = 'This folder is a normal Node/npm project. Use bash, edit files, run npm commands, and call the shared SDK. Do not use txiki-specific workarounds; txiki.js is only the in-page implementation detail. Registration and HMR are handled live by the thebird host.\n';
const html = (id) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + id + '</title><link rel="icon" href="favicon.ico"><link rel="stylesheet" href="styles.css"></head>\n<body data-site="' + id + '"><main><h1>' + id + '</h1><p id="live">Live webserver</p><button id="hmr">HMR ready</button></main><script type="module" src="app.js"></script></body></html>\n';
const browserJs = (id) => "const events = new EventSource('/__thebird/events');\nevents.addEventListener('webservers', (event) => { document.querySelector('#live').textContent = 'HMR ' + JSON.parse(event.data).type; });\ndocument.querySelector('#hmr').addEventListener('click', () => fetch('/__thebird/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: " + JSON.stringify(id) + ", text: 'Feature rollout: ready', status: 'ready' }) }));\n";
const css = ':root { color-scheme: dark; font-family: system-ui, sans-serif } body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #101820; color: #edf5f7 } main { padding: 2rem; border: 1px solid #31515a; border-radius: 18px } button { margin-top: 1rem }';
const favicon = Buffer.from('AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==', 'base64');

export async function scaffoldServer(projectRoot, id) {
  const folder = serverFolder(projectRoot, id);
  await mkdir(join(folder, 'public'), { recursive: true });
  await writeFile(join(folder, 'package.json'), packageJson(id));
  await writeFile(join(folder, 'server.js'), serverJs(id));
  await writeFile(join(folder, 'README.md'), readme(id));
  await writeFile(join(folder, 'AGENTS.md'), agents);
  await writeFile(join(folder, 'public', 'index.html'), html(id));
  await writeFile(join(folder, 'public', 'app.js'), browserJs(id));
  await writeFile(join(folder, 'public', 'styles.css'), css);
  await writeFile(join(folder, 'public', 'favicon.ico'), favicon);
  await writeFile(join(folder, 'settings.json'), JSON.stringify({ title: id, accent: '#6fe1c6' }, null, 2) + '\n');
  return folder;
}

export async function registerServer(projectRoot, name, { title, description } = {}) {
  const id = validateId(name);
  const registry = await readRegistry(projectRoot);
  const existing = registry.servers.find((server) => server.id === id);
  if (existing) return { ...existing, created: false };
  const folder = await scaffoldServer(projectRoot, id);
  const entry = { id, title: title ?? id, description: description ?? 'Node webserver ' + id, folder, status: 'registered', hmr: 'ready', mcp: true, createdAt: iso() };
  registry.servers.push(entry);
  await writeRegistry(projectRoot, registry);
  return { ...entry, created: true };
}

export async function unregisterServer(projectRoot, name, { removeFolder = false } = {}) {
  const id = validateId(name);
  const registry = await readRegistry(projectRoot);
  const next = registry.servers.filter((server) => server.id !== id);
  const found = next.length !== registry.servers.length;
  if (found) await writeRegistry(projectRoot, { ...registry, servers: next });
  if (removeFolder) await rm(serverFolder(projectRoot, id), { recursive: true, force: true });
  return found;
}

export async function listServers(projectRoot = process.cwd()) { return (await readRegistry(projectRoot)).servers; }
export async function statusServers(projectRoot = process.cwd()) {
  const servers = await listServers(projectRoot);
  return Promise.all(servers.map(async (server) => {
    const folderOk = await stat(server.folder).then((info) => info.isDirectory()).catch(() => false);
    return { ...server, folderOk, status: folderOk ? 'ready' : 'missing' };
  }));
}
export async function registryScaffoldExists(projectRoot, id) {
  const folder = serverFolder(projectRoot, id);
  const required = ['package.json', 'server.js', 'README.md', 'AGENTS.md', 'settings.json', 'public/index.html', 'public/app.js', 'public/styles.css', 'public/favicon.ico'];
  for (const path of required) if (!existsSync(join(folder, path))) return false;
  return true;
}
