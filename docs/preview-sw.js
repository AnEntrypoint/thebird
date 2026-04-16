self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith('/preview/')) return;
  const path = url.pathname.replace('/preview', '') || '/';
  e.respondWith((async () => {
    const chan = new MessageChannel();
    const clients_ = await clients.matchAll();
    if (clients_.length) clients_[0].postMessage({ type: 'EXPRESS_REQUEST', path, method: e.request.method }, [chan.port2]);
    return new Promise(res => {
      const timeout = setTimeout(() => res(new Response('timeout', { status: 504 })), 5000);
      chan.port1.onmessage = msg => {
        clearTimeout(timeout);
        res(new Response(msg.data.body, { status: msg.data.status, headers: { 'Content-Type': msg.data.contentType || 'text/html' } }));
      };
    });
  })());
});