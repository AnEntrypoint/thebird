import { streamGemini, streamOpenAI } from './vendor/thebird-browser.js';
import { streamKiloHTTP } from './kilo-http-stream.js';

function idbRead(path) {
  const snap = window.__debug.idbSnapshot;
  if (!snap) throw new Error('idb snapshot not ready');
  if (!(path in snap)) throw new Error('not found in snapshot: ' + path);
  return snap[path];
}

function idbWrite(path, content) {
  const snap = window.__debug.idbSnapshot;
  if (!snap) throw new Error('idb snapshot not ready');
  snap[path] = content;
  window.__debug.idbPersist?.();
  window.__debug.shell?.onPreviewWrite?.();
}

const TOOLS = {
  read_file: {
    description: 'Read a file from the filesystem',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: async ({ path }) => {
      const c = window.__debug.container;
      if (c) return await c.fs.readFile(path, 'utf-8');
      return idbRead(path);
    },
  },
  write_file: {
    description: 'Write content to a file',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    execute: async ({ path, content }) => {
      const c = window.__debug.container;
      if (c) await c.fs.writeFile(path, content);
      idbWrite(path, content);
      return 'written: ' + path;
    },
  },
  list_files: {
    description: 'List files available in the filesystem',
    parameters: { type: 'object', properties: { prefix: { type: 'string' } }, required: [] },
    execute: async ({ prefix }) => {
      const snap = window.__debug.idbSnapshot || {};
      const keys = Object.keys(snap).sort();
      return (prefix ? keys.filter(k => k.startsWith(prefix)) : keys).join('\n') || '(empty)';
    },
  },
  run_command: {
    description: 'Run a shell command in the WebContainer',
    parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] },
    execute: async ({ command, cwd }) => {
      const c = window.__debug.container;
      if (!c) throw new Error('container not ready');
      const proc = await c.spawn('sh', ['-c', command], cwd ? { cwd } : undefined);
      let out = '';
      await proc.output.pipeTo(new WritableStream({ write: d => { out += d; } }));
      await proc.exit;
      return out || '(no output)';
    },
  },
  read_terminal: {
    description: 'Read the current terminal display (last N lines)',
    parameters: { type: 'object', properties: { lines: { type: 'number' } }, required: [] },
    execute: async ({ lines = 50 }) => {
      const term = window.__debug.term;
      if (!term) throw new Error('terminal not ready');
      const buf = term.buffer.active;
      const end = buf.length;
      const start = Math.max(0, end - lines);
      const out = [];
      for (let y = start; y < end; y++) {
        const line = buf.getLine(y);
        if (line) out.push(line.translateToString(true));
      }
      return out.join('\n').trimEnd() || '(empty)';
    },
  },
  send_to_terminal: {
    description: 'Send input to the terminal shell (use \\n for newline/Enter)',
    parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
    execute: async ({ input }) => {
      const w = window.__debug.shellWriter;
      if (!w) throw new Error('shell not ready');
      await w.write(input);
      return 'sent: ' + JSON.stringify(input);
    },
  },
};

function buildStream(provider) {
  if (provider.type === 'gemini') {
    return streamGemini({ model: provider.model, messages: provider.messages, tools: TOOLS, apiKey: provider.apiKey, maxOutputTokens: 8192 }).fullStream;
  }
  if (provider.type === 'kilo' || provider.type === 'opencode') {
    return streamKiloHTTP({ url: provider.baseUrl, model: provider.model, messages: provider.messages, providerType: provider.type });
  }
  const url = (provider.baseUrl || '').replace(/\/$/, '') + '/chat/completions';
  return streamOpenAI({ url, apiKey: provider.apiKey, messages: provider.messages, model: provider.model, tools: TOOLS, maxOutputTokens: 8192 });
}

export async function agentGenerate(provider, messages, onChunk, onTool) {
  Object.assign(window.__debug = window.__debug || {}, {
    agent: { provider: provider.type, model: provider.model, active: true, lastTool: null, lastError: null },
  });
  try {
    for await (const ev of buildStream({ ...provider, messages })) {
      if (ev.type === 'text-delta') onChunk(ev.textDelta);
      else if (ev.type === 'tool-call') {
        window.__debug.agent.lastTool = { name: ev.toolName, args: ev.args };
        onTool(ev.toolName, ev.args);
      } else if (ev.type === 'error') throw ev.error;
    }
  } catch (e) {
    window.__debug.agent.lastError = { message: e.message, stack: e.stack, timestamp: Date.now() };
    throw e;
  } finally {
    window.__debug.agent.active = false;
  }
}
