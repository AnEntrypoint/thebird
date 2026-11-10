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
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  c: { code: 'KeyC', keyCode: 67 },
  o: { code: 'KeyO', keyCode: 79 },
  a: { code: 'KeyA', keyCode: 65 },
  e: { code: 'KeyE', keyCode: 69 },
  l: { code: 'KeyL', keyCode: 76 },
  u: { code: 'KeyU', keyCode: 85 },
};

const CDP_TIMEOUT_MS = 60000;

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, fail) => {
      timer = setTimeout(() => fail(new Error(`${label} did not answer within ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const startedTrees = new Map();

export function closeBrowserTrees() {
  const closed = [];
  for (const [pid, child] of startedTrees) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    killGroup(child);
    closed.push(pid);
  }
  startedTrees.clear();
  return closed;
}

export async function runTerminal({ chrome, profile, url, timeoutMs = 120000, interact, blockUrls = [], onProgress, trace, replay, initScript }) {
  if (replay) {
    await replayTerminal({ replay, interact, timeoutMs });
    return replay.state;
  }
  rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  const child = spawn(chrome, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  startedTrees.set(child.pid, child);
  child.once('exit', () => startedTrees.delete(child.pid));

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
    const send = (method, params = {}, sessionId) => withTimeout(new Promise((ok, fail) => {
      const id = nextId++;
      waiting.set(id, { ok, fail });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    }), CDP_TIMEOUT_MS, method);
    const blockRequests = (sessionId) => {
      if (blockUrls.length === 0) return;
      send('Network.enable', {}, sessionId).catch(() => {});
      send('Network.setBlockedURLs', { urls: blockUrls }, sessionId).catch(() => {});
    };
    const onEvent = ({ method, params = {}, sessionId: from }) => {
      if (method === 'Target.attachedToTarget') {
        if (['worker', 'service_worker', 'shared_worker'].includes(params.targetInfo.type)) {
          send('Runtime.enable', {}, params.sessionId).catch(() => {});
          send('Log.enable', {}, params.sessionId).catch(() => {});
          blockRequests(params.sessionId);
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
    if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    blockRequests(sessionId);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    await send('Page.navigate', { url }, sessionId);

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      return result.result?.value;
    };
    const until = Date.now() + timeoutMs;
    while (!(await evaluate("document.body && document.body.dataset.done === 'true'"))) {
      if (Date.now() > until) throw new Error('terminal did not finish: ' + url);
      if (onProgress) onProgress(await evaluate("globalThis.thebird ? globalThis.thebird.text() : ''"));
      await sleep(300);
    }
    if (interact) {
      const traced = (entry) => trace?.push(entry);
      await interact(driverFor({
        evaluate: async (expression) => {
          const value = await evaluate(expression);
          traced({ kind: 'eval', expression, value });
          return value;
        },
        press: async (key, { ctrl = false } = {}) => {
          const spec = KEYS[key];
          const base = { key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, modifiers: ctrl ? 2 : 0 };
          await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: spec.text }, sessionId);
          await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
          traced({ kind: 'press', key, ctrl });
        },
        type: async (text) => {
          await send('Input.insertText', { text }, sessionId);
          traced({ kind: 'type', text });
        },
        note: async (name, read) => {
          const value = read();
          traced({ kind: 'note', name, value });
          return value;
        },
        pause: () => sleep(100),
        limit: timeoutMs,
      }));
    }
    const state = { logs, ...(await evaluate("({ engine: document.body.dataset.engine, out: globalThis.thebird.text() })")) };
    await send('Browser.close').catch(() => {});
    socket.close();
    await Promise.race([once(child, 'exit'), sleep(10000)]);
    return state;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      killGroup(child);
      await Promise.race([once(child, 'exit'), sleep(10000)]);
    }
    killGroup(child);
  }
}

function driverFor({ evaluate, press, type, note, pause, limit }) {
  const waitFor = async (expression, wait = limit) => {
    const deadline = Date.now() + wait;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) throw new Error('timed out waiting for: ' + expression);
      await pause();
    }
  };
  return { evaluate, waitFor, press, type, note, pause };
}

async function replayTerminal({ replay, interact, timeoutMs }) {
  let step = 0;
  const take = (probe) => {
    const entry = replay.trace[step++];
    if (!entry || Object.keys(probe).some((key) => entry[key] !== probe[key])) {
      throw new Error(`checkpoint replay diverged at step ${step}: expected ${JSON.stringify(probe)}`);
    }
    return entry;
  };
  if (!interact) return;
  await interact(driverFor({
    evaluate: async (expression) => take({ kind: 'eval', expression }).value,
    press: async (key, { ctrl = false } = {}) => {
      take({ kind: 'press', key, ctrl });
    },
    type: async (text) => {
      take({ kind: 'type', text });
    },
    note: async (name) => take({ kind: 'note', name }).value,
    pause: async () => {},
    limit: timeoutMs,
  }));
  if (step !== replay.trace.length) throw new Error(`checkpoint replay left ${replay.trace.length - step} steps unused`);
}

function killGroup(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
