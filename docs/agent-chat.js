const TOOLS = [
  { name: 'read_file', description: 'Read a file from the filesystem', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write content to a file', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] } },
  { name: 'run_command', description: 'Run a shell command', parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] } },
];

const toolHandlers = {
  read_file: async ({ path }) => {
    const c = window.__debug.container;
    if (!c) throw new Error('container not ready');
    return await c.fs.readFile(path, 'utf-8');
  },
  write_file: async ({ path, content }) => {
    const c = window.__debug.container;
    if (!c) throw new Error('container not ready');
    await c.fs.writeFile(path, content);
    return 'written: ' + path;
  },
  run_command: async ({ command }) => {
    const c = window.__debug.container;
    if (!c) throw new Error('container not ready');
    const proc = await c.spawn('sh', ['-c', command]);
    let out = '';
    await proc.output.pipeTo(new WritableStream({ write: d => { out += d; } }));
    return out || '(no output)';
  },
};

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function agentGenerate(apiKey, model, contents, onChunk, onTool) {
  while (true) {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, tools: [{ functionDeclarations: TOOLS }], generationConfig: { maxOutputTokens: 8192 } }),
    });
    if (!res.ok) throw new Error('Generate API ' + res.status + ': ' + await res.text());
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const finish = data.candidates?.[0]?.finishReason;
    for (const p of parts) if (p.text) onChunk(p.text);
    const calls = parts.filter(p => p.functionCall);
    if (finish === 'STOP' || calls.length === 0) break;
    const toolResults = await Promise.all(calls.map(async p => {
      const { name, args } = p.functionCall;
      onTool(name, args);
      let output;
      try { output = String(await toolHandlers[name](args)); }
      catch (e) { output = 'error: ' + e.message; }
      return { functionResponse: { name, response: { output } } };
    }));
    contents = [...contents, { role: 'model', parts }, { role: 'user', parts: toolResults }];
  }
}
