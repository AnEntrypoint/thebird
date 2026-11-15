import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startWebHost } from '../src/web-host.js';
import { createSupervisor } from '../src/app-supervisor.js';
import { registerServer, serverFolder } from '../src/webserver-registry.js';

const SITE_FILES = ['web/features.json', 'web/features.js', 'web/features-bridge.js', 'web/features-in-txiki.js', 'web/features-program.js', 'web/vendor/txiki/tjs.wasm'];
const APP_TIMEOUT_MS = 60000;

const appSource = (id) => `import { createServer } from 'node:http';
const server = createServer((req, res) => res.end('app ' + ${JSON.stringify(id)} + ' ' + req.url));
server.on('upgrade', (req, socket) => socket.end('HTTP/1.1 101 Switching Protocols\\r\\nconnection: Upgrade\\r\\nupgrade: websocket\\r\\n\\r\\n'));
server.listen(Number(process.env.PORT), process.env.HOST);
`;
const brokenSource = 'process.exit(3);\n';
const quietSource = 'setInterval(() => {}, 1000);\n';

const makeSite = async (dir) => {
  const root = join(dir, 'site');
  for (const file of SITE_FILES) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), '');
  }
  return root;
};

const registerApp = async (dir, id, source) => {
  await registerServer(dir, id);
  const folder = serverFolder(dir, id);
  if (source === null) await unlink(join(folder, 'server.js'));
  else await writeFile(join(folder, 'server.js'), source);
  const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  delete pkg.dependencies;
  delete pkg.scripts;
  await writeFile(join(folder, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
};

const rpc = (host, method, params) => fetch(new URL('/__thebird/mcp/thebird', host.url), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
}).then((response) => response.json());

const registrySnapshot = async (host) => (await fetch(new URL('/__thebird/registry', host.url))).json();

const portsOf = async (host) => {
  const reply = await rpc(host, 'tools/call', { name: 'thebird_ports', arguments: {} });
  return JSON.parse(reply.result.content[0].text).apps;
};

let dir;
let host;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'web-host-apps-'));
  await makeSite(dir);
  await registerApp(dir, 'demo', appSource('demo'));
  await registerApp(dir, 'broken', brokenSource);
  await registerApp(dir, 'static', null);
  host = await startWebHost({ host: '127.0.0.1', port: 0, root: 'site', cwd: dir, projectRoot: dir, isolated: true });
});

after(async () => {
  await host?.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

test('the registry reports an unstarted app as idle', { timeout: APP_TIMEOUT_MS }, async () => {
  const snapshot = await registrySnapshot(host);
  const demo = snapshot.servers.find((server) => server.id === 'demo');
  assert.deepEqual(demo.app, { state: 'idle', port: null });
});

test('GET /sites/<id>/ proxies to the supervised app with isolation headers', { timeout: APP_TIMEOUT_MS }, async () => {
  const response = await fetch(new URL('/sites/demo/', host.url));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'app demo /');
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
});

test('the registry reports the running app and its port', { timeout: APP_TIMEOUT_MS }, async () => {
  const snapshot = await registrySnapshot(host);
  const demo = snapshot.servers.find((server) => server.id === 'demo');
  assert.equal(demo.app.state, 'running');
  assert.ok(Number.isInteger(demo.app.port) && demo.app.port > 0);
});

test('GET /sites/<id> without a slash redirects with 308', { timeout: APP_TIMEOUT_MS }, async () => {
  const response = await fetch(new URL('/sites/demo?x=1', host.url), { redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/sites/demo/?x=1');
});

test('thebird_ports lists the running app with its pid', { timeout: APP_TIMEOUT_MS }, async () => {
  const apps = await portsOf(host);
  const demo = apps.find((app) => app.id === 'demo');
  assert.equal(demo.state, 'running');
  assert.ok(Number.isInteger(demo.pid) && demo.pid > 0);
});

test('an unregistered id answers 404 and a registered id without server.js keeps the static fallback', { timeout: APP_TIMEOUT_MS }, async () => {
  const ghost = await fetch(new URL('/sites/ghost/', host.url));
  assert.equal(ghost.status, 404);
  const fallback = await fetch(new URL('/sites/static/', host.url));
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get('content-type'), /^text\/html/);
});

test('an app that exits before it is ready answers 503 naming the id', { timeout: APP_TIMEOUT_MS }, async () => {
  const response = await fetch(new URL('/sites/broken/', host.url));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /broken/);
});

test('upgrade requests under /sites/<id>/ reach the app', { timeout: APP_TIMEOUT_MS }, async () => {
  const upgrade = request({ host: '127.0.0.1', port: host.port, path: '/sites/demo/socket', headers: { connection: 'Upgrade', upgrade: 'websocket' } });
  upgrade.end();
  const [response, socket] = await once(upgrade, 'upgrade');
  assert.equal(response.statusCode, 101);
  socket.destroy();
});

test('close stops the supervised app process', { timeout: APP_TIMEOUT_MS }, async () => {
  const demo = (await portsOf(host)).find((app) => app.id === 'demo');
  await host.close();
  assert.throws(() => process.kill(demo.pid, 0));
});

test('a Node app that never listens ends in the failed state', { timeout: APP_TIMEOUT_MS }, async (t) => {
  const quietDir = await mkdtemp(join(tmpdir(), 'web-host-quiet-'));
  t.after(() => rm(quietDir, { recursive: true, force: true }));
  await registerApp(quietDir, 'quiet', quietSource);
  const supervisor = createSupervisor({ projectRoot: quietDir, readyTimeoutMs: 800, log: () => {} });
  t.after(() => supervisor.stopAll());
  await assert.rejects(supervisor.ensure('quiet'), /did not answer on 127\.0\.0\.1:\d+ within 800 ms/);
  const [entry] = supervisor.status();
  assert.equal(entry.id, 'quiet');
  assert.equal(entry.state, 'failed');
  assert.match(entry.error, /did not answer/);
});
