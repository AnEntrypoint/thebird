const MAX_BODY = 256 * 1024;
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'thebird', version: '0.2.0' };
const ENDPOINT = '/__thebird/mcp/thebird';
const STATE_PATH = '/__thebird/state';
const DEFAULT_LINES = 60;
const MAX_LINES = 500;
const SNAPSHOT_KEYS = ['pane', 'run', 'fx'];
const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const TOOLS = [
  {
    name: 'thebird_pane',
    description: 'Read the last lines of the thebird terminal screen from the latest page snapshot (read-only).',
    inputSchema: { type: 'object', properties: { lines: { type: 'number', minimum: 1, maximum: MAX_LINES } }, additionalProperties: false },
  },
  {
    name: 'thebird_run',
    description: 'Read the latest run snapshot: busy state, current command, cwd, last exit code, engine states and fx status (read-only).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'thebird_ports',
    description: 'List the apps and open ports that the Node app supervisor reports (read-only).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const TOOL_LIST = TOOLS.map(({ name, description }) => ({ name, description }));

const sendJson = (res, status, value) => {
  res.writeHead(status, { ...NO_STORE, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};

const sendEmpty = (res, status) => {
  res.writeHead(status, NO_STORE);
  res.end();
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  });
  req.on('end', () => resolve({ tooLarge: size > MAX_BODY, text: Buffer.concat(chunks).toString('utf8') }));
  req.on('error', () => resolve({ tooLarge: false, text: '' }));
});

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const toolContent = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

const boundedLines = (lines) => {
  if (typeof lines !== 'number' || !Number.isFinite(lines)) return DEFAULT_LINES;
  return Math.min(MAX_LINES, Math.max(1, Math.trunc(lines)));
};

export function createThebirdMcp({ supervisor, now = () => Date.now(), staleMs = 5000 } = {}) {
  let latest = null;

  const isStale = () => now() - latest.updatedAt > staleMs;

  const storeSnapshot = (value) => {
    const kept = {};
    for (const key of SNAPSHOT_KEYS) {
      if (typeof value[key] === 'object') kept[key] = value[key];
    }
    latest = { ...kept, updatedAt: now() };
  };

  const paneTool = (args) => {
    if (latest === null) return { stale: true, lines: [] };
    const pane = latest.pane ?? {};
    const screen = Array.isArray(pane.lines) ? pane.lines.map(String) : [];
    return {
      updatedAt: latest.updatedAt,
      stale: isStale(),
      cols: pane.cols ?? null,
      rows: pane.rows ?? null,
      cursor: pane.cursor ?? null,
      lines: screen.slice(-boundedLines(args.lines)),
    };
  };

  const runTool = () => {
    if (latest === null) return { updatedAt: null, stale: true };
    const base = { ...(latest.run ?? {}), updatedAt: latest.updatedAt, stale: isStale() };
    return latest.fx === undefined ? base : { ...base, fx: latest.fx };
  };

  const portsTool = async () => ({ apps: supervisor ? await supervisor.status() : [] });

  const TOOL_HANDLERS = { thebird_pane: paneTool, thebird_run: runTool, thebird_ports: portsTool };

  const callTool = async (name, args) => {
    try {
      return toolContent(await TOOL_HANDLERS[name](args));
    } catch (error) {
      return toolContent({ error: error?.message ?? String(error) }, true);
    }
  };

  const dispatch = async (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return rpcError(null, -32600, 'invalid request');
    }
    const id = message.id ?? null;
    if (message.method.startsWith('notifications/')) return null;
    if (message.method === 'initialize') {
      return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, serverInfo: SERVER_INFO, capabilities: { tools: {} } });
    }
    if (message.method === 'tools/list') return rpcResult(id, { tools: TOOLS });
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (typeof name !== 'string' || !Object.hasOwn(TOOL_HANDLERS, name)) return rpcError(id, -32602, 'unknown tool: ' + String(name));
      return rpcResult(id, await callTool(name, message.params.arguments ?? {}));
    }
    return rpcError(id, -32601, 'method not found: ' + message.method);
  };

  const rpc = async (req, res) => {
    const { tooLarge, text } = await readBody(req);
    if (tooLarge) return sendJson(res, 413, { error: 'request body too large' });
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return sendJson(res, 200, rpcError(null, -32700, 'parse error'));
    }
    if (Array.isArray(message)) {
      const replies = (await Promise.all(message.map(dispatch))).filter((reply) => reply !== null);
      return replies.length ? sendJson(res, 200, replies) : sendEmpty(res, 202);
    }
    const reply = await dispatch(message);
    if (reply === null) return sendEmpty(res, 202);
    return sendJson(res, 200, reply);
  };

  const state = async (req, res) => {
    const { tooLarge, text } = await readBody(req);
    if (tooLarge) return sendJson(res, 413, { error: 'state body too large' });
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return sendJson(res, 400, { error: 'state body is not JSON' });
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return sendJson(res, 400, { error: 'state body must be an object' });
    storeSnapshot(value);
    return sendEmpty(res, 204);
  };

  return {
    async handle(req, res, pathname) {
      if (pathname === STATE_PATH) {
        if (req.method === 'POST') await state(req, res);
        else sendJson(res, 405, { error: 'method not allowed' });
        return true;
      }
      if (pathname !== ENDPOINT) return false;
      if (req.method === 'GET') sendJson(res, 200, { version: 1, name: 'thebird', transport: 'json-rpc-post', endpoint: ENDPOINT, tools: TOOL_LIST });
      else if (req.method === 'POST') await rpc(req, res);
      else sendJson(res, 405, { error: 'method not allowed' });
      return true;
    },
  };
}
