import { createServer } from 'node:http';

export const FX_STUB_KEY = 'thebird-stub-key';
export const FX_STUB_PORT = Number(process.env.THEBIRD_FX_STUB_PORT ?? 18931);

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

export function startFxStubGateway({ port = FX_STUB_PORT, host = '127.0.0.1' } = {}) {
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
      let prompt = '';
      try {
        prompt = lastUserText(JSON.parse(body).prompt);
      } catch {
        prompt = '';
      }
      seen.push({ streaming, authorized, prompt });
      if (!authorized) {
        res.writeHead(401, { ...CORS, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      }
      if (!streaming) {
        res.writeHead(400, { ...CORS, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'stub expects a streaming request' } }));
      }
      res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'text-delta', id: 't', delta: `stub gateway answer: prompt=${prompt} streaming=${streaming} authorized=${authorized}` })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: 'finish', finishReason: { unified: 'stop' } })}\n\n`);
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
