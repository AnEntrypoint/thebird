const http = require('http');
const { streamGemini, generateGemini } = require('./index.js');

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

http.createServer(async (req, res) => {
  state.requests++;
  state.active++;
  try {
    if (req.method === 'GET' && req.url === '/debug/server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/messages') {
      await handleMessages(req, res);
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (err) {
    state.errors++;
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  } finally {
    state.active--;
  }
}).listen(PORT, () => process.stderr.write(`thebird proxy listening on ${PORT}\n`));
