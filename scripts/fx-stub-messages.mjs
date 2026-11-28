import { createServer } from 'node:http';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS' };

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const partsOf = (message) => (Array.isArray(message?.content) ? message.content : [{ type: 'text', text: String(message?.content ?? '') }]);

const hasToolResult = (messages) => messages.some((message) => partsOf(message).some((part) => part.type === 'tool_result'));

const modeOf = (messages) => {
  const text = messages.filter((message) => message.role === 'user').flatMap(partsOf).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  return text.match(/\[cut:([a-z-]+)\]/)?.[1] ?? 'none';
};

const head = () => [
  sse('message_start', { message: { id: 'msg_stub', type: 'message', role: 'assistant', content: [], model: 'stub/model', stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Let me build this now.' } }),
  sse('content_block_stop', { index: 0 }),
];

const toolBlock = () => [
  sse('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_stub1', name: 'thebird_ports', input: {} } }),
  sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }),
  sse('content_block_stop', { index: 1 }),
];

const tail = (reason) => [
  sse('message_delta', { delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 5 } }),
  sse('message_stop', {}),
];

const finalAnswer = () => [
  ...head().slice(0, 2),
  sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'stub messages answer: tool-result=seen' } }),
  sse('content_block_stop', { index: 0 }),
  ...tail('end_turn'),
];

const planOf = (messages) => {
  if (hasToolResult(messages)) return { mode: 'answer', chunks: finalAnswer(), end: 'close' };
  const mode = modeOf(messages);
  if (mode === 'after-tool') return { mode, chunks: [...head(), ...toolBlock()], end: 'close' };
  if (mode === 'mid-delta') return { mode, chunks: [...head(), sse('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_stub1', name: 'thebird_ports', input: {} } }).slice(0, 90)], end: 'close' };
  if (mode === 'hold') return { mode, chunks: [...head(), ...toolBlock()], end: 'hold' };
  return { mode: 'none', chunks: [...head(), ...toolBlock(), ...tail('tool_use')], end: 'close' };
};

export const startFxStubMessages = ({ host = '127.0.0.1', port = 0 } = {}) => {
  const streams = [];
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method !== 'POST' || !req.url.endsWith('/messages')) {
      res.writeHead(404, { ...CORS, 'content-type': 'application/json' });
      return res.end('{"error":{"message":"not found"}}');
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let request = {};
      try { request = JSON.parse(Buffer.concat(chunks).toString()); } catch { request = {}; }
      const plan = planOf(Array.isArray(request.messages) ? request.messages : []);
      const record = { mode: plan.mode, events: plan.chunks.length, bytesWritten: 0, ended: false, clientClosed: false, held: plan.end === 'hold', tools: (request.tools ?? []).map((tool) => tool.name) };
      streams.push(record);
      res.on('close', () => { record.clientClosed = !record.ended; });
      res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const chunk of plan.chunks) {
        res.write(chunk);
        record.bytesWritten += Buffer.byteLength(chunk);
      }
      if (plan.end === 'close') {
        record.ended = true;
        res.end();
      }
    });
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({
      port: server.address().port,
      streams,
      close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
    }));
  });
};
