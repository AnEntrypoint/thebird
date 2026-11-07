import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Tab: { code: 'Tab', keyCode: 9 },
  c: { code: 'KeyC', keyCode: 67 },
  a: { code: 'KeyA', keyCode: 65 },
  e: { code: 'KeyE', keyCode: 69 },
  l: { code: 'KeyL', keyCode: 76 },
  u: { code: 'KeyU', keyCode: 85 },
};

export async function runTerminal({ chrome, profile, url, timeoutMs = 120000, interact }) {
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
    const logs = [];
    const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
      const id = nextId++;
      waiting.set(id, { ok, fail });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const onEvent = ({ method, params = {}, sessionId: from }) => {
      if (method === 'Target.attachedToTarget') {
        if (['worker', 'service_worker', 'shared_worker'].includes(params.targetInfo.type)) {
          send('Runtime.enable', {}, params.sessionId).catch(() => {});
          send('Log.enable', {}, params.sessionId).catch(() => {});
        }
        return;
      }
      const origin = from ? 'worker' : 'page';
      if (method === 'Runtime.consoleAPICalled') logs.push(`${origin} console.${params.type}: ${params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`);
      else if (method === 'Runtime.exceptionThrown') logs.push(`${origin} exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      else if (method === 'Log.entryAdded') logs.push(`${origin} log ${params.entry.level}: ${params.entry.text} ${params.entry.url ?? ''}`);
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === undefined) return onEvent(message);
      const pending = waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id);
      if (message.error) pending.fail(new Error(message.error.message));
      else pending.ok(message.result);
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
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
    if (interact) {
      const waitFor = async (expression, limit = timeoutMs) => {
        const deadline = Date.now() + limit;
        while (!(await evaluate(expression))) {
          if (Date.now() > deadline) throw new Error('timed out waiting for: ' + expression);
          await sleep(100);
        }
      };
      const press = async (key, { ctrl = false } = {}) => {
        const spec = KEYS[key];
        const base = { key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, modifiers: ctrl ? 2 : 0 };
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: spec.text }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
      };
      const type = (text) => send('Input.insertText', { text }, sessionId);
      await interact({ evaluate, waitFor, press, type });
    }
    const state = { logs, ...(await evaluate("({ engine: document.body.dataset.engine, out: document.getElementById('out').textContent, spans: [...document.querySelectorAll('#out span')].map((span) => ({ cls: span.className, text: span.textContent })) })")) };
    await send('Browser.close').catch(() => {});
    socket.close();
    await Promise.race([once(child, 'exit'), sleep(10000)]);
    return state;
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
}
