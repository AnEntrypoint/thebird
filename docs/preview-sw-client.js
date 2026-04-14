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

registerPreviewSW();

navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type !== 'EXPRESS_REQUEST') return;
  const { path, method } = e.data;
  const replyPort = e.ports[0];
  const handlers = window.__debug?.shell?.httpHandlers || {};
  const app = Object.values(handlers)[0];
  if (!app?.routes) { replyPort.postMessage({ status: 404, body: 'no express app' }); return; }
  const routes = app.routes[method] || [];
  const match = routes.find(r => r.path === '*' || r.path === path || path.startsWith(r.path));
  if (!match) { replyPort.postMessage({ status: 404, body: 'no route for ' + path }); return; }
  const res = {
    _body: '', _status: 200, _ct: 'text/html',
    send(b) { this._body = b; replyPort.postMessage({ status: this._status, body: this._body, contentType: this._ct }); },
    json(o) { this._ct = 'application/json'; this.send(JSON.stringify(o)); },
    status(n) { this._status = n; return this; },
  };
  const req = { method, path, query: {}, headers: {} };
  try { match.fn(req, res); } catch (err) { replyPort.postMessage({ status: 500, body: err.message }); }
});
