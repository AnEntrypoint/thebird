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
  const key = url.pathname.slice(idx + '/preview/'.length);
  e.respondWith(
    openIDB()
      .then(db => getFS(db))
      .then(fs => {
        if (!(key in fs)) return new Response('not found: ' + key, { status: 404 });
        return new Response(fs[key], { status: 200, headers: { 'Content-Type': getMime(key) } });
      })
  );
});
