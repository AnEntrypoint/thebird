import init, { decompress } from './vendor/brotli/brotli_dec_wasm.js';

const MANIFEST = 'thebird-package.json';
const CACHE_PREFIX = 'thebird-site-';
const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
  txt: 'text/plain; charset=utf-8',
};
const NOT_PACKED = new Set([MANIFEST, 'thebird-package.tar.br']);

let loaded = null;
const digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const scoped = (path) => new URL(path, self.registration.scope).href;

function untar(tar, count) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) => new TextDecoder().decode(header.subarray(start, end)).replace(/\0.*$/s, '');
    const prefix = field(345, 500);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(new TextDecoder().decode(header.subarray(124, 136)).replace(/[\0 ]/g, ''), 8);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    files.set(name, body);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (files.size !== count) throw new Error(`package holds ${files.size} files, the manifest says ${count}`);
  return files;
}

async function loadPackage() {
  const manifestResponse = await fetch(scoped(MANIFEST), { cache: 'no-cache' });
  if (!manifestResponse.ok) return null;
  const manifest = await manifestResponse.json();
  const packageUrl = scoped(manifest.package.split('/').pop());
  const cacheName = `${CACHE_PREFIX}${manifest.packageSha256}`;
  const cache = await caches.open(cacheName);
  let response = await cache.match(packageUrl);
  if (!response) {
    response = await fetch(packageUrl);
    if (!response.ok) throw new Error(`package HTTP ${response.status}`);
    await cache.put(packageUrl, response.clone());
  }
  const packed = new Uint8Array(await response.arrayBuffer());
  if (await digest(packed) !== manifest.packageSha256) throw new Error('package sha256 does not match the manifest');
  await init();
  const tar = decompress(packed);
  if (await digest(tar) !== manifest.tarSha256) throw new Error('package tar sha256 does not match the manifest');
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && name !== cacheName) await caches.delete(name);
  }
  return untar(tar, manifest.fileCount);
}

const packageFiles = () => {
  loaded ??= loadPackage().catch((error) => {
    loaded = null;
    throw error;
  });
  return loaded;
};

const mimeFor = (path) => MIME[path.split('.').pop()] ?? 'application/octet-stream';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length) || 'index.html';
  if (NOT_PACKED.has(path)) return;
  event.respondWith((async () => {
    let files;
    try {
      files = await packageFiles();
    } catch {
      return fetch(event.request);
    }
    const body = files?.get(path);
    if (!body) return fetch(event.request);
    return new Response(body, { headers: { 'content-type': mimeFor(path) } });
  })());
});
