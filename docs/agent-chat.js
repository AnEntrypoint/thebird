import { streamGemini } from './vendor/thebird-browser.js';

const TOOLS = {
  read_file: {
    description: 'Read a file from the filesystem',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: async ({ path }) => {
      const c = window.__debug.container;
      if (!c) throw new Error('container not ready');
      return await c.fs.readFile(path, 'utf-8');
    },
  },
  write_file: {
    description: 'Write content to a file',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    execute: async ({ path, content }) => {
      const c = window.__debug.container;
      if (!c) throw new Error('container not ready');
      await c.fs.writeFile(path, content);
      return 'written: ' + path;
    },
  },
  run_command: {
    description: 'Run a shell command',
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
};

export async function agentGenerate(apiKey, model, messages, onChunk, onTool) {
  Object.assign(window.__debug = window.__debug || {}, {
    agent: { model, active: true },
  });
  try {
    for await (const ev of streamGemini({ model, messages, tools: TOOLS, apiKey, maxOutputTokens: 8192 }).fullStream) {
      if (ev.type === 'text-delta') onChunk(ev.textDelta);
      else if (ev.type === 'tool-call') onTool(ev.toolName, ev.args);
      else if (ev.type === 'error') throw ev.error;
    }
  } finally {
    window.__debug.agent.active = false;
  }
}
