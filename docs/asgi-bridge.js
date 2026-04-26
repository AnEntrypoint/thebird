const apps = new Map();
const lifespanStarted = new WeakSet();

export function mountAsgi(app, prefix) {
  const norm = '/' + (prefix || '').replace(/^\/+|\/+$/g, '');
  const finalPrefix = norm === '/' ? '/' : norm;
  apps.set(finalPrefix, app);
  if (typeof window !== 'undefined') {
    window.__debug = window.__debug || {};
    window.__debug.asgiApps = apps;
  }
  return finalPrefix;
}

export function unmountAsgi(prefix) {
  const norm = '/' + (prefix || '').replace(/^\/+|\/+$/g, '');
  return apps.delete(norm === '/' ? '/' : norm);
}

export function findAsgiApp(path) {
  let best = null;
  for (const prefix of apps.keys()) {
    if (prefix === '/' || path === prefix || path.startsWith(prefix + '/')) {
      if (!best || prefix.length > best.length) best = prefix;
    }
  }
  return best ? { prefix: best, app: apps.get(best) } : null;
}

export function buildScope(method, path, headers, body, prefix) {
  const u = new URL(path, 'http://thebird.local');
  const rawPath = u.pathname;
  const root = prefix === '/' ? '' : prefix;
  return {
    type: 'http',
    asgi: { version: '3.0', spec_version: '2.3' },
    http_version: '1.1',
    method: method.toUpperCase(),
    scheme: 'http',
    path: rawPath,
    raw_path: new TextEncoder().encode(rawPath),
    query_string: new TextEncoder().encode(u.search.replace(/^\?/, '')),
    root_path: root,
    headers: Object.entries(headers || {}).map(([k, v]) => [
      new TextEncoder().encode(k.toLowerCase()),
      new TextEncoder().encode(String(v)),
    ]),
    client: ['127.0.0.1', 0],
    server: ['thebird.local', 80],
  };
}

async function ensureLifespan(app) {
  if (lifespanStarted.has(app)) return;
  lifespanStarted.add(app);
  const events = [{ type: 'lifespan.startup' }];
  let resolved = false;
  try {
    await Promise.race([
      app(
        { type: 'lifespan', asgi: { version: '3.0', spec_version: '2.0' } },
        async () => events.shift() || { type: 'lifespan.shutdown' },
        async (msg) => { if (msg?.type?.startsWith('lifespan.')) resolved = true; },
      ),
      new Promise(r => setTimeout(r, 1500)),
    ]);
  } catch { /* lifespan optional */ }
  return resolved;
}

export async function dispatchAsgi(method, path, headers, body) {
  const found = findAsgiApp(path);
  if (!found) return null;
  const { app, prefix } = found;
  await ensureLifespan(app);
  const scope = buildScope(method, path, headers, body, prefix);
  const bodyBuf = body == null ? new Uint8Array() : typeof body === 'string' ? new TextEncoder().encode(body) : body;
  let bodySent = false;
  const receive = async () => {
    if (bodySent) return { type: 'http.disconnect' };
    bodySent = true;
    return { type: 'http.request', body: bodyBuf, more_body: false };
  };
  let status = 500;
  let respHeaders = {};
  const chunks = [];
  let started = false;
  const toJs = msg => {
    if (msg && typeof msg.toJs === 'function') return msg.toJs({ dict_converter: Object.fromEntries });
    if (msg && typeof msg.get === 'function' && typeof msg.has === 'function') {
      return { type: msg.get('type'), status: msg.get('status'), headers: msg.get('headers'), body: msg.get('body') };
    }
    return msg;
  };
  const send = async (msgIn) => {
    const msg = toJs(msgIn);
    if (msg.type === 'http.response.start') {
      status = msg.status || 200;
      for (const pair of msg.headers || []) {
        const [k, v] = Array.isArray(pair) ? pair : pair.toJs ? pair.toJs() : pair;
        const kk = (k instanceof Uint8Array ? new TextDecoder().decode(k) : String(k)).toLowerCase();
        const vv = v instanceof Uint8Array ? new TextDecoder().decode(v) : String(v);
        respHeaders[kk] = vv;
      }
      started = true;
    } else if (msg.type === 'http.response.body') {
      if (msg.body) chunks.push(msg.body instanceof Uint8Array ? msg.body : new TextEncoder().encode(String(msg.body)));
    }
  };
  await app(scope, receive, send);
  if (!started) return { status: 500, headers: { 'content-type': 'text/plain' }, body: 'asgi: response.start never sent' };
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  const ct = respHeaders['content-type'] || '';
  const bodyOut = ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('javascript')
    ? new TextDecoder().decode(merged)
    : merged;
  return { status, headers: respHeaders, body: bodyOut };
}
