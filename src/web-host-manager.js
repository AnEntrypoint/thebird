import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_ROOT, resolveSiteRoot } from './web-host.js';

const run = promisify(execFile);
const REQUIRED_SITE_FILES = ['web/features.json', 'web/features.js', 'web/features-bridge.js', 'web/features-in-txiki.js', 'web/features-program.js', 'web/vendor/txiki/tjs.wasm'];

async function newestSource(projectRoot) {
  let newest = 0;
  for (const dir of [join(projectRoot, 'web'), join(projectRoot, 'web', 'shims')]) {
    for (const name of await readdir(dir).catch(() => [])) {
      const info = await stat(join(dir, name)).catch(() => null);
      if (info?.isFile()) newest = Math.max(newest, info.mtimeMs);
    }
  }
  return newest;
}

export async function siteProblem(projectRoot, siteRoot) {
  for (const path of REQUIRED_SITE_FILES) {
    const present = await stat(join(siteRoot, path)).catch(() => null);
    if (!present?.isFile()) return path;
  }
  const built = await stat(join(siteRoot, 'thebird-package.json')).catch(() => null);
  if (!built) return 'thebird-package.json';
  if ((await newestSource(projectRoot)) > built.mtimeMs) return 'web sources newer than the site';
  return null;
}

export async function buildSite(projectRoot) {
  await run(process.execPath, [join(projectRoot, 'scripts', 'build-pages.mjs')], { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 });
}

const managed = ({ projectRoot, host = DEFAULT_HOST, port = DEFAULT_PORT, root = DEFAULT_ROOT, isolated = true }) => {
  const siteRoot = resolveSiteRoot(root, projectRoot);
  const identity = createHash('sha256').update(`${host}\0${port}\0${siteRoot}`).digest('hex').slice(0, 12);
  const stateDir = join(projectRoot, '.thebird', 'web-host');
  return {
    projectRoot,
    host,
    port,
    isolated,
    siteRoot,
    identity,
    url: `http://${host}:${port}/`,
    stateDir,
    pidFile: join(stateDir, `${identity}.pid`),
    logFile: join(stateDir, `${identity}.log`),
  };
};

const record = async (m) => {
  try {
    return JSON.parse(await readFile(m.pidFile, 'utf8'));
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

const ownsRecord = async (m, entry) => {
  if (!entry || !alive(entry.pid)) return false;
  try {
    const environ = await readFile(`/proc/${entry.pid}/environ`, 'utf8');
    return environ.split('\0').includes(`THEBIRD_WEB_HOST_TAG=${m.identity}`);
  } catch {
    return false;
  }
};

const removeRecord = async (m) => {
  await rm(m.pidFile, { force: true });
  await rm(m.logFile, { force: true });
};

const waitForUrl = async (url, timeoutMs = 5000) => {
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

export async function managedHostStatus(options) {
  const m = managed(options);
  const entry = await record(m);
  return (await ownsRecord(m, entry)) ? entry : null;
}

export async function startManagedHost(options) {
  const m = managed(options);
  const existing = await record(m);
  if (await ownsRecord(m, existing)) return { started: false, pid: existing.pid, url: existing.url, root: existing.root, log: m.logFile };
  const problem = await siteProblem(m.projectRoot, m.siteRoot);
  if (problem && m.isolated) throw new Error(`canonical site is stale or incomplete: ${problem} is missing; run node scripts/build-pages.mjs`);
  await removeRecord(m);
  await mkdir(m.stateDir, { recursive: true });
  const log = await open(m.logFile, 'w');
  const childArgs = [join(m.projectRoot, 'bin', 'thebird-web-host.js'), 'serve', '--host', m.host, '--port', String(m.port), '--root', m.siteRoot];
  if (!m.isolated) childArgs.push('--no-isolation');
  const child = spawn(process.execPath, childArgs, {
    cwd: m.projectRoot,
    detached: true,
    env: { ...process.env, THEBIRD_WEB_HOST_TAG: m.identity },
    stdio: ['ignore', log.fd, log.fd],
  });
  child.unref();
  await log.close();
  if (!(await waitForUrl(m.url))) throw new Error(`web host failed to answer ${m.url}; see ${m.logFile}`);
  await writeFile(m.pidFile, `${JSON.stringify({ pid: child.pid, url: m.url, root: m.siteRoot, identity: m.identity, startedAt: new Date().toISOString() })}\n`);
  return { started: true, pid: child.pid, url: m.url, root: m.siteRoot, log: m.logFile };
}

export async function stopManagedHost(options) {
  const m = managed(options);
  const entry = await record(m);
  if (!(await ownsRecord(m, entry))) {
    await removeRecord(m);
    return null;
  }
  process.kill(entry.pid, 'SIGTERM');
  for (let i = 0; i < 50 && alive(entry.pid); i++) await new Promise((ok) => setTimeout(ok, 100));
  await removeRecord(m);
  return entry.pid;
}
