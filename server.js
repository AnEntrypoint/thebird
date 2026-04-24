const http = require('http');
const { streamGemini, generateGemini } = require('acptoapi');

const PORT = process.env.PORT || 3456;
const state = { requests: 0, errors: 0, active: 0 };

const sse = (ev, data) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;

const msgId = () => 'msg_' + Math.random().toString(36).slice(2, 12);

async function handleMessages(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { model, messages, system, stream, max_tokens } = JSON.parse(body);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'GEMINI_API_KEY required' })); return; }
  const params = { model: model || 'gemini-2.5-flash', messages, system, apiKey, maxOutputTokens: max_tokens || 8192 };

  if (!stream) {
    const result = await generateGemini(params);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: msgId(), type: 'message', role: 'assistant', model: params.model,
      content: [{ type: 'text', text: result.text }],
      stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 },
    }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const id = msgId();
  res.write(sse('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [], model: params.model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }));
  res.write(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  res.write(sse('ping', { type: 'ping' }));

  let outputTokens = 0;
  for await (const ev of streamGemini(params).fullStream) {
    if (ev.type === 'text-delta') {
      outputTokens += ev.textDelta.length;
      res.write(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ev.textDelta } }));
    }
  }

  res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
  res.write(sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens } }));
  res.write(sse('message_stop', { type: 'message_stop' }));
  res.end();
}

const landingPage = () => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>thebird proxy</title>
<style>
  body { font-family: monospace; background: #000; color: #33ff33; padding: 2ch; margin: 0; }
  h1 { margin-top: 0; }
  .stat { border: 1px solid #1a9a1a; padding: 1ch; margin: 1ch 0; }
  code { background: #111; padding: 0 0.5ch; }
  .endpoint { color: #1a9a1a; }
  a { color: #33ff33; }
</style></head>
<body>
<h1>▀█▀ █░█ █▀▀ █▄▄ █ █▀█ █▀▄ — thebird proxy</h1>
<div class="stat">
  <strong>status:</strong> running on port ${PORT}<br>
  <strong>requests:</strong> ${state.requests} | <strong>errors:</strong> ${state.errors} | <strong>active:</strong> ${state.active}
</div>
<h2>endpoints</h2>
<ul>
  <li><span class="endpoint">POST /v1/messages</span> — Anthropic Messages API (translated to Gemini)</li>
  <li><span class="endpoint">GET /debug/server</span> — <a href="debug/server">live state JSON</a></li>
  <li><span class="endpoint">GET /</span> — this landing page</li>
</ul>
<h2>usage</h2>
<pre>curl -X POST http://localhost:${PORT}/v1/messages \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":100}'</pre>
<p>Set <code>GEMINI_API_KEY</code> in env before sending messages.</p>
</body></html>`;

http.createServer(async (req, res) => {
  state.requests++;
  state.active++;
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(landingPage());
      return;
    }
    if (req.method === 'GET' && req.url === '/debug/server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/messages') {
      await handleMessages(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>404</title>
<style>body{font-family:monospace;background:#000;color:#ff3333;padding:2ch;margin:0}h1{color:#33ff33}a{color:#33ff33}.box{border:1px solid #ff3333;padding:1ch;margin:1ch 0}</style></head>
<body><h1>404</h1><div class="box">not found: <code>${req.method} ${req.url}</code></div>
<p><a href="./">← back to landing page</a></p></body></html>`);
  } catch (err) {
    state.errors++;
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>500</title>
<style>body{font-family:monospace;background:#000;color:#ff3333;padding:2ch;margin:0}pre{background:#111;padding:1ch;overflow:auto}</style></head>
<body><h1>500 — server error</h1><pre>${err.message.replace(/</g, '&lt;')}</pre></body></html>`);
  } finally {
    state.active--;
  }
}).listen(PORT, () => process.stderr.write(`thebird proxy listening on ${PORT}\n`));
