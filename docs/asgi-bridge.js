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

function stripPrefix(path, prefix) {
  if (prefix === '/' || !prefix) return path;
  if (path === prefix) return '/';
  if (path.startsWith(prefix + '/')) return path.slice(prefix.length);
  return path;
}

export function buildScope(method, path, headers, body, prefix) {
  const u = new URL(path, 'http://thebird.local');
  const fullPath = u.pathname;
  const stripped = stripPrefix(fullPath, prefix);
  const root = prefix === '/' ? '' : prefix;
  return {
    type: 'http',
    asgi: { version: '3.0', spec_version: '2.3' },
    http_version: '1.1',
    method: method.toUpperCase(),
    scheme: 'http',
    path: stripped,
    raw_path: new TextEncoder().encode(stripped),
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

export function buildWsScope(path, headers, prefix, subprotocols = []) {
  const u = new URL(path, 'ws://thebird.local');
  const stripped = stripPrefix(u.pathname, prefix);
  const root = prefix === '/' ? '' : prefix;
  return {
    type: 'websocket',
    asgi: { version: '3.0', spec_version: '2.3' },
    http_version: '1.1',
    scheme: 'ws',
    path: stripped,
    raw_path: new TextEncoder().encode(stripped),
    query_string: new TextEncoder().encode(u.search.replace(/^\?/, '')),
    root_path: root,
    headers: Object.entries(headers || {}).map(([k, v]) => [
      new TextEncoder().encode(k.toLowerCase()),
      new TextEncoder().encode(String(v)),
    ]),
    client: ['127.0.0.1', 0],
    server: ['thebird.local', 80],
    subprotocols: Array.from(subprotocols || []),
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
  const isText = ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('javascript');
  let bodyOut = isText ? new TextDecoder().decode(merged) : merged;
  // For SPA HTML responses served at the prefix root, rewrite root-relative
  // asset URLs to base-relative so they resolve under the iframe's prefix
  // path instead of the server root. Root-relative (/foo) bypasses <base>;
  // path-relative (./foo) honours it.
  if (isText && ct.includes('text/html') && bodyOut.includes('<head')) {
    const reqPath = scope.path;
    if (reqPath === '/' || reqPath.endsWith('/index.html')) {
      // Rewrite root-relative src/href to path-relative FIRST (don't touch base href)
      bodyOut = bodyOut.replace(/(\b(?:src|href)=["'])\/(?!\/)/g, '$1./');
      // Then inject absolute base href (uses //origin/ so URL rewrite above can't have touched it)
      const origin = typeof location !== 'undefined' ? location.origin : '';
      const baseUrl = origin + (typeof location !== 'undefined' ? location.pathname.replace(/[^/]+$/, '') : '/') + 'preview' + prefix + '/';
      if (!/<base\b/i.test(bodyOut)) {
        bodyOut = bodyOut.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${baseUrl}">`);
      }
    }
  }
  return { status, headers: respHeaders, body: bodyOut };
}

const wsSendJsToPyDecoder = msg => {
  if (msg && typeof msg.toJs === 'function') return msg.toJs({ dict_converter: Object.fromEntries });
  if (msg && typeof msg.get === 'function' && typeof msg.has === 'function') {
    const t = msg.get('type');
    return { type: t, text: msg.get('text'), bytes: msg.get('bytes'), code: msg.get('code'), reason: msg.get('reason'), subprotocol: msg.get('subprotocol'), headers: msg.get('headers') };
  }
  return msg;
};

export function openWebSocket(path, { subprotocols = [], headers = {}, onOpen, onMessage, onClose, onError } = {}) {
  const found = findAsgiApp(path);
  if (!found) { onError?.(new Error('no asgi app for ' + path)); return null; }
  const { app, prefix } = found;
  const scope = buildWsScope(path, headers, prefix, subprotocols);
  const inbox = [];
  let inboxResolver = null;
  let connected = false;
  let closed = false;
  const pushInbox = ev => {
    if (inboxResolver) { const r = inboxResolver; inboxResolver = null; r(ev); }
    else inbox.push(ev);
  };
  const receive = async () => {
    if (inbox.length) return inbox.shift();
    return new Promise(r => { inboxResolver = r; });
  };
  const send = async (msgIn) => {
    const msg = wsSendJsToPyDecoder(msgIn);
    if (msg.type === 'websocket.accept') { connected = true; onOpen?.(msg.subprotocol || null); }
    else if (msg.type === 'websocket.send') {
      const t = msg.text != null ? msg.text : (msg.bytes != null ? new TextDecoder().decode(msg.bytes instanceof Uint8Array ? msg.bytes : new Uint8Array(msg.bytes)) : '');
      onMessage?.(t);
    }
    else if (msg.type === 'websocket.close') { closed = true; onClose?.(msg.code || 1000, msg.reason || ''); }
  };
  pushInbox({ type: 'websocket.connect' });
  const runner = (async () => {
    try { await app(scope, receive, send); }
    catch (e) { onError?.(e); }
    if (!closed) { closed = true; onClose?.(1006, 'app exited'); }
    // Wake any pending receive() so the runner finalises cleanly
    if (inboxResolver) { const r = inboxResolver; inboxResolver = null; r({ type: 'websocket.disconnect', code: 1000 }); }
  })();
  return {
    send: text => pushInbox({ type: 'websocket.receive', text: String(text) }),
    sendBytes: data => pushInbox({ type: 'websocket.receive', bytes: data instanceof Uint8Array ? data : new Uint8Array(data) }),
    close: (code = 1000, reason = '') => pushInbox({ type: 'websocket.disconnect', code, reason }),
    isOpen: () => connected && !closed,
    runner,
  };
}
