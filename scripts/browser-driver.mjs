import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function runTerminal({ chrome, profile, url, timeoutMs = 120000 }) {
  rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  const child = spawn(chrome, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const portFile = join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 30000;
    while (!existsSync(portFile)) {
      if (Date.now() > deadline) throw new Error('Chromium did not expose a DevTools port');
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');

    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((ok, fail) => {
      socket.onopen = ok;
      socket.onerror = () => fail(new Error('could not open the DevTools socket'));
    });

    let nextId = 1;
    const waiting = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const pending = waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id);
      if (message.error) pending.fail(new Error(message.error.message));
      else pending.ok(message.result);
    };
    const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
      const id = nextId++;
      waiting.set(id, { ok, fail });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url }, sessionId);

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      return result.result?.value;
    };
    const until = Date.now() + timeoutMs;
    while (!(await evaluate("document.body && document.body.dataset.done === 'true'"))) {
      if (Date.now() > until) throw new Error('terminal did not finish: ' + url);
      await sleep(300);
    }
    const state = await evaluate("({ engine: document.body.dataset.engine, out: document.getElementById('out').textContent })");
    socket.close();
    return state;
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
}
