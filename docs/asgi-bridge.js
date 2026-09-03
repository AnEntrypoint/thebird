// Per-instance ASGI routing table. Each thebird instance owns its own Map of
// prefix -> Python callable (running in the instance's pyodide on the page
// thread). The instance's Service Worker (docs/sw-instance.js) also keeps a
// metadata mirror of the routing table for isolation witness.

const lifespanStarted = new WeakSet();

function getActiveRegistry() {
    if (typeof window === 'undefined') return null;
    const shell = window.__debug && window.__debug.shell;
    const active = shell && shell.active;
    if (active && active.asgiApps) return active.asgiApps;
    return null;
}

function normPrefix(prefix) {
    const norm = '/' + (prefix || '').replace(/^\/+|\/+$/g, '');
    return norm === '/' ? '/' : norm;
}

export function mountAsgi(app, prefix, registryOrInstance) {
    const reg = pickRegistry(registryOrInstance);
    const finalPrefix = normPrefix(prefix);
    reg.set(finalPrefix, app);
    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.asgiApps = reg; // last-mounted view for legacy debug
    }
    // Mirror to SW
    const inst = pickInstance(registryOrInstance);
    if (inst && inst.sw && inst.sw.call) {
        try { inst.sw.call('asgi-mount', { prefix: finalPrefix, kind: 'asgi' }); } catch { /* swallow: SW mirror is best-effort metadata for isolation witness, in-page registry above is already authoritative */ }
    }
    return finalPrefix;
}

export function unmountAsgi(prefix, registryOrInstance) {
    const reg = pickRegistry(registryOrInstance);
    const p = normPrefix(prefix);
    const r = reg.delete(p);
    const inst = pickInstance(registryOrInstance);
    if (inst && inst.sw && inst.sw.call) {
        try { inst.sw.call('asgi-unmount', { prefix: p }); } catch { /* swallow: SW mirror is best-effort metadata for isolation witness, in-page registry above is already authoritative */ }
    }
    return r;
}

export function findAsgiApp(path, registryOrInstance) {
    const reg = pickRegistry(registryOrInstance);
    let best = null;
    for (const prefix of reg.keys()) {
        if (prefix === '/' || path === prefix || path.startsWith(prefix + '/')) {
            if (!best || prefix.length > best.length) best = prefix;
        }
    }
    return best ? { prefix: best, app: reg.get(best) } : null;
}

function pickRegistry(arg) {
    if (arg instanceof Map) return arg;
    if (arg && arg.asgiApps instanceof Map) return arg.asgiApps;
    const active = getActiveRegistry();
    if (active) return active;
    // Legacy fallback: a single per-page map (kept only so unrelated callers
    // don't crash during boot transitions). This is no longer instance-keyed.
    if (!globalThis.__thebirdLegacyAsgiMap) globalThis.__thebirdLegacyAsgiMap = new Map();
    return globalThis.__thebirdLegacyAsgiMap;
}
function pickInstance(arg) {
    if (arg && arg.asgiApps && arg.sw) return arg;
    if (typeof window !== 'undefined') {
        const shell = window.__debug && window.__debug.shell;
        return shell && shell.active || null;
    }
    return null;
}

// Accepts an array of [k, v] pairs (duplicate header names preserved, per the
// ASGI headers-list spec), a Headers instance, or a plain object (legacy
// shape, one value per name -- kept for callers that haven't been updated to
// pass pairs). Always returns an ASGI-shaped list of byte-string pairs.
function headerPairs(headers) {
  let entries;
  if (!headers) entries = [];
  else if (Array.isArray(headers)) entries = headers;
  else if (typeof headers.entries === 'function' && typeof headers.forEach === 'function' && !(headers instanceof Map)) entries = [...headers.entries()];
  else if (headers instanceof Map) entries = [...headers.entries()];
  else entries = Object.entries(headers);
  return entries.map(([k, v]) => [
    new TextEncoder().encode(String(k).toLowerCase()),
    new TextEncoder().encode(String(v)),
  ]);
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
    method: (typeof method === 'string' ? method : 'GET').toUpperCase(),
    scheme: 'http',
    path: stripped,
    raw_path: new TextEncoder().encode(stripped),
    query_string: new TextEncoder().encode(u.search.replace(/^\?/, '')),
    root_path: root,
    headers: headerPairs(headers),
    // Synthetic placeholders: thebird runs ASGI apps in-browser with no real
    // network peer, so client/server identity is simulated, not observed.
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
    headers: headerPairs(headers),
    // Synthetic placeholders: in-browser ASGI has no real network peer.
    client: ['127.0.0.1', 0],
    server: ['thebird.local', 80],
    subprotocols: Array.from(subprotocols || []),
  };
}

async function ensureLifespan(app) {
  if (lifespanStarted.has(app)) return true;
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
  } catch { /* swallow: lifespan protocol is optional per ASGI spec, app may not implement it */ }
  // Only mark as started once the handshake actually resolved -- a timed-out
  // first attempt (app just slow to warm up) must not permanently skip the
  // await on every later call.
  if (resolved) lifespanStarted.add(app);
  return resolved;
}

export async function dispatchAsgi(method, path, headers, body, registryOrInstance) {
  const found = findAsgiApp(path, registryOrInstance);
  if (!found) return null;
  const { app, prefix } = found;
  const lifeStarted = await ensureLifespan(app);
  if (!lifeStarted) return { status: 503, headers: { 'content-type': 'text/plain' }, body: 'ASGI app startup timeout' };
  const scope = buildScope(method, path, headers, body, prefix);
  const bodyBuf = body == null ? new Uint8Array() : typeof body === 'string' ? new TextEncoder().encode(body) : body;
  let bodySent = false;
  const receive = async () => {
    if (bodySent) return { type: 'http.disconnect' };
    bodySent = true;
    return { type: 'http.request', body: bodyBuf, more_body: false };
  };
  let status = 500;
  const respHeadersMap = new Map(); // lowercased header name -> array of values (preserves repeats, e.g. multiple Set-Cookie)
  const respHeaders = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      const arr = respHeadersMap.get(prop);
      return arr ? arr.join(', ') : undefined;
    },
    set(_t, prop, value) {
      if (typeof prop === 'string') {
        const arr = respHeadersMap.get(prop) || [];
        arr.push(value);
        respHeadersMap.set(prop, arr);
      }
      return true;
    },
    has(_t, prop) { return typeof prop === 'string' && respHeadersMap.has(prop); },
    ownKeys() { return [...respHeadersMap.keys()]; },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop === 'string' && respHeadersMap.has(prop)) {
        return { enumerable: true, configurable: true, value: respHeadersMap.get(prop).join(', ') };
      }
      return undefined;
    },
  });
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
    if (msg.type === 'http.response.body' && !started) {
      throw new Error('ASGI protocol violation: http.response.body sent before http.response.start');
    }
    if (msg.type === 'http.response.start' && started) {
      throw new Error('ASGI protocol violation: http.response.start already sent');
    }
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
  try { await app(scope, receive, send); }
  catch (e) {
    if (!started) return { status: 500, headers: { 'content-type': 'text/plain' }, body: 'ASGI app error: ' + (e?.message || e) };
    else console.error('[asgi-bridge] app error after headers sent:', e);
  }
  if (!started) return { status: 500, headers: { 'content-type': 'text/plain' }, body: 'asgi: response.start never sent' };
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  const ct = respHeaders['content-type'] || '';
  const isText = ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('javascript');
  // Only decode to a JS string when we actually need to do string-level rewriting (HTML <head> injection).
  // Otherwise keep raw bytes end-to-end -- sw-instance.js already passes Uint8Array/ArrayBuffer straight into
  // `new Response(d.body, ...)` untouched, so decoding here just risks lossy-UTF8 corruption for text-labeled
  // content that isn't actually valid UTF-8 (Latin-1 CSVs, stray-invalid-byte JSON, etc) for no benefit.
  const needsHtmlRewrite = isText && ct.includes('text/html');
  let bodyOut = merged;
  if (needsHtmlRewrite) {
    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(merged); }
    catch (_) { decoded = null; } // not valid UTF-8 -- skip rewriting, pass raw bytes through untouched
    if (decoded !== null) bodyOut = decoded;
  }
  if (needsHtmlRewrite && typeof bodyOut === 'string' && bodyOut.includes('<head')) {
    bodyOut = bodyOut.replace(/(\b(?:src|href)=["'])\/(?!\/)/g, '$1./');
    const origin = typeof location !== 'undefined' ? location.origin : '';
    // Prefer the active instance's per-instance SW preview prefix; fall back to legacy debug ref.
    let scopePath;
    if (typeof window !== 'undefined') {
      const inst = registryOrInstance && registryOrInstance.sw ? registryOrInstance : window.__debug?.shell?.active;
      if (inst && inst.sw && inst.sw.previewPrefix) {
        scopePath = new URL(inst.sw.previewPrefix).pathname;
      } else {
        const swReg = window.__debug?.sw?.registration;
        scopePath = swReg ? new URL(swReg.scope).pathname : ((typeof location !== 'undefined' ? location.pathname.replace(/[^/]+$/, '') : '/') + 'preview/');
      }
    } else {
      scopePath = '/preview/';
    }
    const basePath = scopePath.replace(/\/$/, '') + prefix + '/';
    const baseUrl = origin + basePath;
    const historyScoper = `<script>(function(){var BP=${JSON.stringify(basePath.replace(/\/$/, ''))};function S(u){if(typeof u!=='string')return u;if(/^https?:/i.test(u))return u;if(u.startsWith(BP+'/')||u===BP)return u;if(u.startsWith('/'))return BP+u;return u;}var ps=history.pushState;history.pushState=function(s,t,u){return ps.call(this,s,t,S(u));};var rs=history.replaceState;history.replaceState=function(s,t,u){return rs.call(this,s,t,S(u));};var of=window.fetch;window.fetch=function(input,init){if(typeof input==='string')return of.call(this,S(input),init);if(input&&typeof input.url==='string'&&!/^https?:/i.test(input.url)&&input.url.startsWith('/')&&!input.url.startsWith(BP+'/')){return of.call(this,new Request(S(input.url),input),init);}return of.call(this,input,init);};var oxo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oxo.call(this,m,S(u),...Array.prototype.slice.call(arguments,2));};addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a||!a.getAttribute)return;var h=a.getAttribute('href');if(!h||/^[a-z]+:/i.test(h)||h.startsWith('#'))return;if(h.startsWith('/')&&!h.startsWith(BP+'/')&&h!==BP){e.preventDefault();history.pushState({},'',h);dispatchEvent(new PopStateEvent('popstate'));}},true);})();</script>`;
    if (!/<base\b/i.test(bodyOut)) {
      bodyOut = bodyOut.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${baseUrl}">\n  ${historyScoper}`);
    }
  }
  const headersAll = [];
  for (const [k, arr] of respHeadersMap) for (const v of arr) headersAll.push([k, v]);
  return { status, headers: respHeaders, headersAll, body: bodyOut };
}

const wsSendJsToPyDecoder = msg => {
  if (msg && typeof msg.toJs === 'function') return msg.toJs({ dict_converter: Object.fromEntries });
  if (msg && typeof msg.get === 'function' && typeof msg.has === 'function') {
    const t = msg.get('type');
    return { type: t, text: msg.get('text'), bytes: msg.get('bytes'), code: msg.get('code'), reason: msg.get('reason'), subprotocol: msg.get('subprotocol'), headers: msg.get('headers') };
  }
  return msg;
};

export function openWebSocket(path, { subprotocols = [], headers = {}, onOpen, onMessage, onClose, onError, registry } = {}) {
  const found = findAsgiApp(path, registry);
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
