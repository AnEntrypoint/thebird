import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_BIN ?? '/data/cache/bin/chromium';
const url = process.argv[2];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const profile = await mkdtemp(join(tmpdir(), 'thebird-host-dom-'));
const child = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (data) => { stderr += data; });
try {
  let portFile;
  for (let i = 0; i < 300; i++) {
    try {
      portFile = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!portFile) throw new Error('DevToolsActivePort missing');
  const [port] = portFile.split('\n');
  let target;
  for (let i = 0; i < 300; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      target = targets.find((entry) => entry.type === 'page' && entry.url.includes('127.0.0.1'));
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target) throw new Error('no page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    socket.addEventListener('open', ok, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let id = 0;
  const evaluate = (expression) => new Promise((ok) => {
    const current = ++id;
    const onMessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== current) return;
      socket.removeEventListener('message', onMessage);
      ok(message.result?.result?.value ?? '');
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id: current, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  let dom = '';
  let ready = false;
  for (let i = 0; i < 240; i++) {
    dom = await evaluate('document.documentElement.outerHTML');
    ready = dom.includes('data-boot="ready"') && dom.includes('data-engine="ready"') && dom.includes('data-feature-program="ready"') && dom.includes('data-feature-count="5"');
    if (ready) break;
    await sleep(250);
  }
  process.stdout.write(dom);
  if (!ready) {
    process.stderr.write(`DOM did not reach runtime readiness\n${stderr}`);
    process.exitCode = 1;
  }
  socket.close();
} catch (error) {
  process.stderr.write(`${error.message}\n${stderr}`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
