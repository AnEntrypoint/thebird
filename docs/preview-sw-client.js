import { dispatchAsgi, findAsgiApp } from './asgi-bridge.js';

const SW_PATH = new URL('./preview-sw.js', import.meta.url).href;
const SCOPE = new URL('./preview/', import.meta.url).href;

const CT_MAP = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.txt': 'text/plain' };
function guessCt(p) {
  const i = p.lastIndexOf('.');
  return (i >= 0 && CT_MAP[p.slice(i).toLowerCase()]) || 'application/octet-stream';
}

window.__debug = window.__debug || {};
window.__debug.sw = { registered: false, error: null };

export async function registerPreviewSW({ readyTimeoutMs = 4000 } = {}) {
  if (!('serviceWorker' in navigator)) {
    window.__debug.sw.error = 'unsupported';
    throw new Error('ServiceWorker not supported');
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: SCOPE });
    // navigator.serviceWorker.ready hangs forever in some Chrome contexts
    // (incognito/headless without a stored controller). Wait on the
    // registration's own lifecycle with a bounded timeout instead.
    const active = await new Promise(resolve => {
      if (reg.active) return resolve(reg.active);
      const sw = reg.installing || reg.waiting;
      if (!sw) return resolve(null);
      const onChange = () => { if (sw.state === 'activated') resolve(sw); };
      sw.addEventListener('statechange', onChange);
      setTimeout(() => resolve(reg.active || null), readyTimeoutMs);
    });
    window.__debug.sw.registered = !!active;
    window.__debug.sw.registration = reg;
    if (!active) window.__debug.sw.error = 'sw not activated within ' + readyTimeoutMs + 'ms';
    return reg;
  } catch (err) {
    window.__debug.sw.error = err.message;
    throw err;
  }
}

navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'SW_STREAM_READ') {
    const path = e.data.path;
    const procsub = path.match(/^\/procsub\/(\d+)$/);
    if (procsub && window.__debug?.shell?.procsubRead) {
      const data = window.__debug.shell.procsubRead(procsub[1]);
      e.ports[0]?.postMessage({ data: data || '', found: data != null });
      return;
    }
    const fdM = path.match(/^\/dev\/fd\/(\d+)$/);
    if (fdM && window.__debug?.shell?.fdRead) {
      try { const data = window.__debug.shell.fdRead(fdM[1]); e.ports[0]?.postMessage({ data: data || '', found: true }); }
      catch { e.ports[0]?.postMessage({ data: '', found: false }); }
      return;
    }
    e.ports[0]?.postMessage({ found: false });
    return;
  }
  if (e.data?.type !== 'EXPRESS_REQUEST') return;
  const { path, method, body: reqBody, headers: reqHeaders } = e.data;
  const replyPort = e.ports[0];
  // Fast-path static dist assets (e.g. /hermes/assets/index.js, /hermes/favicon.ico)
  // Serve them directly from docs/vendor/<app>/<app's-dist-prefix>/... bypassing
  // Python entirely. Asgi-mounted prefix + manifest distFiles is the lookup key.
  const asgiMatch = findAsgiApp(path);
  if (asgiMatch && method === 'GET') {
    const rel = path.slice(asgiMatch.prefix.length).replace(/^\//, '') || '';
    const distMatch = rel && (window.__debug?.appDistFiles?.[asgiMatch.prefix]?.has?.(rel));
    if (distMatch) {
      const url = window.__debug.appDistBase[asgiMatch.prefix] + rel;
      fetch(url).then(async r => {
        const buf = await r.arrayBuffer();
        const ct = r.headers.get('content-type') || guessCt(rel);
        replyPort.postMessage({ status: r.status, body: ct.startsWith('text/') || ct.includes('json') || ct.includes('javascript') ? new TextDecoder().decode(buf) : new Uint8Array(buf), contentType: ct });
      }).catch(err => replyPort.postMessage({ status: 500, body: 'dist-fetch: ' + err.message, contentType: 'text/plain' }));
      return;
    }
  }
  if (asgiMatch) {
    dispatchAsgi(method, path, reqHeaders, reqBody)
      .then(r => replyPort.postMessage({ status: r.status, body: r.body, contentType: r.headers['content-type'] || 'text/plain' }))
      .catch(err => replyPort.postMessage({ status: 500, body: 'asgi: ' + err.message, contentType: 'text/plain' }));
    return;
  }
  const handlers = window.__debug?.shell?.httpHandlers || {};
  const app = Object.values(handlers)[0];
  if (!app?.routes) { replyPort.postMessage({ status: 503, body: '<h1>503</h1><p>no server running — run <code>node server.js</code> in terminal</p>', contentType: 'text/html' }); return; }
  const routes = app.routes[method] || [];
  const match = routes.find(r => r.path === '*' || r.path === path || path.startsWith(r.path));
  if (!match) { replyPort.postMessage({ status: 404, body: 'no route for ' + method + ' ' + path, contentType: 'text/plain' }); return; }
  let done = false;
  const finish = (status, body, ct) => { if (done) return; done = true; replyPort.postMessage({ status, body, contentType: ct }); };
  const res = {
    _body: '', _status: 200, _ct: 'text/html',
    writeHead(code, headers) { this._status = code; if (headers?.['Content-Type']) this._ct = headers['Content-Type']; return this; },
    setHeader(k, v) { if (k.toLowerCase() === 'content-type') this._ct = v; return this; },
    write(chunk) { this._body += String(chunk); return true; },
    end(chunk) { if (chunk != null) this._body += String(chunk); finish(this._status, this._body, this._ct); },
    send(b) { this._body = typeof b === 'string' ? b : JSON.stringify(b); finish(this._status, this._body, this._ct); },
    json(o) { this._ct = 'application/json'; this.send(JSON.stringify(o)); },
    status(n) { this._status = n; return this; },
  };
  let bodyConsumed = false;
  const req = {
    method, url: path, path, query: {}, headers: reqHeaders || {},
    [Symbol.asyncIterator]: async function* () { if (!bodyConsumed && reqBody) { bodyConsumed = true; yield reqBody; } },
  };
  try {
    const r = match.fn(req, res);
    if (r && typeof r.then === 'function') r.catch(err => finish(500, '<h1>500</h1><pre>' + String(err.message).replace(/</g, '&lt;') + '</pre>', 'text/html'));
  } catch (err) { finish(500, '<h1>500</h1><pre>' + String(err.message).replace(/</g, '&lt;') + '</pre>', 'text/html'); }
  setTimeout(() => finish(res._status, res._body, res._ct), 10000);
});
