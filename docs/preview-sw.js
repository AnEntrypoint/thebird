const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

function getMime(key) {
  const ext = key.slice(key.lastIndexOf('.'));
  return MIME[ext] || 'application/octet-stream';
}

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('thebird', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getFS(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fs', 'readonly');
    const store = tx.objectStore('fs');
    const req = store.get('thebird_fs_v2');
    req.onsuccess = () => resolve(req.result ? JSON.parse(req.result) : {});
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const idx = url.pathname.indexOf('/preview/');
  if (idx === -1) return;
  const key = url.pathname.slice(idx + '/preview/'.length) || 'index.html';
  e.respondWith(handlePreview(key, e.request));
});

async function handlePreview(key, request) {
  const db = await openIDB();
  const fs = await getFS(db);
  if (key in fs) return new Response(fs[key], { status: 200, headers: { 'Content-Type': getMime(key) } });
  const clients = await self.clients.matchAll({ type: 'window' });
  if (!clients.length) return new Response('not found: ' + key, { status: 404 });
  const { port1, port2 } = new MessageChannel();
  const result = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('express timeout')), 5000);
    port1.onmessage = e => { clearTimeout(t); res(e.data); };
    clients[0].postMessage({ type: 'EXPRESS_REQUEST', path: '/' + key, method: request.method }, [port2]);
  });
  if (!result || result.status === 404) return new Response('not found: ' + key, { status: 404 });
  return new Response(result.body, { status: result.status || 200, headers: { 'Content-Type': result.contentType || 'text/html' } });
}
