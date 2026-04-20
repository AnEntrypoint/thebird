const swJobs = new Map();
const swFds = new Map();
const swProcsubs = new Map();

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('message', e => {
  const d = e.data;
  if (!d) return;
  if (d.type === 'JOB_REGISTER') swJobs.set(d.id + '@' + d.tabId, { id: d.id, cmd: d.cmd, tabId: d.tabId, startedAt: Date.now() });
  else if (d.type === 'JOB_UNREGISTER') swJobs.delete(d.id + '@' + d.tabId);
  else if (d.type === 'JOB_LIST') e.ports?.[0]?.postMessage({ jobs: [...swJobs.values()] });
  else if (d.type === 'PROCSUB_PUT') swProcsubs.set(d.id, d.data);
  else if (d.type === 'FD_PUT') swFds.set(d.id, d.data);
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const swScope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(swScope.pathname)) return;
  const path = '/' + url.pathname.slice(swScope.pathname.length).replace(/^\//, '') || '/';

  const procsubM = path.match(/^\/procsub\/(\d+)$/);
  if (procsubM) { e.respondWith(serveFromClient(path, e.request)); return; }
  if (path.startsWith('/dev/fd/')) { e.respondWith(serveFromClient(path, e.request)); return; }
  const tcpM = path.match(/^\/dev\/tcp\/([^/]+)\/(\d+)(\/.*)?$/);
  if (tcpM) { e.respondWith(fetch('http://' + tcpM[1] + ':' + tcpM[2] + (tcpM[3] || '/'), { method: e.request.method, body: e.request.method !== 'GET' ? e.request.body : undefined })); return; }

  e.respondWith(forwardExpress(e.request, path));
});

async function serveFromClient(path, request) {
  const clients_ = await clients.matchAll({ includeUncontrolled: true });
  const target = clients_.find(c => c.frameType !== 'nested') || clients_[0];
  if (!target) return new Response('no client', { status: 503 });
  const chan = new MessageChannel();
  target.postMessage({ type: 'SW_STREAM_READ', path }, [chan.port2]);
  return new Promise(res => {
    const timeout = setTimeout(() => res(new Response('timeout', { status: 504 })), 5000);
    chan.port1.onmessage = msg => {
      clearTimeout(timeout);
      if (!msg.data?.found) res(new Response('not found', { status: 404 }));
      else res(new Response(msg.data.data, { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    };
  });
}

async function forwardExpress(request, path) {
  const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.text() : null;
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const chan = new MessageChannel();
  const clients_ = await clients.matchAll({ includeUncontrolled: true });
  const target = clients_.find(c => c.frameType !== 'nested') || clients_[0];
  if (!target) return new Response('no client', { status: 503 });
  target.postMessage({ type: 'EXPRESS_REQUEST', path, method: request.method, body, headers }, [chan.port2]);
  return new Promise(res => {
    const timeout = setTimeout(() => res(new Response('timeout', { status: 504 })), 10000);
    chan.port1.onmessage = msg => {
      clearTimeout(timeout);
      res(new Response(msg.data.body, { status: msg.data.status || 200, headers: { 'Content-Type': msg.data.contentType || 'text/html' } }));
    };
  });
}
