import { connect } from './vendor/birdman/client.js';
import { runTjs, TJS_CANCELLED, TJS_TIMED_OUT } from './txiki-in-page.js';

const DEFAULT_TIMEOUT_MS = 10000;
const NAVIGATION_TIMEOUT_MS = 10000;
const ACTION_TIMEOUT_MS = 60000;
const RUN_CONTEXT = 'thebird-gm';
const OPEN_RUN_CONTEXT = "if (!state.gmRun) { state.gmRun = await browser.newContext(); state.gmRun.setDefaultTimeout(60000); state.gmRun.setDefaultNavigationTimeout(10000); } context = state.gmRun; ";
const CLOSE_RUN_CONTEXT = "let n = 0; if (state.gmRun) { try { n = state.gmRun.pages().filter((p) => !p.isClosed()).length; await state.gmRun.close(); } finally { delete state.gmRun; } } return 'GMCLOSED' + n + 'GMCLOSED';";
const TABS_CONTEXT = "const rows = []; const counts = { others: 0 }; for (const c of browser.contexts()) { for (const p of c.pages()) { if (p.isClosed()) continue; if (c === state.gmRun) rows.push({ url: p.url(), title: await p.title().catch(() => '') }); else counts.others += 1; } } return 'GMTABS' + JSON.stringify({ rows, counts }) + 'GMTABS';";
const MARKER = 'THEBIRD-PLAYWRITER';
const PAGE_REMOVED = 'there is no page global: use state.page = await context.newPage() or pick an existing tab from context.pages()';

let birdman = null;
let birdmanPromise = null;
let sequence = 0;
let state = {};
let logs = [];
let contexts = [];
let runContext = null;
const pending = new Map();
const handles = new Map();
let handleSequence = 0;

const json = (value) => JSON.stringify(value);
const textOf = (value) => typeof value === 'string' ? value : json(value);
const inspect = (value) => {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  try {
    return json(value);
  } catch {
    return String(value);
  }
};

const rpc = (method, params = {}, sessionId) => {
  const id = `thebird-${(sequence += 1)}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    birdman.transport().send(json({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
};

const connectBirdman = () => {
  if (birdmanPromise) return birdmanPromise;
  birdmanPromise = (async () => {
    const client = await connect();
    const transport = client.transport();
    transport.onmessage = (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message ?? json(message.error)), { code: message.error.code }));
      else entry.resolve(message.result ?? {});
    };
    client.onStateChange((kind) => {
      if (kind === 'ready') return;
      const error = new Error(`Birdman connection ${kind}`);
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    });
    birdman = client;
    return client;
  })().catch((error) => {
    birdmanPromise = null;
    throw error;
  });
  return birdmanPromise;
};

const targetOf = (handle) => {
  const value = handles.get(handle);
  if (!value) throw new Error(`unknown page handle: ${handle}`);
  return value;
};

const attach = async (target) => {
  await connectBirdman();
  if (!target.sessionId) target.sessionId = (await rpc('Target.attachToTarget', { targetId: target.id, flatten: true })).sessionId;
  return target.sessionId;
};

const evaluate = async (target, expression, awaitPromise = true) => {
  const sessionId = await attach(target);
  const answer = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId);
  if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text ?? 'Runtime.evaluate failed');
  return answer.result?.value;
};

const bridgeCall = async (name, payload) => {
  const call = { name, payload };
  if (name === 'cdp') {
    const { handle, method, params } = payload;
    const target = targetOf(handle);
    const sessionId = await attach(target);
    return rpc(method, params ?? {}, sessionId);
  }
  if (name === 'createPage') {
    await connectBirdman();
    const { targetId } = await rpc('Target.createTarget', { url: payload.url ?? 'about:blank', background: true, newWindow: false });
    const targets = (await rpc('Target.getTargets')).targetInfos ?? [];
    const info = targets.find((target) => target.targetId === targetId) ?? { targetId, url: 'about:blank', title: '' };
    const handle = `page-${(handleSequence += 1)}`;
    const target = { id: info.targetId, url: info.url, title: info.title };
    handles.set(handle, target);
    await attach(target);
    return { handle, url: target.url, title: target.title };
  }
  if (name === 'closePage') {
    const target = targetOf(payload.handle);
    await connectBirdman();
    await rpc('Target.closeTarget', { targetId: target.id }).catch(() => {});
    handles.delete(payload.handle);
    return {};
  }
  if (name === 'activate') {
    const target = targetOf(payload.handle);
    await connectBirdman();
    return rpc('Target.activateTarget', { targetId: target.id });
  }
  if (name === 'targets') {
    await connectBirdman();
    return (await rpc('Target.getTargets')).targetInfos ?? [];
  }
  if (name === 'log') {
    logs.push(`[${payload.method}] ${payload.args.map(inspect).join(' ')}`);
    return {};
  }
  if (name === 'wait') return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(payload.ms) || 0)));
  throw new Error(`unknown playwriter bridge call: ${name}`);
};

const makeConsole = () => Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((method) => [method, (...args) => bridgeCall('log', { method, args })]));

const programSource = (code, timeout) => {
  const prelude = `const __thebirdResult = { marker: ${json(MARKER)}, pageUnavailable: ${json(PAGE_REMOVED)} };
const __thebirdBridgeWaiting = new Map();
let __thebirdBridgeLast = 0;
__thebirdBridge.onResult = (event) => {
  const settle = __thebirdBridgeWaiting.get(event.id);
  __thebirdBridgeWaiting.delete(event.id);
  settle?.(event);
};
const __thebirdCall = (name, payload) => new Promise((settle) => {
  const id = ++__thebirdBridgeLast;
  __thebirdBridgeWaiting.set(id, settle);
  __thebirdBridge.send(JSON.stringify({ op: 'builtin', id, name: 'playwriter', argv: [name, JSON.stringify(payload ?? {})], cwd: '/workspace' }));
});
const __thebirdAnswer = async (name, payload) => {
  const event = await __thebirdCall(name, payload);
  const reply = JSON.parse(event.out || '{}');
  if (reply.error) throw new Error(reply.error);
  return reply.value;
};
class __ThebirdPage {
  constructor(page) { this.page = page; }
  url() { return this.page.url; }
  title() { return this.page.title; }
  isClosed() { return this.page.closed === true; }
  goto(url, options) { return __thebirdAnswer('cdp', { handle: this.page.handle, method: 'Page.navigate', params: { url } }).then(() => this.waitForLoadState('load', options)); }
  waitForLoadState(stateName, options) { return __thebirdAnswer('cdp', { handle: this.page.handle, method: 'Runtime.evaluate', params: { expression: stateName === 'domcontentloaded' ? "['interactive','complete'].includes(document.readyState)" : 'document.readyState === "complete"', returnByValue: true } }); }
  waitForTimeout(ms) { return __thebirdAnswer('wait', { ms }); }
  evaluate(pageFunction, arg) { const source = typeof pageFunction === 'function' ? '(' + pageFunction.toString() + ')(' + JSON.stringify(arg) + ')' : String(pageFunction); return __thebirdAnswer('cdp', { handle: this.page.handle, method: 'Runtime.evaluate', params: { expression: source, returnByValue: true, awaitPromise: true } }).then((answer) => answer.result?.value); }
  content() { return this.evaluate('document.documentElement.outerHTML'); }
  setContent(html) { return this.evaluate('(html => { document.open(); document.write(html); document.close(); return document.documentElement.outerHTML; })(' + JSON.stringify(html) + ')'); }
  locator(selector) { return new __ThebirdLocator(this, selector); }
  $(selector) { return this.locator(selector).count().then((count) => count ? this.locator(selector) : null); }
  $$(selector) { return this.locator(selector).all(); }
  click(selector) { return this.locator(selector).click(); }
  fill(selector, value) { return this.locator(selector).fill(value); }
  screenshot() { return __thebirdAnswer('cdp', { handle: this.page.handle, method: 'Page.captureScreenshot', params: { format: 'png' } }).then((answer) => answer.data); }
  bringToFront() { return __thebirdAnswer('activate', { handle: this.page.handle }); }
  reload() { return __thebirdAnswer('cdp', { handle: this.page.handle, method: 'Page.reload' }); }
  close() { this.page.closed = true; return __thebirdAnswer('closePage', { handle: this.page.handle }); }
  on() { return this; }
  off() { return this; }
  once() { return this; }
}
class __ThebirdLocator {
  constructor(page, selector, nth) { this.page = page; this.selector = selector; this.nth = nth; }
  __expression(body) { const selected = 'Array.from(document.querySelectorAll(' + JSON.stringify(this.selector) + '))'; const element = this.nth === undefined ? selected + '[0]' : selected + '[' + Number(this.nth) + ']'; return '(() => { const element = ' + element + '; if (!element) return null; ' + body + ' })()'; }
  count() { return this.page.evaluate('document.querySelectorAll(' + JSON.stringify(this.selector) + ').length'); }
  innerText() { return this.page.evaluate(this.__expression('return element.innerText;')); }
  textContent() { return this.page.evaluate(this.__expression('return element.textContent;')); }
  getAttribute(name) { return this.page.evaluate(this.__expression('return element.getAttribute(' + JSON.stringify(name) + ');')); }
  click() { return this.page.evaluate(this.__expression('element.click(); return true;')); }
  fill(value) { return this.page.evaluate(this.__expression('element.focus(); element.value = ' + JSON.stringify(String(value)) + '; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); return true;')); }
  first() { return new __ThebirdLocator(this.page, this.selector, 0); }
  last() { return new __ThebirdLocator(this.page, this.selector, -1); }
  nth(index) { return new __ThebirdLocator(this.page, this.selector, index); }
  all() { return this.count().then((count) => Array.from({ length: count }, (_, index) => new __ThebirdLocator(this.page, this.selector, index))); }
}
class __ThebirdContext {
  constructor(id) { this.id = id; this.pages = []; }
  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
  pages() { return this.pages.filter((page) => !page.isClosed()); }
  newPage() { return __thebirdAnswer('createPage', {}).then((page) => { const wrapped = new __ThebirdPage({ ...page, closed: false }); this.pages.push(wrapped); return wrapped; }); }
  close() { return Promise.all(this.pages().map((page) => page.close())).then(() => { this.pages = []; }); }
  cookies() { return Promise.resolve([]); }
  addCookies() { return Promise.resolve(); }
  clearCookies() { return Promise.resolve(); }
  on() { return this; }
  off() { return this; }
}
const __thebirdContexts = [new __ThebirdContext(${json(RUN_CONTEXT)})];
const browser = {
  contexts: () => __thebirdContexts,
  newContext: async () => { const context = new __ThebirdContext('thebird-context-' + __thebirdContexts.length); __thebirdContexts.push(context); return context; },
  close: async () => { for (const context of __thebirdContexts) await context.close(); },
  isConnected: () => true,
  version: () => 'Birdman CDP',
  on: () => browser,
  off: () => browser,
};
const state = {};
let context = __thebirdContexts[0];
const console = Object.fromEntries(['log','info','warn','error','debug'].map((method) => [method, (...args) => __thebirdAnswer('log', { method, args })]));
Object.defineProperty(globalThis, 'page', { get() { throw new Error(__thebirdResult.pageUnavailable); } });
`;
  const trimmed = code.replace(/[; \n\t\r]+$/, '');
  const single = trimmed !== '' && !/[;\n]/.test(trimmed) && !trimmed.includes('return');
  const parenthesized = trimmed.startsWith('(') && trimmed.endsWith(')');
  const body = single || parenthesized ? `return await (${trimmed});` : code;
  const expression = OPEN_RUN_CONTEXT + body;
  const tail = `const __thebirdValue = await (async () => { ${expression} })();
const __thebirdSerialized = (() => { try { const text = JSON.stringify(__thebirdValue); return text === undefined ? null : JSON.parse(text); } catch { return String(__thebirdValue); } })();
console.log(__thebirdResult.marker + JSON.stringify({ ok: true, value: __thebirdSerialized, context: context?.id ?? null, logs: ${json([])} }));`;
  return prelude + tail;
};

const builtin = async (name, argv, cwd, signal) => {
  if (name !== 'playwriter') throw new Error(`unknown builtin: ${name}`);
  const call = argv[0];
  const payload = JSON.parse(argv[1] ?? '{}');
  try {
    const value = await bridgeCall(call, payload);
    return json({ code: 0, out: json({ value }), err: '' });
  } catch (error) {
    return json({ code: 0, out: json({ error: error?.message ?? String(error) }), err: '' });
  }
};

const runExpression = async (code, { timeout = DEFAULT_TIMEOUT_MS, signal } = {}) => {
  await connectBirdman();
  logs = [];
  const { output, status } = await runTjs(programSource(code, timeout), '/workspace', { signal, timeoutMs: timeout, builtin });
  if (status === TJS_CANCELLED) throw new Error('cancelled');
  if (status === TJS_TIMED_OUT) throw new Error(`code timed out after ${timeout} ms`);
  const marker = output.lastIndexOf(MARKER);
  if (marker < 0) throw new Error(output.trimEnd() || `playwriter execution exited with status ${status}`);
  const parsed = JSON.parse(output.slice(marker + MARKER.length));
  if (parsed.error) throw new Error(parsed.error);
  const lines = logs.slice();
  if (parsed.value !== undefined && parsed.value !== null) lines.push(`[return value] ${textOf(parsed.value)}`);
  return lines.join('\n') || 'Code executed successfully (no output)';
};

const resetConnection = async () => {
  await connectBirdman();
  for (const target of handles.values()) await rpc('Target.closeTarget', { targetId: target.id }).catch(() => {});
  handles.clear();
  state = {};
  logs = [];
  contexts = [];
  runContext = RUN_CONTEXT;
  return { context: runContext, pages: 0 };
};

const status = async () => {
  await connectBirdman();
  const { targetInfos } = await rpc('Target.getTargets');
  return { ready: true, targets: targetInfos ?? [], contexts: contexts.length, ownedPages: handles.size };
};

globalThis.THEBIRD_PLAYWRITER = { execute: runExpression, reset: resetConnection, connect: connectBirdman, status };

const resetTool = async () => {
  const result = await resetConnection();
  return { content: [{ type: 'text', text: `Connection reset successfully. ${result.pages} page(s) available.` }] };
};

const listBrowsers = async () => {
  const info = await status();
  return { ok: true, supported: true, browsers: [{ pid: null, project: RUN_CONTEXT, pages: info.targets.length, debugPort: null }], tabs: info.targets };
};

const closeRun = async () => {
  const output = await runExpression(CLOSE_RUN_CONTEXT, { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => '');
  const match = /GMCLOSED(\d+)GMCLOSED/.exec(output);
  return { ok: true, closedPages: match ? Number(match[1]) : 0 };
};

const browserTabs = async () => {
  const output = await runExpression(TABS_CONTEXT, { timeout: NAVIGATION_TIMEOUT_MS });
  const match = /GMTABS([\s\S]*)GMTABS/.exec(output);
  if (!match) return { ok: true, state: 'unavailable', text: 'tabs: unavailable: the browser answer had no tab view' };
  const view = JSON.parse(match[1]);
  const rows = view.rows ?? [];
  const listed = rows.map((row, index) => `${index === 0 ? '' : '; '}[${index + 1}] ${row.url} "${row.title}"`).join('');
  return { ok: true, state: rows.length ? 'changed' : 'none', text: rows.length ? `tabs: ${rows.length} in this run, safe to close on finish: ${listed}` : 'tabs: none in this run' };
};

export const PLAYWRITER_TOOLS = [
  { name: 'execute', description: 'Run Playwright-like browser code over Birdman CDP inside the txiki.js VM.', inputSchema: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'number' } }, required: ['code'] } },
  { name: 'reset', description: 'Reconnect Birdman CDP and clear the execution state.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browsers', description: 'List Birdman CDP targets.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, target: { type: 'string' }, force: { type: 'boolean' } } } },
  { name: 'browser_tabs', description: 'List this run\'s tabs.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_close_run', description: 'Close this run\'s tabs.', inputSchema: { type: 'object', properties: {} } },
];

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const content = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : json(value) }] });

const tools = {
  execute: async (args) => {
    if (typeof args?.code !== 'string' || !args.code.trim()) throw new Error('execute needs a non-empty code string');
    return content(await runExpression(args.code, { timeout: Number(args.timeout) || DEFAULT_TIMEOUT_MS }));
  },
  reset: resetTool,
  browsers: async (args) => content(args?.action === 'close' ? await closeRun() : await listBrowsers()),
  browser_tabs: async () => content(await browserTabs()),
  browser_close_run: async () => content(await closeRun()),
  playwriter_execute: async (args) => content({ ok: true, output: await runExpression(args.code, { timeout: Number(args.timeout) || DEFAULT_TIMEOUT_MS }) }),
  playwriter_browsers: async (args) => content(args?.action === 'close' ? await closeRun() : await listBrowsers()),
};

export const playwriterVerbs = Object.fromEntries(Object.entries(tools).map(([name, fn]) => [name, (args = {}) => Promise.resolve(fn(args))]));

export const playwriterHandle = async (message) => {
  const id = message?.id ?? null;
  if (!message || typeof message.method !== 'string') return failure(id, -32600, 'invalid request');
  if (message.method.startsWith('notifications/')) return null;
  const params = message.params ?? {};
  if (message.method === 'initialize') return reply(id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'playwriter', title: 'Birdman CDP playwriter', version: '0.1.0' } });
  if (message.method === 'ping') return reply(id, {});
  if (message.method === 'tools/list') return reply(id, { tools: PLAYWRITER_TOOLS });
  if (message.method === 'tools/call') {
    const tool = tools[params.name];
    if (!tool) return failure(id, -32602, `unknown tool: ${params.name}`);
    try {
      return reply(id, await tool(params.arguments ?? {}));
    } catch (error) {
      return reply(id, { ...content(`Error executing code: ${error?.stack ?? error?.message ?? String(error)}`), isError: true });
    }
  }
  return failure(id, -32601, `method not found: ${message.method}`);
};

export const playwriterExecute = (code, timeout) => runExpression(code, { timeout });
export const playwriterStatus = () => status();

export async function playwriterBuiltin(argv, { signal } = {}) {
  if (signal?.aborted) throw new Error('cancelled');
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-V' || command === 'version') return 'birdman playwriter 0.1.0';
  if (command === '--help' || command === '-h' || command === 'help' || argv.length === 0) return 'usage: playwriter status | playwriter stdio <json-rpc> | playwriter call <tool> <json> | playwriter execute <code>';
  if (command === 'status') return json(await status());
  if (command === 'stdio' || command === 'rpc') return json(await playwriterHandle(JSON.parse(rest.join(' '))));
  if (command === 'call') {
    const [name, ...args] = rest;
    const tool = tools[name];
    if (!tool) throw new Error(`unknown playwriter tool: ${name}`);
    return json(await tool(args.length ? JSON.parse(args.join(' ')) : {}));
  }
  if (command === 'execute') return runExpression(rest.join(' '));
  if (command === 'reset') return (await resetTool()).content[0].text;
  throw new Error(`playwriter: unknown command '${command}'`);
}
