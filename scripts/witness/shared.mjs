import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer as createNetServer } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { startNpmMirror } from '../npm-mirror.mjs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRelay } from '../../src/relay.js';
import { closeBrowserTree, closeBrowserTrees, runTerminal, startBrowser, withTimeout } from '../browser-driver.mjs';
import { vendorBashkit } from '../vendor-bashkit.mjs';
import { vendorFx } from '../vendor-fx.mjs';
import { vendorFloosie } from '../vendor-floosie.mjs';
import { buildPages } from '../build-pages.mjs';
import { startFxStubGateway, FX_STUB_KEY } from '../fx-stub-gateway.mjs';
import { PAGE_HOST_TOOL_NAMES } from '../../web/fx-host-tools.js';

export const PAGE_TOOLS = [...PAGE_HOST_TOOL_NAMES].sort();
export const FX_TUI_TOOLS = [...PAGE_TOOLS, 'shell'].sort();

export const reapBrowserTrees = (reason) => {
  const closed = closeBrowserTrees();
  console.log(`browser cleanup (${reason}): closed ${closed.length} Chromium tree(s)${closed.length ? ' by pid ' + closed.join(', ') : ''}`);
};
process.on('exit', () => reapBrowserTrees('exit'));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1)));
process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(1);
});

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GROUP_BUDGET_MS = 2700000;
export const COLD_START_MS = GROUP_BUDGET_MS - 120000;
export const JOBS = Math.max(1, Number(process.env.THEBIRD_WITNESS_JOBS ?? 3));
export const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
export const haveChrome = existsSync(chrome);
export const scope = new AsyncLocalStorage();
export const groups = [];
export const services = new Map();
export const shared = (name, make) => {
  if (!services.has(name)) services.set(name, make());
  return services.get(name);
};
export const getRelay = () => shared('relay', () => startRelay({ port: 0 }));
export const getMirror = () => shared('npm-mirror', () => startNpmMirror());
export const scratchDirs = new Set();
export const scratchDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.add(dir);
  return dir;
};
process.on('exit', () => { for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true }); });
export const sharedPages = () => shared('pages', () => buildPages(scratchDir('thebird-site-')));
export const current = () => scope.getStore();
export const group = (name, run) => groups.push({ name, run, source: run.toString(), browser: /\b(terminal|runAt)\(/.test(run.toString()), heavy: /python3|\bpip\b|pyodide/.test(run.toString()) });
export let heavyTail = Promise.resolve();
export const runHeavy = (entry) => {
  const next = heavyTail.then(() => runGroup(entry));
  heavyTail = next.catch(() => {});
  return next;
};

export function check(name, ok, detail = '') {
  const passed = Boolean(ok);
  current().results.push({ name, ok: passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

export const dotenvValue = (key) => {
  const file = join(root, '.env');
  const line = existsSync(file) ? readFileSync(file, 'utf8').split('\n').find((text) => text.startsWith(key + '=')) : undefined;
  return line?.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
};
export const listening = (port) => new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const freeModels = () => fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(30000) }).then((res) => res.json()).then((body) => body.data.map((model) => model.id).filter((id) => id.endsWith(':free'))).catch(() => []);
export const LIVE_UNAVAILABLE = 'needs a live provider: OPENROUTER_KEY is unset, and nothing listens on 127.0.0.1:8793 (the repo does not start that gateway)';
export const liveProvider = async () => {
  const openrouterKey = process.env.OPENROUTER_KEY ?? dotenvValue('OPENROUTER_KEY');
  if (openrouterKey) return { url: OPENROUTER_URL, key: openrouterKey, models: await freeModels() };
  if (!(await listening(8793))) return null;
  const key = process.env.THEBIRD_LIVE_FX_KEY ?? JSON.parse(readFileSync('/config/.fx/settings.json', 'utf8')).providers?.gy4?.auth?.key;
  return { url: 'http://127.0.0.1:8793/v1/chat/completions', key, models: ['claude-hy4[1m]'] };
};
export const skip = (name, reason) => {
  current().results.push({ name, ok: null, skipped: true });
  console.log('SKIP ' + name + ' — ' + reason);
};
export const skipLive = (names, reason) => names.map((name) => skip(name, reason));
export const providerVerdict = async (live) => {
  if (live.models.length === 0) return { verdict: 'skip', detail: 'no free OpenRouter model is listed' };
  for (const model of live.models) {
    let res;
    try {
      res = await fetch(live.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + live.key }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }), signal: AbortSignal.timeout(120000) });
    } catch (error) {
      return { verdict: 'fail', detail: 'no answer from ' + live.url + ' (' + error.name + ')' };
    }
    if (res.status === 429) continue;
    const body = await res.json().catch(() => null);
    if (res.ok && body?.choices?.length) return { verdict: 'ok', detail: '', model };
    if (res.status === 403 && body?.error?.metadata?.scope === 'key_limit') return { verdict: 'skip', detail: 'OpenRouter key is over its limit' + (body.error.metadata.limit_usd === undefined ? '' : ' of $' + body.error.metadata.limit_usd) + ' (HTTP 403 key_limit)' };
    return { verdict: 'fail', detail: 'HTTP ' + res.status + ' ' + (body?.error?.metadata?.scope ?? 'body not as expected') };
  }
  return { verdict: 'skip', detail: 'every free model is rate limited (HTTP 429 from ' + live.models.length + ' of ' + live.models.length + ')' };
};
export const liveVerdict = (ok, detail) => (ok ? 'pass' : /\b429\b/.test(detail) ? 'skip' : 'fail');
export const liveCheck = (name, ok, detail) => (liveVerdict(ok, detail) === 'skip' ? skip(name, 'the free OpenRouter model answered HTTP 429 inside the page') : check(name, ok, detail));
export const liveRun = async (names) => {
  const live = await liveProvider();
  if (!live) {
    skipLive(names, LIVE_UNAVAILABLE);
    return null;
  }
  const verdict = await providerVerdict(live);
  if (verdict.verdict === 'skip') {
    skipLive(names, verdict.detail);
    return null;
  }
  if (verdict.verdict === 'fail') {
    for (const name of names) check(name, false, verdict.detail);
    return null;
  }
  return { ...live, model: verdict.model };
};
export let sharedProfile = null;
export const profileDir = () => (sharedProfile ??= scratchDir('thebird-profile-shared-'));
export const DEFAULT_CONTEXT_GROUPS = new Set(['pip']);
export let sharedBrowserStart = null;
export const sharedBrowserFor = () => {
  sharedBrowserStart ??= startBrowser({ chrome, profile: profileDir() });
  return sharedBrowserStart;
};
export async function disposeContext(context) {
  if (!context.browserContextId || !sharedBrowserStart) return;
  const browser = await sharedBrowserStart;
  await browser.send('Target.disposeBrowserContext', { browserContextId: context.browserContextId }).catch(() => {});
  context.browserContextId = null;
}
export async function browserFor(restart) {
  const context = current();
  if (restart === 'fresh') await disposeContext(context);
  const browser = await sharedBrowserFor();
  if (!context.browserContextId && !DEFAULT_CONTEXT_GROUPS.has(context.name)) {
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    context.browserContextId = browserContextId;
  }
  return browser;
}

export async function runAt(url, { restart = false, interact, initScript, blockUrls, timeoutMs = COLD_START_MS, label = 'page' } = {}) {
  const started = performance.now();
  const browser = await browserFor(restart);
  try {
    return await runTerminal({ browser, browserContextId: current().browserContextId, url, timeoutMs, interact, initScript, blockUrls });
  } finally {
    console.log(`TERMINAL ${current().name} ${label} wall ${((performance.now() - started) / 1000).toFixed(1)}s`);
  }
}

export async function terminal(pairs, options = {}) {
  const { params = [], ...rest } = options;
  const relay = await getRelay();
  const url = relay.url + '?' + new URLSearchParams([...pairs, ...params]).toString();
  return runAt(url, { ...rest, label: pairs[0]?.[1]?.slice(0, 40) ?? 'interact' });
}

export const freePort = () => new Promise((resolve) => {
  const probe = createNetServer().listen(0, '127.0.0.1', () => {
    const chosen = probe.address().port;
    probe.close(() => resolve(chosen));
  });
});

export const spawnedPids = new Set();
export const trackPid = (pid) => { spawnedPids.add(pid); return pid; };
export const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
export async function stopPid(pid) {
  if (!alive(pid)) return;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive(pid)) process.kill(pid, 'SIGKILL');
}

export const binRunner = (name) => (...args) => spawnSync(process.execPath, [join(root, 'bin', name + '.js'), ...args], { cwd: root, encoding: 'utf8', timeout: 300000 });
export const webserverCli = binRunner('thebird-webserver');
export const webhostCli = binRunner('thebird-web-host');
export const craftCli = binRunner('thebird-craft');

export async function pollAnswer(url, everyMs = 500) {
  const deadline = Date.now() + 120000;
  let answer = { status: 'no answer', headers: null };
  while (answer.status === 'no answer' && Date.now() < deadline) {
    answer = await fetch(url).then((res) => ({ status: 'HTTP ' + res.status, headers: res.headers }), () => ({ status: 'no answer', headers: null }));
    if (answer.status === 'no answer') await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return answer;
}

export async function serveThenStop({ script, args, port, path = '/', signal = 'SIGTERM' }) {
  const child = spawn(process.execPath, [join(root, script), ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  trackPid(child.pid);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code, sig) => resolve({ code, signal: sig })));
  const answer = await pollAnswer(`http://127.0.0.1:${port}${path}`);
  child.kill(signal);
  return { answer, out, ended: await exited };
}

export const loadAverage = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
export const within = (promise, ms, name) => {
  let timer;
  return Promise.race([promise, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`${name} exceeded its ${ms} ms budget`)), ms); })]).finally(() => clearTimeout(timer));
};

export async function runGroup(entry) {
  const context = { name: entry.name, results: [], browserContextId: null };
  const started = performance.now();
  const loadBefore = loadAverage();
  console.log(`START ${entry.name}${entry.heavy ? ' (heavy)' : ''} load ${loadBefore}`);
  try {
    await within(scope.run(context, entry.run), GROUP_BUDGET_MS, entry.name);
  } catch (error) {
    context.results.push({ name: `${entry.name} raised an error`, ok: false });
    console.log(`FAIL ${entry.name} raised an error: ${error.message}`);
  } finally {
    await disposeContext(context);
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(`GROUP ${entry.name} wall ${seconds.toFixed(1)}s load ${loadBefore} -> ${loadAverage()}`);
  return { name: entry.name, seconds, results: context.results };
}

export const TUI_SCREEN = `(() => { const b = globalThis.thebird.term.buffer.active; const rows = []; for (let i = 0; i < b.length; i++) rows.push(b.getLine(i).translateToString(true)); return rows.join('\\n'); })()`;
export const TUI_STATE = `JSON.stringify((() => { const t = globalThis.thebird.term; const b = t.buffer.active; return { cols: t.cols, rows: t.rows, alt: b.type, cursorX: b.cursorX, cursorY: b.cursorY, tui: document.body.dataset.tui ?? null }; })())`;
export const TUI_TITLE = `JSON.stringify((() => { const b = globalThis.thebird.term.buffer.active; for (let y = 0; y < b.length; y++) { const line = b.getLine(y); if (line.translateToString(true).includes('v0.0.16')) return [0, 2].map((x) => { const c = line.getCell(x); return { x, fg: c.getFgColor(), palette: c.isFgPalette(), bold: !!c.isBold() }; }); } return null; })())`;
export const TUI_RESIZE_SETTLED = `globalThis.thebird.term.cols === 70 && globalThis.thebird.term.rows === 24 && globalThis.thebird.text().split('\\n').some((line) => /^─{70}$/.test(line))`;
export const TUI_PALETTE_RESIZE_SETTLED = `(() => { const t = globalThis.thebird.term; const b = t.buffer.active; if (t.cols !== 70 || t.rows !== 24) return false; for (let i = 0; i < b.length; i++) if ([...b.getLine(i).translateToString(true)].length > 70) return false; return globalThis.thebird.text().split('\\n').some((line) => line.startsWith('┃')); })()`;
export const GRAPHEMES = 'é \u{1F44D}\u{1F3FD} \u{1F468}‍\u{1F469}‍\u{1F467}';










export async function startChatStub(reply) {
  const requests = [];
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return res.writeHead(404).end();
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ authorization: req.headers.authorization ?? null, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'chat-1', choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, requests, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}


export const startProviderStub = (status, body) => new Promise((resolve, reject) => {
  const source = "const http = require('node:http'); const [status, body] = process.argv.slice(1); http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(Number(status), { 'content-type': 'application/json' }); res.end(body); }); }).listen(0, '127.0.0.1', function () { console.log(this.address().port); });";
  const child = spawn(process.execPath, ['-e', source, String(status), JSON.stringify(body)], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.once('error', reject);
  child.stdout.once('data', (chunk) => resolve({
    pid: child.pid,
    url: 'http://127.0.0.1:' + String(chunk).trim() + '/v1/chat/completions',
    stop: () => new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once('exit', done);
      child.kill('SIGTERM');
    }),
  }));
});


































export const registryNet = (logs) => {
  const ids = new Set(logs.filter((line) => line.startsWith('worker net-') && line.includes('https://registry.npmjs.org/')).map((line) => line.split(' ')[2]));
  return { requests: ids.size, lines: logs.filter((line) => line.startsWith('worker net-') && ids.has(line.split(' ')[2])).slice(0, 30), failed: logs.filter((line) => /^(worker|page) net-failed/.test(line)).slice(0, 10) };
};

























export const SITE_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' };
export async function servePages({ manifestFailures = 0 } = {}) {
  const pagesDir = await sharedPages();
  const served = { manifest: 0 };
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/thebird/thebird-package.json') {
      served.manifest++;
      if (served.manifest <= manifestFailures) {
        res.writeHead(503).end();
        return;
      }
    }
    const rest = pathname.startsWith('/thebird/') ? pathname.slice('/thebird/'.length) || 'index.html' : null;
    const file = rest === null ? null : join(pagesDir, rest);
    if (!file || !file.startsWith(pagesDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': SITE_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { dir: pagesDir, url: `http://127.0.0.1:${server.address().port}/thebird/`, served, close: () => server.close() };
}





export async function fetchWithFallback(urls) {
  let failure = null;
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetch(url, { signal: AbortSignal.timeout(60000) });
      } catch (error) {
        failure = error;
      }
    }
  }
  throw failure;
}













