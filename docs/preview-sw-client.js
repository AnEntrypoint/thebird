const SW_PATH = new URL('./preview-sw.js', import.meta.url).href;
const SCOPE = new URL('./preview/', import.meta.url).href;

window.__debug = window.__debug || {};
window.__debug.sw = { registered: false, error: null };

export async function registerPreviewSW() {
  if (!('serviceWorker' in navigator)) {
    window.__debug.sw.error = 'unsupported';
    throw new Error('ServiceWorker not supported');
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: SCOPE });
    await navigator.serviceWorker.ready;
    window.__debug.sw.registered = true;
    window.__debug.sw.registration = reg;
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
