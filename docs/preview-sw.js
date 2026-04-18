self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const swScope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(swScope.pathname)) return;
  const path = '/' + url.pathname.slice(swScope.pathname.length).replace(/^\//, '') || '/';
  e.respondWith((async () => {
    const body = ['POST', 'PUT', 'PATCH'].includes(e.request.method) ? await e.request.text() : null;
    const headers = {};
    e.request.headers.forEach((v, k) => { headers[k] = v; });
    const chan = new MessageChannel();
    const clients_ = await clients.matchAll({ includeUncontrolled: true });
    const target = clients_.find(c => c.frameType !== 'nested') || clients_[0];
    if (!target) return new Response('no client', { status: 503 });
    target.postMessage({ type: 'EXPRESS_REQUEST', path, method: e.request.method, body, headers }, [chan.port2]);
    return new Promise(res => {
      const timeout = setTimeout(() => res(new Response('timeout', { status: 504 })), 10000);
      chan.port1.onmessage = msg => {
        clearTimeout(timeout);
        res(new Response(msg.data.body, { status: msg.data.status || 200, headers: { 'Content-Type': msg.data.contentType || 'text/html' } }));
      };
    });
  })());
});