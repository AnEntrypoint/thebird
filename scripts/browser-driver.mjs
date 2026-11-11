import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const runDir = process.env.THEBIRD_BROWSER_RUN_DIR ?? join(tmpdir(), `thebird-browser-${process.pid}`);
const recordFile = join(runDir, 'chromium-trees.json');
const recorded = new Map();

const processTable = () => {
  const table = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      table.set(Number(entry), { ppid: Number(fields[1]), start: fields[19] });
    } catch {
      continue;
    }
  }
  return table;
};

const persist = () => {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(recordFile, JSON.stringify([...recorded].map(([pid, start]) => ({ pid, start })), null, 1));
};

const refresh = (seed) => {
  const table = processTable();
  const children = new Map();
  for (const [pid, { ppid }] of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  let changed = false;
  const queue = [];
  if (seed !== undefined) {
    if (table.has(seed) && !recorded.has(seed)) {
      recorded.set(seed, table.get(seed).start);
      changed = true;
    }
    queue.push(seed);
  } else {
    for (const [pid, start] of recorded) if (table.get(pid)?.start === start) queue.push(pid);
  }
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]) ?? []) {
      if (!recorded.has(child)) {
        recorded.set(child, table.get(child).start);
        changed = true;
      }
      queue.push(child);
    }
  }
  if (changed) persist();
};

export function recordBrowserTree(pid) {
  refresh(pid);
}

export function closeBrowserTrees() {
  const closed = [];
  const table = processTable();
  for (const [pid, start] of recorded) {
    if (table.get(pid)?.start !== start) continue;
    try {
      process.kill(pid, 'SIGKILL');
      closed.push(pid);
    } catch {
      continue;
    }
  }
  return closed;
}

export function closeBrowserTree(root) {
  const table = processTable();
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, { ppid }] of table) {
      if (tree.has(ppid) && !tree.has(pid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  const closed = [];
  for (const pid of tree) {
    if (!recorded.has(pid) || table.get(pid)?.start !== recorded.get(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
      closed.push(pid);
    } catch {
      continue;
    }
  }
  return closed;
}

process.on('exit', () => closeBrowserTrees());
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => process.exit(code));
}

export async function startBrowser({ chrome, profile }) {
  rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  const child = spawn(chrome, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  recordBrowserTree(child.pid);
  const poller = setInterval(() => refresh(), 500);
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
    const sessions = new Map();
    const owners = new Map();
    const send = (method, params = {}, sessionId) => withTimeout(new Promise((ok, fail) => {
      const id = nextId++;
      waiting.set(id, { ok, fail });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    }), CDP_TIMEOUT_MS, method);
    const blockRequests = (sessionId, blockUrls) => {
      if (blockUrls.length === 0) return;
      send('Network.enable', {}, sessionId).catch(() => {});
      send('Network.setBlockedURLs', { urls: blockUrls }, sessionId).catch(() => {});
    };
    const onEvent = ({ method, params = {}, sessionId: from }) => {
      if (method === 'Target.attachedToTarget') {
        const owner = sessions.get(owners.get(from) ?? from);
        if (owner && ['worker', 'service_worker', 'shared_worker'].includes(params.targetInfo.type)) {
          owners.set(params.sessionId, owners.get(from) ?? from);
          send('Runtime.enable', {}, params.sessionId).catch(() => {});
          send('Log.enable', {}, params.sessionId).catch(() => {});
          send('Network.enable', {}, params.sessionId).catch(() => {});
          blockRequests(params.sessionId, owner.blockUrls);
        }
        if (owner?.blockUrls.length) send('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {});
        return;
      }
      const owner = sessions.get(owners.has(from) ? owners.get(from) : from);
      if (!owner) return;
      const origin = owners.has(from) ? 'worker' : 'page';
      if (method === 'Runtime.consoleAPICalled') owner.logs.push(`${origin} console.${params.type}: ${params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`);
      else if (method === 'Runtime.exceptionThrown') owner.logs.push(`${origin} exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      else if (method === 'Network.requestWillBeSent') owner.logs.push(`${origin} net-request ${params.requestId} ${params.timestamp.toFixed(3)} ${params.request.url}`);
      else if (method === 'Network.responseReceived') owner.logs.push(`${origin} net-response ${params.requestId} ${params.timestamp.toFixed(3)} ${params.response.status} ${params.response.url}`);
      else if (method === 'Network.loadingFailed') owner.logs.push(`${origin} net-failed ${params.requestId} ${params.timestamp.toFixed(3)} ${params.errorText} ${params.blockedReason ?? ''}`);
      else if (method === 'Network.loadingFinished') owner.logs.push(`${origin} net-finished ${params.requestId} ${params.timestamp.toFixed(3)} ${params.encodedDataLength}`);
      else if (method === 'Log.entryAdded') owner.logs.push(`${origin} log ${params.entry.level}: ${params.entry.text} ${params.entry.url ?? ''}`);
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
    return {
      child,
      profile,
      send,
      sessions,
      blockRequests,
      async close() {
        clearInterval(poller);
        await send('Browser.close').catch(() => {});
        socket.close();
        await Promise.race([once(child, 'exit'), sleep(10000)]);
        closeBrowserTree(child.pid);
      },
    };
  } catch (error) {
    clearInterval(poller);
    closeBrowserTree(child.pid);
    throw error;
  }
}

export async function runTerminal({ browser, browserContextId, url, timeoutMs = 120000, interact, blockUrls = [], onProgress, initScript }) {
  const { send, sessions, blockRequests } = browser;
  const logs = [];
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  sessions.set(sessionId, { logs, blockUrls });
  try {
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
    await send('Page.bringToFront', {}, sessionId).catch(() => {});
    await send('Network.enable', {}, sessionId);
    if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    blockRequests(sessionId, blockUrls);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: blockUrls.length > 0, flatten: true }, sessionId);
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
      await interact(driverFor({
        evaluate,
        press: async (key, { ctrl = false } = {}) => {
          const spec = KEYS[key];
          const base = { key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, modifiers: ctrl ? 2 : 0 };
          await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: spec.text }, sessionId);
          await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
        },
        type: async (text) => {
          await send('Input.insertText', { text }, sessionId);
        },
        note: async (name, read) => read(),
        pause: () => sleep(100),
        limit: timeoutMs,
      }));
    }
    return { logs, ...(await evaluate("({ engine: document.body.dataset.engine, out: globalThis.thebird.text() })")) };
  } finally {
    sessions.delete(sessionId);
    await send('Target.closeTarget', { targetId }).catch(() => {});
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
