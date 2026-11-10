import { posix } from './shims/path.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from './shims/fs.js';
import { gmCheck, gmClip, gmSha256Hex, gmVersion } from './vendor/gm/gm-core.js';
import { GM_SKILLS } from './vendor/gm/skills.js';
import { createBrowserStdio } from './vendor/floosie/browser.js';
import { playwriterVerbs, playwriterHandle } from './playwriter-in-page.js';

const USAGE = 'usage: gm --version | gm --help | gm check | gm serve | gm stdio \'<json-rpc>\' | gm tools | gm call <tool> \'<json>\' | gm attach';
const HELP = `${USAGE}\n\ngm is gm's stdio MCP server in the page. Its three served tools are next_context, run_code and finish; every other verb is a function on gm inside a run_code body. gm stdio takes one single-quoted JSON-RPC line and answers one line. gm attach lists the apps on the floosie hub; an app joins with gmAttach(name, handler). The append-only run log is under /workspace/.gm/runs.`;
const PROTOCOL = '2025-11-25';
const SERVER_INFO = { name: 'gm', title: 'gm in-page worker', version: '0.1.0' };
const RUN_ROOT = '/workspace/.gm/runs';
const MAX_STEPS = 50;
const SKILL_FILES = [
  { uri: 'skill://gm/SKILL.md', name: 'gm', file: 'skills/gm/SKILL.md' },
  { uri: 'skill://gm/WORKFLOWS.md', name: 'WORKFLOWS.md', file: 'skills/gm/WORKFLOWS.md' },
  { uri: 'skill://gm-continue/SKILL.md', name: 'gm-continue', file: 'skills/gm-continue/SKILL.md' },
];
const TOOLS = [
  { name: 'next_context', description: 'Begin a step. Returns the rules, task, pending events and prefixSha.', inputSchema: { type: 'object', properties: { waitMs: { type: 'number' }, full: { type: 'boolean' }, child: { type: 'boolean' }, run: { type: 'string' }, compactChildren: { type: 'boolean' }, task: { type: 'string' }, owner: { type: 'boolean' } } } },
  { name: 'run_code', description: 'Run a JavaScript body. gm is in scope with every verb as gm.<name>(args). Return or await the body value.', inputSchema: { type: 'object', properties: { body: { type: 'string' }, timeoutMs: { type: 'number' }, format: { type: 'string', enum: ['esm', 'cjs'] } }, required: ['body'] } },
  { name: 'finish', description: 'End the run with a witness. An open row or an empty witness is refused.', inputSchema: { type: 'object', properties: { witness: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } }, stopBackground: { type: 'boolean' }, openRows: { type: 'array', items: { type: 'object' } } }, required: ['witness'] } },
];
const METHODS = ['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read', 'resources/templates/list', 'resources/subscribe', 'resources/unsubscribe', 'prompts/list', 'prompts/get', 'skills/list', 'skills/get', 'server/discover', 'notifications/initialized'];
let runDir = null;
let logSeq = 0;
let task = '';
let step = 0;
let finished = false;
let witnessSeen = false;

const absolute = (path, cwd) => posix.resolve(cwd ?? '/workspace', path ?? '.');
const json = (value) => JSON.stringify(value);
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const content = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : json(value) }] });
const now = () => new Date().toISOString();

const openRun = () => {
  if (runDir) return runDir;
  mkdirSync(RUN_ROOT, { recursive: true });
  const names = existsSync(RUN_ROOT) ? readdirSync(RUN_ROOT, { withFileTypes: true }).map((entry) => entry.name).filter((name) => name.startsWith('run-')) : [];
  if (names.length > 0 && !finished) {
    runDir = posix.join(RUN_ROOT, names.sort().at(-1));
    const events = readLogText().trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    logSeq = events.length;
    const lastTask = events.find((event) => event.kind === 'task') ?? events.find((event) => event.kind === 'task_set');
    task = lastTask?.text ?? lastTask?.task ?? '';
    step = events.filter((event) => event.kind === 'tool' && event.tool === 'next_context').length;
    finished = events.some((event) => event.kind === 'end');
    if (!finished) append('resume', { protocol: PROTOCOL, surface: 'in-page-wasm' });
    return runDir;
  }
  const name = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  runDir = posix.join(RUN_ROOT, name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(posix.join(runDir, 'task.txt'), task);
  append('start', { protocol: PROTOCOL, surface: 'in-page-wasm' });
  return runDir;
};

const readLogText = () => {
  const path = posix.join(runDir ?? RUN_ROOT, 'log.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const append = (kind, fields) => {
  const dir = openRun();
  logSeq += 1;
  const event = { seq: logSeq, kind, at: now(), ...fields };
  const path = posix.join(dir, 'log.jsonl');
  writeFileSync(path, `${existsSync(path) ? readFileSync(path, 'utf8') : ''}${json(event)}\n`);
  return event;
};

const events = () => readLogText().trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const readText = (path) => {
  const target = absolute(path);
  if (!existsSync(target)) throw new Error(`no such file: ${target}`);
  return readFileSync(target, 'utf8');
};
const writeText = (path, text) => {
  const target = absolute(path);
  mkdirSync(posix.dirname(target), { recursive: true });
  writeFileSync(target, text);
  return { path: target, bytes: new TextEncoder().encode(text).length };
};
const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return posix.basename(path).startsWith('.') ? [] : walk(path);
    return [path];
  });
};

const verbs = {
  next_context: async (args) => {
    if (finished) return { ok: false, refused: true, error: 'the run is finished', step, stepsLeft: 0 };
    if (step >= MAX_STEPS) return { ok: false, refused: true, error: `step limit reached (${MAX_STEPS})`, step, stepsLeft: 0 };
    if (args?.task !== undefined && step === 0) {
      task = String(args.task);
      writeFileSync(posix.join(openRun(), 'task.txt'), task);
      append('task', { text: task, owner: args.owner === true });
    } else if (args?.task !== undefined && args.owner !== true) {
      return { ok: false, refused: true, error: 'a task replacement after the first step needs owner:true', step };
    }
    step += 1;
    const feed = events().slice(-20);
    const prefixSha = await gmSha256Hex(feed.map((event) => json(event)).join('\n'));
    append('tool', { tool: 'next_context', args: args ?? {} });
    return { ok: true, step, stepsLeft: MAX_STEPS - step, maxSteps: MAX_STEPS, run: runDir, task, rules: 'Read skill://gm/SKILL.md. One worker, one append-only log, rules re-read at every step.', pending: [], events: feed, total: logSeq, prefixSha, actionSeq: logSeq, warning: MAX_STEPS - step === 0 ? 'stepsLeft is 0: call finish now' : null };
  },
  run_code: async (args) => {
    if (typeof args?.body !== 'string' || args.body.trim() === '') return { ok: false, refused: true, error: 'run_code needs a non-empty body' };
    const scope = Object.fromEntries([...Object.entries(verbs), ...Object.entries(playwriterVerbs)].filter(([name]) => name !== 'run_code').map(([name, fn]) => [name, (input) => Promise.resolve(fn(input))]));
    const gm = { ...scope, try: async (fn) => { try { return await fn(); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; } }, verbs: () => Object.keys(scope) };
    const body = args.format === 'cjs' ? args.body : `return (async () => { ${args.body} })();`;
    let value;
    try {
      value = await new Function('gm', body)(gm);
    } catch (error) {
      append('tool', { tool: 'run_code', args: { body: args.body.slice(0, 200) }, error: error?.message ?? String(error) });
      return { ok: false, refused: false, error: error?.message ?? String(error), actionSeq: logSeq };
    }
    append('tool', { tool: 'run_code', args: { body: args.body.slice(0, 200) } });
    witnessSeen = true;
    return { ok: true, value: value ?? null, actionSeq: logSeq };
  },
  finish: (args) => {
    if (typeof args?.witness !== 'string' || args.witness.trim() === '') return { ok: false, refused: true, error: 'finish needs a non-empty witness string' };
    if (args.openRows?.length) return { ok: false, refused: true, error: `${args.openRows.length} open row(s) block finish` };
    if (!witnessSeen) return { ok: false, refused: true, error: 'finish needs a witnessed run_code or run_shell result in this run' };
    finished = true;
    append('end', { witness: args.witness, gaps: args.gaps ?? [], stopBackground: args.stopBackground === true });
    return { ok: true, finished: true, actionSeq: logSeq };
  },
  read_file: (args) => ({ path: absolute(args.path), text: readText(args.path) }),
  write_file: (args) => append('write_file', writeText(args.path, args.content)),
  edit_file: (args) => {
    const target = absolute(args.path);
    const text = readText(target);
    const count = text.split(args.old).length - 1;
    if (count !== 1 && args.replaceAll !== true) throw new Error(`edit_file needs exactly one match, found ${count}`);
    return append('edit_file', writeText(target, args.replaceAll === true ? text.split(args.old).join(args.new) : text.replace(args.old, args.new)));
  },
  stat_file: (args) => {
    const target = absolute(args.path);
    const info = statSync(target, { throwIfNoEntry: false });
    if (!info) throw new Error(`no such file: ${target}`);
    return { path: target, type: info.isDirectory() ? 'directory' : 'file', size: info.size, mtime: info.mtime?.toISOString?.() ?? null };
  },
  list_dir: (args) => {
    const target = absolute(args?.path ?? '/workspace');
    return { path: target, entries: readdirSync(target, { withFileTypes: true }).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })), total: readdirSync(target).length, next: null };
  },
  grep: (args) => {
    const target = absolute(args?.path ?? '/workspace');
    const files = statSync(target, { throwIfNoEntry: false })?.isDirectory?.() ? walk(target) : [target];
    const hits = [];
    for (const file of files) {
      if (!/\.(js|mjs|json|md|txt|html|css|cpp|hpp|h)$/.test(file)) continue;
      readText(file).split('\n').forEach((line, index) => {
        if (line.includes(args.pattern)) hits.push({ path: file, line: index + 1, text: line });
      });
    }
    return { pattern: args.pattern, hits: hits.slice(0, 200), total: hits.length };
  },
  search: (args) => verbs.grep({ pattern: args?.query ?? args?.pattern ?? '', path: args?.path }),
  query_log: (args) => {
    const all = events();
    const filtered = typeof args?.seq === 'number' ? all.filter((event) => event.seq >= args.seq) : all;
    return { total: all.length, events: filtered.slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? filtered.length)) };
  },
  task_set: (args) => {
    task = args.task;
    writeFileSync(posix.join(openRun(), 'task.txt'), task);
    return append('task_set', { task });
  },
  run_shell: (args) => {
    append('run_shell', { command: args?.command ?? '', refused: true, reason: 'the in-page wasm core does not spawn host processes' });
    return { ok: false, error: 'run_shell is not available in the in-page wasm core; use a run_code body with gm file verbs', command: args?.command ?? '' };
  },
};

const runTool = async (name, args) => {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  const result = await verbs[name](args ?? {});
  const text = typeof result === 'string' ? result : json(result);
  return content(text.length > 20000 ? await gmClip(text, 20000) : text);
};

const serveSkill = async (uri) => {
  const entry = SKILL_FILES.find((candidate) => candidate.uri === uri);
  if (!entry) return null;
  const text = GM_SKILLS[entry.file] ?? null;
  if (text === null) return null;
  return { uri, mimeType: 'text/markdown', text, digest: `sha256:${await gmSha256Hex(text)}`, size: new TextEncoder().encode(text).length };
};

const handle = async (message) => {
  const id = message?.id ?? null;
  if (!message || typeof message.method !== 'string') return failure(id, -32600, 'invalid request');
  if (message.method.startsWith('notifications/')) return null;
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize': openRun(); return reply(id, { protocolVersion: PROTOCOL, capabilities: { tools: {}, resources: { subscribe: true }, prompts: {}, skills: {} }, serverInfo: SERVER_INFO });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: TOOLS });
    case 'tools/call': {
      if (typeof params.name !== 'string') return failure(id, -32602, 'tools/call needs a name');
      try {
        return reply(id, await runTool(params.name, params.arguments));
      } catch (error) {
        return reply(id, { ...content(`gm: ${error.message}`), isError: true });
      }
    }
    case 'resources/list': return reply(id, { resources: SKILL_FILES.map(({ uri, name }) => ({ uri, name, mimeType: 'text/markdown' })) });
    case 'resources/templates/list': return reply(id, { resourceTemplates: [] });
    case 'resources/read': {
      const found = await serveSkill(params.uri);
      return found ? reply(id, { contents: [found] }) : failure(id, -32002, `resource not found: ${params.uri}`);
    }
    case 'resources/subscribe':
    case 'resources/unsubscribe': return reply(id, {});
    case 'prompts/list': return reply(id, { prompts: [{ name: 'gm', description: 'Runs a long task as a gm worker.' }, { name: 'gm-continue', description: 'Continues gm work from its rows.' }] });
    case 'prompts/get': {
      const which = params.name === 'gm-continue' ? 2 : 0;
      const found = await serveSkill(SKILL_FILES[which].uri);
      return reply(id, { description: which === 2 ? 'gm-continue' : 'gm', messages: [{ role: 'user', content: { type: 'text', text: found?.text ?? '' } }] });
    }
    case 'skills/list': return reply(id, { skills: SKILL_FILES.filter((entry) => entry.uri.endsWith('SKILL.md')).map(({ uri, name }) => ({ uri, name })) });
    case 'skills/get': return reply(id, { skill: await serveSkill(params.uri ?? 'skill://gm/SKILL.md') });
    case 'server/discover': return reply(id, { protocolVersions: ['2025-11-25', '2025-06-18'], methods: METHODS, tools: TOOLS.map((tool) => tool.name) });
    default: return failure(id, -32601, `method not found: ${message.method}`);
  }
};

const looseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const parts = text.split(/\s+/).filter(Boolean).map((part) => {
      const at = part.indexOf(':');
      if (at < 1) return part;
      const key = part.slice(0, at).replace(/^[{,]/, '');
      const value = part.slice(at + 1).replace(/[},]$/, '');
      return `${JSON.stringify(key)}:${/^(true|false|null|-?\d+(\.\d+)?)$/.test(value) ? value : JSON.stringify(value)}`;
    });
    return JSON.parse(`{${parts.join(',')}}`);
  }
};

export const gmMethods = METHODS;
export const gmTools = TOOLS.map((tool) => tool.name);

const hub = createBrowserStdio({ name: 'gm', inputType: 'rpc' });
hub.attach('gm', handle);
hub.attach('playwriter', playwriterHandle);
hub.attach('*', handle);

export const gmAttach = (name, handler) => hub.attach(name, handler);
export const gmHubEndpoints = () => [...hub.endpoints.keys()];

export async function gmRpc(line) {
  if (runDir === null) openRun();
  return hub.input(line);
}

export async function gmBuiltin(argv, { signal, cwd } = {}) {
  if (signal?.aborted) throw new Error('cancelled');
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-V' || command === 'version') return await gmVersion();
  if (command === '--help' || command === '-h' || command === 'help' || argv.length === 0) return HELP;
  if (command === 'check') return await gmCheck();
  if (command === 'serve') return `gm MCP ${PROTOCOL}: ${METHODS.join(', ')}`;
  if (command === 'tools') return gmTools.join('\n');
  if (command === 'attach') return `floosie hub: ${gmHubEndpoints().join(', ') || 'unavailable'}`;
  if (command === 'stdio' || command === 'rpc') return gmRpc(rest.join(' '));
  if (command === 'call') {
    const [name, ...args] = rest;
    const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args.length ? looseJson(args.join(' ')) : {} } });
    return answer.result?.content?.[0]?.text ?? json(answer);
  }
  throw new Error(`gm: unknown command '${command}'\n${USAGE}`);
}
