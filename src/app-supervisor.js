import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { readRegistry, serverFolder } from './webserver-registry.js';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const exited = (child) => child.exitCode !== null || child.signalCode !== null;

const defaultFreePort = () => new Promise((ok, fail) => {
  const server = createServer();
  server.unref();
  server.on('error', fail);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => ok(port));
  });
});

const defaultSpawnApp = (command, args, options) => spawn(command, args, options);

const probe = (port) => new Promise((ok) => {
  const socket = connect({ host: '127.0.0.1', port });
  const finish = (reachable) => { socket.destroy(); ok(reachable); };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(1000, () => finish(false));
});

const signalGroup = (child, signal) => {
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
};

const terminate = (child) => new Promise((done) => {
  if (!child.pid || exited(child)) return done();
  const force = setTimeout(() => signalGroup(child, 'SIGKILL'), 3000);
  child.once('exit', () => { clearTimeout(force); done(); });
  signalGroup(child, 'SIGTERM');
});

const spawned = (child) => new Promise((ok, fail) => {
  child.once('spawn', ok);
  child.once('error', fail);
});

const appFolderFor = async (projectRoot, id) => {
  const registry = await readRegistry(projectRoot);
  if (!registry.servers.some((server) => server.id === id)) throw new Error('unknown webserver ' + id);
  const folder = serverFolder(projectRoot, id);
  if (!existsSync(join(folder, 'server.js'))) throw new Error(id + ' is not a node app: server.js is missing');
  return folder;
};

const needsInstall = (folder, pkg) => Object.keys(pkg.dependencies ?? {}).length > 0 && !existsSync(join(folder, 'node_modules'));

const install = (folder, id, fd) => new Promise((ok, fail) => {
  const child = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: folder, stdio: ['ignore', fd, fd] });
  child.once('error', fail);
  child.once('exit', (code) => (code === 0 ? ok() : fail(new Error('npm install failed for ' + id + ' with exit code ' + code))));
});

const launch = (folder, pkg, port, fd, spawnApp) => {
  const [command, args] = typeof pkg.scripts?.start === 'string' ? ['npm', ['start']] : ['node', ['server.js']];
  return spawnApp(command, args, { cwd: folder, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', fd, fd], detached: true });
};

const detach = (record) => {
  record.child = null;
  record.port = null;
  record.pid = null;
};

const infoOf = (record) => ({
  id: record.id,
  state: record.state,
  port: record.port,
  pid: record.pid,
  url: record.port ? 'http://127.0.0.1:' + record.port + '/' : null,
});

export function createSupervisor({ projectRoot = process.cwd(), freePort = defaultFreePort, spawnApp = defaultSpawnApp, log = (message) => console.error(message), readyTimeoutMs = 30000 } = {}) {
  const apps = new Map();
  const logPathFor = (id) => join(resolve(projectRoot), '.thebird', 'app-logs', id + '.log');

  const recordFor = (id) => {
    if (!apps.has(id)) apps.set(id, { id, state: 'stopped', port: null, pid: null, child: null, error: null, starting: null });
    return apps.get(id);
  };

  const attach = (record, child, port) => {
    record.child = child;
    record.port = port;
    record.pid = child.pid ?? null;
    child.on('error', (error) => log('[supervisor] ' + record.id + ' error: ' + error.message));
    child.once('exit', (code, signal) => {
      if (record.child !== child) return;
      detach(record);
      if (record.state === 'starting') {
        record.state = 'failed';
        record.error = record.id + ' exited before it was ready';
      } else {
        record.state = 'stopped';
      }
      log('[supervisor] ' + record.id + ' exited with ' + (signal ?? code));
    });
  };

  const waitReady = async (record, child, port) => {
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (record.child !== child || exited(child)) throw new Error(record.id + ' exited before it was ready');
      if (await probe(port)) return;
      if (Date.now() >= deadline) throw new Error(record.id + ' did not answer on 127.0.0.1:' + port + ' within ' + readyTimeoutMs + ' ms');
      await sleep(100);
    }
  };

  const start = async (record) => {
    const { id } = record;
    let child = null;
    record.state = 'starting';
    record.error = null;
    try {
      const folder = await appFolderFor(projectRoot, id);
      const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8').catch(() => '{}'));
      await mkdir(dirname(logPathFor(id)), { recursive: true });
      const fd = openSync(logPathFor(id), 'a');
      try {
        if (needsInstall(folder, pkg)) await install(folder, id, fd);
        const port = await freePort();
        child = launch(folder, pkg, port, fd, spawnApp);
        attach(record, child, port);
        await spawned(child);
        await waitReady(record, child, port);
      } finally {
        closeSync(fd);
      }
      record.state = 'running';
      log('[supervisor] ' + id + ' running on 127.0.0.1:' + record.port);
      return infoOf(record);
    } catch (error) {
      record.state = 'failed';
      record.error = error.message;
      if (child) {
        if (record.child === child) detach(record);
        await terminate(child);
      }
      throw error;
    }
  };

  const ensure = async (id) => {
    const record = recordFor(id);
    if (record.state === 'running') return infoOf(record);
    if (!record.starting) record.starting = start(record).finally(() => { record.starting = null; });
    return record.starting;
  };

  const stop = async (id) => {
    const record = apps.get(id);
    const child = record?.child;
    if (!child) return;
    detach(record);
    record.state = 'stopped';
    await terminate(child);
  };

  return {
    ensure,
    status: () => [...apps.values()].map((record) => ({ ...infoOf(record), ...(record.error ? { error: record.error } : {}) })),
    port: (id) => apps.get(id)?.port ?? null,
    stop,
    stopAll: async () => { await Promise.all([...apps.keys()].map(stop)); },
  };
}
