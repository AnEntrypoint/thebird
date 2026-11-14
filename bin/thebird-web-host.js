#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_ROOT, resolveSiteRoot, startWebHost } from '../src/web-host.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(projectRoot, '.thebird', 'web-host');
const argv = process.argv.slice(2);
const action = argv[0] ?? 'start';
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const host = option('host', DEFAULT_HOST);
const port = Number(option('port', DEFAULT_PORT));
const root = option('root', DEFAULT_ROOT);
const isolated = argv.includes('--no-isolation') ? false : true;
const siteRoot = resolveSiteRoot(root, projectRoot);
const identity = createHash('sha256').update(`${host}\0${port}\0${siteRoot}`).digest('hex').slice(0, 12);
const pidFile = join(stateDir, `${identity}.pid`);
const logFile = join(stateDir, `${identity}.log`);
const url = `http://${host}:${port}/`;

const record = async () => {
  try {
    return JSON.parse(await readFile(pidFile, 'utf8'));
  } catch {
    return null;
  }
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ownsRecord = async (entry) => {
  if (!entry || !alive(entry.pid)) return false;
  try {
    const environ = await readFile(`/proc/${entry.pid}/environ`, 'utf8');
    return environ.split('\0').includes(`THEBIRD_WEB_HOST_TAG=${identity}`);
  } catch {
    return false;
  }
};

const removeRecord = async () => {
  await rm(pidFile, { force: true });
  await rm(logFile, { force: true });
};

const waitForUrl = async (timeoutMs = 5000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return true;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return false;
};

if (action === 'serve') {
  const server = await startWebHost({ host, port, root: siteRoot, isolated, projectRoot });
  console.log(`thebird web host listening on ${server.url}`);
  console.log(`site root: ${server.root}`);
  console.log(`isolation: ${server.isolated ? 'coop-coep' : 'plain'}`);
  console.log(`pid: ${process.pid}`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else if (action === 'start') {
  const existing = await record();
  if (await ownsRecord(existing)) {
    console.log(`thebird web host already running on ${existing.url}`);
    console.log(`pid: ${existing.pid}`);
    process.exit(0);
  }
  await removeRecord();
  await mkdir(stateDir, { recursive: true });
  const log = await (await import('node:fs/promises')).open(logFile, 'w');
  const childArgs = [join(projectRoot, 'bin', 'thebird-web-host.js'), 'serve', '--host', host, '--port', String(port), '--root', siteRoot];
  if (!isolated) childArgs.push('--no-isolation');
  const child = spawn(process.execPath, childArgs, {
    cwd: projectRoot,
    detached: true,
    env: { ...process.env, THEBIRD_WEB_HOST_TAG: identity },
    stdio: ['ignore', log.fd, log.fd],
  });
  child.unref();
  await log.close();
  const ready = await waitForUrl();
  if (!ready) {
    console.error(`web host failed to answer ${url}; see ${logFile}`);
    process.exit(1);
  }
  await writeFile(pidFile, `${JSON.stringify({ pid: child.pid, url, root: siteRoot, identity, startedAt: new Date().toISOString() })}\n`);
  console.log(`thebird web host listening on ${url}`);
  console.log(`site root: ${siteRoot}`);
  console.log(`isolation: ${isolated ? 'coop-coep' : 'plain'}`);
  console.log(`pid: ${child.pid}`);
  console.log(`log: ${logFile}`);
} else if (action === 'stop') {
  const entry = await record();
  if (!(await ownsRecord(entry))) {
    console.log('no managed web host is running');
    await removeRecord();
    process.exit(0);
  }
  process.kill(entry.pid, 'SIGTERM');
  for (let i = 0; i < 50 && alive(entry.pid); i++) await new Promise((ok) => setTimeout(ok, 100));
  await removeRecord();
  console.log(`stopped web host pid ${entry.pid}`);
} else if (action === 'status') {
  const entry = await record();
  if (await ownsRecord(entry)) {
    console.log(`running ${entry.url} pid ${entry.pid} root ${entry.root}`);
    process.exit(0);
  }
  console.log('stopped');
  process.exit(1);
} else if (action === 'check') {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();
  const isolatedCoop = response.headers.get('cross-origin-opener-policy') ?? '';
  const isolatedCoep = response.headers.get('cross-origin-embedder-policy') ?? '';
  console.log(`status ${response.status} ${url}`);
  console.log(`content-type ${type}`);
  console.log(`coop ${isolatedCoop}`);
  console.log(`coep ${isolatedCoep}`);
  console.log(`html ${body.includes('<html') || body.includes('<!doctype html')}`);
  if (!response.ok || !type.startsWith('text/html')) process.exitCode = 1;
} else {
  console.error(`usage: node bin/thebird-web-host.js [start|stop|status|check] [--host 127.0.0.1] [--port 4173] [--root _site] [--no-isolation]`);
  process.exit(2);
}
