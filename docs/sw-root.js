// Root-scope Service Worker: app-shell caching for offline boot +
// installability. Registered separately from the per-instance workers
// (docs/sw-instance.js / docs/sw-iN/index.js, which own scope ./sw-i<N>/
// and per-instance IDB state — see AGENTS.md "per-instance SW isolation").
// This worker is deliberately minimal: cache-on-install of the static shell
// needed to boot the page, then cache-first-falling-back-to-network on
// fetch. It does NOT try to solve full offline sync, background sync, or
// asset versioning beyond a bump of CACHE_NAME.
//
// Scope: root ('/'), which is broader than but does not conflict with the
// more specific ./sw-i<N>/ scopes — the browser always dispatches a request
// to the SW with the longest matching registered scope, so an active
// per-instance worker still wins inside its own scope.

const CACHE_NAME = 'thebird-shell-v2';

// anentrypoint-design's 247420.css now loads live from unpkg @latest
// (cross-origin) instead of the local vendor copy, so it is intentionally
// left out of SHELL_URLS: this worker's own fetch handler below only
// persists same-origin 'basic' responses, so a cross-origin CDN asset would
// never survive past its first cache anyway. Offline boot still works for
// the rest of the shell; the SDK CSS itself needs network on first load
// after an offline reload.
const SHELL_URLS = [
  './',
  './index.html',
  './os.html',
  './manifest.json',
  './favicon.svg',
  './os-shell.js',
  './vendor/theme.js',
  './lib/sqlite-shim.js',
  './vendor/kits/os/colors_and_type.css',
  './vendor/kits/os/app-shell.css',
  './vendor/kits/os/theme.css',
  './vendor/kits/os/freddie-dashboard.css',
  './vendor/kits/os/app-panes.css',
  './vendor/xterm.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Best-effort: don't fail install if one optional shell asset 404s
      // (e.g. a vendor file not yet synced in a given checkout).
      Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Only cache same-origin, successful, basic responses.
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
