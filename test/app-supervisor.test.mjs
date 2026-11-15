import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisor } from '../src/app-supervisor.js';
import { registerServer, serverFolder } from '../src/webserver-registry.js';

const fixture = `import { createServer } from 'node:http';
const server = createServer((req, res) => {
  if (req.url === '/exit') return res.end('bye', () => setTimeout(() => process.exit(0), 20));
  res.end('hello ' + process.pid);
});
server.listen(Number(process.env.PORT), process.env.HOST);
`;

const waitFor = async (predicate, ms = 10000) => {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('condition not met within ' + ms + ' ms');
    await new Promise((done) => setTimeout(done, 50));
  }
};

const demo = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'app-supervisor-'));
  await registerServer(dir, 'demo');
  const folder = serverFolder(dir, 'demo');
  await writeFile(join(folder, 'server.js'), fixture);
  const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  delete pkg.dependencies;
  await writeFile(join(folder, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const spawns = [];
  const supervisor = createSupervisor({
    projectRoot: dir,
    readyTimeoutMs: 15000,
    log: () => {},
    spawnApp: (command, args, options) => {
      spawns.push(command);
      return spawn(command, args, options);
    },
  });
  t.after(async () => {
    await supervisor.stopAll();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, folder, supervisor, spawns };
};

test('ensure starts the app on a loopback port and it answers', async (t) => {
  const { dir, supervisor } = await demo(t);
  const info = await supervisor.ensure('demo');
  assert.equal(info.id, 'demo');
  assert.equal(info.state, 'running');
  assert.ok(info.port > 0);
  assert.equal(info.url, 'http://127.0.0.1:' + info.port + '/');
  const response = await fetch(info.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /^hello \d+$/);
  assert.deepEqual(supervisor.status().map((entry) => [entry.id, entry.state]), [['demo', 'running']]);
  assert.equal(supervisor.port('demo'), info.port);
  assert.ok(existsSync(join(dir, '.thebird', 'app-logs', 'demo.log')));
});

test('concurrent ensure calls share one child', async (t) => {
  const { supervisor, spawns } = await demo(t);
  const [first, second] = await Promise.all([supervisor.ensure('demo'), supervisor.ensure('demo')]);
  assert.equal(first.pid, second.pid);
  assert.equal(first.port, second.port);
  assert.equal(spawns.length, 1);
});

test('stop kills the child the supervisor spawned', async (t) => {
  const { supervisor } = await demo(t);
  const info = await supervisor.ensure('demo');
  await supervisor.stop('demo');
  assert.throws(() => process.kill(info.pid, 0));
  assert.equal(supervisor.port('demo'), null);
  assert.equal(supervisor.status()[0].state, 'stopped');
  await assert.rejects(fetch(info.url));
});

test('an app that exits is marked stopped and the next ensure starts it again', async (t) => {
  const { supervisor } = await demo(t);
  const first = await supervisor.ensure('demo');
  await fetch(first.url + 'exit').then((response) => response.text()).catch(() => {});
  await waitFor(() => supervisor.status()[0].state === 'stopped');
  assert.equal(supervisor.port('demo'), null);
  const second = await supervisor.ensure('demo');
  assert.equal(second.state, 'running');
  assert.equal((await fetch(second.url)).status, 200);
});

test('an unknown id is rejected by name', async (t) => {
  const { supervisor } = await demo(t);
  await assert.rejects(supervisor.ensure('nope'), /nope/);
});

test('a registered folder without server.js is not a node app', async (t) => {
  const { folder, supervisor } = await demo(t);
  await rm(join(folder, 'server.js'));
  await assert.rejects(supervisor.ensure('demo'), /not a node app/);
  assert.equal(supervisor.status()[0].state, 'failed');
});
