import { createServer } from 'node:http';
import { PAGE_HOST_TOOL_NAMES } from '../web/fx-host-tools.js';

export const FX_STUB_KEY = 'thebird-stub-key';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const lastUserText = (prompt) => {
  const message = [...(Array.isArray(prompt) ? prompt : [])].reverse().find((item) => item?.role === 'user');
  const part = (message?.content ?? []).find((item) => item?.type === 'text');
  return typeof part?.text === 'string' ? part.text : '';
};

const hasToolResult = (prompt) => {
  const items = Array.isArray(prompt) ? prompt : [];
  const lastUser = items.reduce((at, item, index) => (item?.role === 'user' ? index : at), -1);
  return items.slice(lastUser + 1).some((item) => item?.role === 'tool');
};

const directive = (text, pattern) => text.match(pattern)?.[1];

export const sseEvent = (event) => `data: ${JSON.stringify(event)}\n\n`;

export function streamPlan({ prompt, tools = [] }) {
  const text = lastUserText(prompt);
  const toolName = directive(text, /\[tool:([\w.-]+)\]/);
  const toolInput = directive(text, /\[input:(\{.*?\})\]/);
  const lines = Number(directive(text, /\[lines:(\d+)\]/) ?? 0);
  const answered = hasToolResult(prompt);
  const advertised = PAGE_HOST_TOOL_NAMES.includes(toolName) && tools.some((tool) => tool?.name === toolName);
  if (toolName && !answered && advertised) {
    let input = {};
    try { input = toolInput ? JSON.parse(toolInput) : {}; } catch { input = {}; }
    return {
      events: [
        { type: 'tool-input-start', id: 'call_stub_1', toolName },
        { type: 'tool-input-delta', id: 'call_stub_1', delta: JSON.stringify(input) },
        { type: 'tool-input-end', id: 'call_stub_1' },
        { type: 'tool-call', toolCallId: 'call_stub_1', toolName, input },
      ],
      finish: 'tool-calls',
    };
  }
  if (lines > 0) {
    const body = Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n');
    return { events: [{ type: 'text-delta', id: 't', delta: body }], finish: 'stop' };
  }
  const suffix = answered ? ' tool-result=seen' : '';
  const refused = toolName && !advertised ? ` tool-not-advertised=${toolName}` : '';
  return {
    events: [{ type: 'text-delta', id: 't', delta: `stub gateway answer: prompt=${text} streaming=true authorized=true${suffix}${refused}` }],
    finish: 'stop',
  };
}

export function startFxStubGateway({ port = 0, host = '127.0.0.1' } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method !== 'POST' || req.url !== '/v4/ai/language-model') {
      res.writeHead(404, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'unknown endpoint' } }));
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const streaming = req.headers['ai-language-model-streaming'] === 'true';
      const authorized = req.headers.authorization === `Bearer ${FX_STUB_KEY}`;
      let request = {};
      try {
        request = JSON.parse(body);
      } catch {
        request = {};
      }
      const prompt = lastUserText(request.prompt);
      seen.push({ streaming, authorized, prompt, roles: (Array.isArray(request.prompt) ? request.prompt : []).map((item) => item?.role), tools: (request.tools ?? []).map((tool) => tool?.name) });
      if (!authorized) {
        res.writeHead(401, { ...CORS, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      }
      if (!streaming) {
        res.writeHead(400, { ...CORS, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'stub expects a streaming request' } }));
      }
      const plan = streamPlan(request);
      res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream' });
      for (const event of plan.events) res.write(sseEvent(event));
      res.end(sseEvent({ type: 'finish', finishReason: { unified: plan.finish } }));
    });
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({
      url: `http://${host}:${server.address().port}/v4/ai/language-model`,
      seen,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}
