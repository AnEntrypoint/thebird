const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const rpc = (data, meta) => meta ? { type: 'rpc', data, meta } : { type: 'rpc', data };
export const ndjson = (data, meta) => meta ? { type: 'ndjson', data, meta } : { type: 'ndjson', data };
export const json = (data, meta) => meta ? { type: 'json', data, meta } : { type: 'json', data };
export const text = (data, meta) => meta ? { type: 'text', data, meta } : { type: 'text', data };

export const encodeChunk = (chunk) => {
  if (chunk.type === 'ndjson' || chunk.type === 'text') return encoder.encode(`${chunk.data}\n`);
  return encoder.encode(`${JSON.stringify(chunk.data)}\n`);
};

export const decodeChunk = (bytes, source) => {
  const line = decoder.decode(bytes).trim();
  if (line === '') return null;
  try {
    return rpc(JSON.parse(line), { source });
  } catch {
    return ndjson(line, { source });
  }
};

export function createHub() {
  const endpoints = new Map();
  const routes = [];
  let sequence = 0;

  const deliver = async (chunk) => {
    const target = chunk.meta?.target;
    if (target !== undefined) {
      const endpoint = endpoints.get(target);
      if (!endpoint) return { type: 'error', data: { error: `unknown endpoint: ${target}` }, meta: { source: 'hub' } };
      const answer = await endpoint(chunk.data);
      return answer === undefined ? null : rpc(answer, { source: target, seq: ++sequence });
    }
    for (const route of routes) {
      if (route.match(chunk)) {
        const answer = await route.handler(chunk);
        if (answer !== undefined) return rpc(answer, { source: route.name, seq: ++sequence });
      }
    }
    return null;
  };

  return {
    attach(name, endpoint) {
      endpoints.set(name, endpoint);
      return () => endpoints.delete(name);
    },
    route(name, match, handler) {
      const entry = { name, match, handler };
      routes.push(entry);
      return () => routes.splice(routes.indexOf(entry), 1);
    },
    endpoints: () => [...endpoints.keys()],
    async send(line) {
      const chunk = typeof line === 'string' ? decodeChunk(encoder.encode(line), 'stdio') : line;
      if (!chunk) return null;
      const messages = Array.isArray(chunk.data) ? chunk.data : [chunk.data];
      const answers = await Promise.all(messages.map((message) => deliver(rpc(message, chunk.meta))));
      const kept = answers.filter((answer) => answer !== null);
      if (kept.length === 0) return '';
      return kept.map(encodeChunk).map((bytes) => decoder.decode(bytes).trim()).join('\n');
    },
  };
}
