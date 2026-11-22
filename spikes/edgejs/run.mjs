import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBrowser } from '../../scripts/browser-driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pin = JSON.parse(readFileSync(join(here, 'pin.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'edgejs-spike-'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain', '.json': 'application/json' };
let browser = null;
let server = null;
const finish = async (code, report) => {
  console.log(JSON.stringify(report, null, 1));
  await browser?.close().catch(() => {});
  server?.close();
  rmSync(scratch, { recursive: true, force: true });
  console.log('EDGEJS_SPIKE_DONE ' + code);
  process.exit(code);
};
try {
  const pack = spawnSync('npm', ['pack', pin.sdk.name + '@' + pin.sdk.version, '--silent', '--pack-destination', scratch], { encoding: 'utf8' });
  const tarball = join(scratch, pack.stdout.trim());
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  if (digest !== pin.sdk.sha256) await finish(2, { error: 'sdk digest ' + digest + ' is not the pinned ' + pin.sdk.sha256 });
  spawnSync('tar', ['xzf', tarball, '-C', scratch]);
  const sdk = join(scratch, 'package');
  server = createServer((req, res) => {
    const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.startsWith('sdk/') ? join(sdk, path.slice(4)) : path === 'fetch.txt' ? null : join(here, path);
    const headers = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' };
    if (file === null) return res.writeHead(200, { ...headers, 'content-type': 'text/plain' }).end('spike-fetch-ok\n');
    let body;
    try {
      body = readFileSync(file);
    } catch {
      return res.writeHead(404, headers).end();
    }
    res.writeHead(200, { ...headers, 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/page.html?packages=' + encodeURIComponent(JSON.stringify(pin.packages));
  if (process.env.EDGEJS_SPIKE_DRY) {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const probes = await Promise.all(['/page.html', '/page.js', '/sdk/dist/index.js', '/sdk/pkg/wasmer_sdk_js_bg.wasm', '/fetch.txt'].map(async (path) => { const res = await fetch(origin + path); return [path, res.status, res.headers.get('cross-origin-opener-policy'), res.headers.get('cross-origin-embedder-policy')]; }));
    await finish(probes.every(([, status, opener, embedder]) => status === 200 && opener === 'same-origin' && embedder === 'require-corp') ? 0 : 1, { probes });
  }
  browser = await startBrowser({ chrome: process.env.CHROME_BIN ?? '/usr/bin/chromium-browser', profile: mkdtempSync(join(scratch, 'profile-')) });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => (await browser.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result?.value;
  const opened = performance.now();
  await browser.send('Page.navigate', { url }, sessionId);
  const deadline = Date.now() + Number(process.env.EDGEJS_SPIKE_TIMEOUT_MS ?? 1500000);
  let results = null;
  while (!results && Date.now() < deadline) {
    results = await evaluate('document.body?.dataset.result ?? null').catch(() => null);
    if (!results) await new Promise((ok) => setTimeout(ok, 1000));
  }
  const parsed = results ? JSON.parse(results) : [];
  const meets = (run) => run.result?.back === 'spike-fs-ok' && run.result?.timer === true && run.result?.status === 200 && run.result?.body === 'spike-fetch-ok';
  const report = {
    baselineBytes: statSync(join(root, pin.baseline)).size,
    sdkWasmBytes: statSync(join(sdk, 'pkg', 'wasmer_sdk_js_bg.wasm')).size,
    pageMs: Math.round(performance.now() - opened),
    timedOut: results === null,
    runs: parsed.map((run) => ({ ...run, meetsWitnesses: meets(run) })),
  };
  await finish(report.runs.length === pin.packages.length && report.runs.some(meets) ? 0 : 1, report);
} catch (error) {
  await finish(3, { error: String(error?.stack ?? error).slice(0, 600) });
}
