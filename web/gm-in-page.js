import { posix } from './shims/path.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from './shims/fs.js';
import { gmCheck, gmSha256Hex, gmVersion } from './vendor/gm/gm-core.js';

const USAGE = 'usage: gm --version | gm --help | gm check | gm serve | gm stdio <json-rpc-line> | gm tools | gm call <tool> [json-args]';
const HELP = `${USAGE}\n\ngm is an in-page MCP server. gm serve lists the served methods. gm stdio takes one JSON-RPC line and answers one line. gm call runs one tool. State is an append-only run log under /workspace/.gm/runs.`;
const PROTOCOL = '2025-11-25';
const SERVER_INFO = { name: 'gm', title: 'gm in-page worker', version: '0.1.0' };
const SKILL = '# gm\n\nOne worker, one append-only log, rules re-read at every step.\n';
const RESOURCES = [{ uri: 'skill://gm/SKILL.md', name: 'gm', mimeType: 'text/markdown', text: SKILL }];
const RUN_ROOT = '/workspace/.gm/runs';
const TOOLS = [
  { name: 'next_context', description: 'Begin a step. Returns the rules, task, pending events and prefixSha.', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_code', description: 'Run a JavaScript body against gm verbs.', inputSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] } },
  { name: 'finish', description: 'End the run.', inputSchema: { type: 'object', properties: { witness: { type: 'string' } } } },
  { name: 'read_file', description: 'Read a text file from the workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write a text file into the workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace one exact occurrence in a text file.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  { name: 'stat_file', description: 'Stat a workspace path.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'list_dir', description: 'List a workspace directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'grep', description: 'Literal grep over workspace text files.', inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'query_log', description: 'Read the append-only run log.', inputSchema: { type: 'object', properties: {} } },
  { name: 'task_set', description: 'Set the run task.', inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
];
const METHODS = ['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read', 'resources/templates/list', 'prompts/list', 'prompts/get', 'server/discover'];
let runDir = null;
let logSeq = 0;
let task = '';
let finished = false;

const absolute = (path, cwd) => posix.resolve(cwd ?? '/workspace', path ?? '.');
const json = (value) => JSON.stringify(value);
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const content = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : json(value) }] });

const openRun = () => {
  if (runDir) return runDir;
  mkdirSync(RUN_ROOT, { recursive: true });
  const name = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  runDir = posix.join(RUN_ROOT, name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(posix.join(runDir, 'task.txt'), task);
  append('start', { protocol: PROTOCOL, surface: 'in-page-wasm' });
  return runDir;
};

const append = (kind, fields) => {
  const dir = openRun();
  logSeq += 1;
  const event = { seq: logSeq, kind, at: new Date().toISOString(), ...fields };
  writeFileSync(posix.join(dir, 'log.jsonl'), `${readLogText()}${json(event)}\n`);
  return event;
};

const readLogText = () => {
  const path = posix.join(runDir ?? RUN_ROOT, 'log.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
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
  next_context: () => {
    const feed = events().slice(-20);
    const prefixSha = gmSha256Hex(feed.map((event) => json(event)).join('\n'));
    return { rules: SKILL, task, pending: [], events: feed, stepsLeft: finished ? 0 : 50, prefixSha, runDir };
  },
  run_code: (args) => ({ ok: false, error: 'run_code bodies are not supported by the in-page wasm core; use tools/call verbs', body: args?.body ?? '' }),
  finish: (args) => {
    finished = true;
    append('end', { witness: args?.witness ?? null });
    return { status: 'finished', witness: args?.witness ?? null, runDir };
  },
  read_file: (args) => ({ path: absolute(args.path), text: readText(args.path) }),
  write_file: (args) => append('write_file', writeText(args.path, args.content)),
  edit_file: (args) => {
    const target = absolute(args.path);
    const text = readText(target);
    const count = text.split(args.old).length - 1;
    if (count !== 1) throw new Error(`edit_file needs exactly one match, found ${count}`);
    return append('edit_file', writeText(target, text.replace(args.old, args.new)));
  },
  stat_file: (args) => {
    const target = absolute(args.path);
    const info = statSync(target, { throwIfNoEntry: false });
    if (!info) throw new Error(`no such file: ${target}`);
    return { path: target, type: info.isDirectory() ? 'directory' : 'file', size: info.size, mtime: info.mtime?.toISOString?.() ?? null };
  },
  list_dir: (args) => {
    const target = absolute(args?.path ?? '/workspace');
    return { path: target, entries: readdirSync(target, { withFileTypes: true }).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) };
  },
  grep: (args) => {
    const target = absolute(args?.path ?? '/workspace');
    const files = statSync(target, { throwIfNoEntry: false })?.isDirectory?.() ? walk(target) : [target];
    const hits = [];
    for (const file of files) {
      if (!file.endsWith('.js') && !file.endsWith('.mjs') && !file.endsWith('.json') && !file.endsWith('.md') && !file.endsWith('.txt')) continue;
      readText(file).split('\n').forEach((line, index) => {
        if (line.includes(args.pattern)) hits.push({ path: file, line: index + 1, text: line });
      });
    }
    return { pattern: args.pattern, hits: hits.slice(0, 200), total: hits.length };
  },
  query_log: () => ({ total: logSeq, events: events() }),
  task_set: (args) => {
    task = args.task;
    writeFileSync(posix.join(openRun(), 'task.txt'), task);
    return append('task_set', { task });
  },
};

const runTool = async (name, args) => {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  const result = await verbs[name](args ?? {});
  append('tool', { tool: name, args: args ?? {} });
  return content(result);
};

const handle = async (message) => {
  const id = message?.id ?? null;
  if (!message || typeof message.method !== 'string') return failure(id, -32600, 'invalid request');
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize': openRun(); return reply(id, { protocolVersion: PROTOCOL, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: SERVER_INFO });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: TOOLS });
    case 'tools/call': {
      if (typeof params.name !== 'string') return failure(id, -32602, 'tools/call needs a name');
      try {
        return reply(id, await runTool(params.name, params.arguments));
      } catch (error) {
        return reply(id, { ...content(`gm: ${error.message}`), isError: true, _gmCode: error.code ?? -32000 });
      }
    }
    case 'resources/list': return reply(id, { resources: RESOURCES.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })) });
    case 'resources/templates/list': return reply(id, { resourceTemplates: [] });
    case 'resources/read': {
      const resource = RESOURCES.find((entry) => entry.uri === params.uri);
      return resource ? reply(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] }) : failure(id, -32002, `resource not found: ${params.uri}`);
    }
    case 'prompts/list': return reply(id, { prompts: [{ name: 'gm', description: SKILL.trim() }] });
    case 'prompts/get': return reply(id, { messages: [{ role: 'user', content: { type: 'text', text: SKILL } }] });
    case 'server/discover': return reply(id, { protocolVersions: ['2025-11-25', '2025-06-18'], methods: METHODS, tools: TOOLS.map((tool) => tool.name) });
    default: return failure(id, -32601, `method not found: ${message.method}`);
  }
};

const looseJson = (text) => {
  const attempt = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const direct = attempt(text);
  if (direct !== null) return direct;
  const quoted = text.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/(:\s*)([A-Za-z_$][\w$/.:-]*)(\s*[,}])/g, '$1"$2"$3');
  const rebuilt = attempt(quoted);
  if (rebuilt !== null) return rebuilt;
  const parts = text.split(/\s+/).filter(Boolean).map((part) => {
    const at = part.indexOf(':');
    if (at < 1) return part;
    const key = part.slice(0, at).replace(/^[{,]/, '');
    const value = part.slice(at + 1).replace(/[},]$/, '');
    return `${JSON.stringify(key)}:${/^(true|false|null|-?\d+(\.\d+)?)$/.test(value) ? value : JSON.stringify(value)}`;
  });
  return JSON.parse(`{${parts.join(',')}}`);
};

export const gmMethods = METHODS;
export const gmTools = TOOLS.map((tool) => tool.name);

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'finish', 'task_set']);
const READ_TOOLS = new Set(['read_file', 'stat_file', 'list_dir', 'grep', 'query_log']);

export function gmHostTools() {
  return Object.fromEntries(TOOLS.map(({ name, description, inputSchema }) => [name, {
    name,
    description,
    inputSchema,
    writes: WRITE_TOOLS.has(name),
    idempotent: READ_TOOLS.has(name),
    async execute(input) {
      if (runDir === null) openRun();
      const result = await verbs[name](input ?? {});
      return typeof result === 'string' ? result : json(result);
    },
  }]));
}

export async function gmRpc(line) {
  if (runDir === null) openRun();
  const message = looseJson(line);
  const messages = Array.isArray(message) ? message : [message];
  const answers = await Promise.all(messages.map(handle));
  const batch = answers.filter((answer) => answer.id !== null || answer.error !== undefined);
  return json(Array.isArray(message) ? batch : batch[0] ?? {});
}

export async function gmBuiltin(argv, { signal, cwd } = {}) {
  if (signal?.aborted) throw new Error('cancelled');
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-V' || command === 'version') return await gmVersion();
  if (command === '--help' || command === '-h' || command === 'help' || argv.length === 0) return HELP;
  if (command === 'check') return await gmCheck();
  if (command === 'serve') return `gm MCP ${PROTOCOL}: ${METHODS.join(', ')}`;
  if (command === 'tools') return gmTools.join('\n');
  if (command === 'stdio') return gmRpc(rest.join(' '));
  if (command === 'call') {
    const [name, ...args] = rest;
    const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args.length ? looseJson(args.join(' ')) : {} } });
    return answer.result?.content?.[0]?.text ?? json(answer);
  }
  if (command === 'rpc') return gmRpc(rest.join(' '));
  throw new Error(`gm: unknown command '${command}'\n${USAGE}`);
}
