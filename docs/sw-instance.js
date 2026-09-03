// Per-instance Service Worker. Registered once per thebird instance at a
// unique scope (./sw-i<N>/) with a distinct ?inst=<id> script query, so the
// browser treats every registration as a separate worker thread. Owns the
// per-instance IDB stores (gui state, agent keys) and an in-memory ASGI
// routing-table snapshot. Visual code is forbidden here.

const SCOPE_RE = /sw-(i\d+)\/$/;
const SCOPE_MATCH = SCOPE_RE.exec(self.registration.scope);
const INSTANCE_ID = SCOPE_MATCH ? SCOPE_MATCH[1] : 'iX';
// A malformed scope silently falls back to 'iX', causing cross-instance IDB
// collision if two failed-parse instances share thebird-gui-iX. Fail fast.
if (!SCOPE_MATCH) throw new Error('sw-instance: invalid registration scope ' + JSON.stringify(self.registration.scope) + ', expected ./sw-i<N>/');
const GUI_DB = 'thebird-gui-' + INSTANCE_ID;
const KEYS_DB = 'thebird-keys-' + INSTANCE_ID;
const ASGI_DB = 'thebird-asgi-' + INSTANCE_ID;
const GUI_STORE = 'state';
const KEYS_STORE = 'kv';
const ASGI_STORE = 'routes';

// Generic openDb/kvGet/kvPut/kvUpdate/kvDelete are also implemented in
// docs/lib/idb-kv.js (consumed by instance-fs.js and freddie-host.js as an ES
// module import) but CANNOT be shared here: this script is loaded via
// importScripts (see docs/sw-iN/index.js), i.e. a classic (non-module)
// ServiceWorkerGlobalScope, and dynamic `import()` of an ES module is
// disallowed there per spec ("import() is disallowed on
// ServiceWorkerGlobalScope") — every gui-save/gui-load call silently threw,
// which was caught by callers' try/catch and logged, so NOTHING ever
// persisted via the SW. Inline the implementation instead of importing it.
function openDb(name, store) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });
}
async function kvGet(dbName, store, key) {
    const db = await openDb(dbName, store);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result == null ? null : req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}
async function kvPut(dbName, store, key, val) {
    const db = await openDb(dbName, store);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}
// Atomic read-modify-write within a SINGLE readwrite transaction so concurrent
// callers can't lose updates (the separate kvGet+kvPut pattern races).
async function kvUpdate(dbName, store, key, mutate) {
    const db = await openDb(dbName, store);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        const getReq = os.get(key);
        getReq.onsuccess = () => {
            try {
                const next = mutate(getReq.result == null ? null : getReq.result);
                os.put(next, key);
            } catch (e) { tx.abort(); reject(e); }
        };
        getReq.onerror = () => { reject(getReq.error); };
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}
async function kvDelete(dbName, store, key) {
    const db = await openDb(dbName, store);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}
function deleteDb(dbName) {
    return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
    });
}
// In-memory ASGI prefix routing snapshot. The actual Python app callables
// live in pyodide on the page thread and cannot be transferred here, so the
// SW only knows which prefixes belong to this instance.
const asgiRoutes = new Map(); // prefix -> { kind, mountedAt }
let ownerClientId = null; // most-recently-claimed client (kept for pickClient ranking)
const ownerClientIds = new Set(); // all clients that have claimed this instance's registry

// In-memory job/procsub/fd registries — parity with the legacy preview-sw.js
// shape (kept per-instance so two SWs don't share state).
const swJobs = new Map();
const swProcsubs = new Map();
const swFds = new Map();

// Bounded-registry policy: an owning tab can die (crash/kill/network loss)
// before it sends the matching *-unregister/*-delete call, so entries can't
// rely solely on explicit removal — without this the Maps above grow
// unbounded for the life of the SW instance. Two backstops, both cheap and
// swept opportunistically (no timers needed in a SW, which can be killed
// between events anyway): (1) job entries are evicted once their tabId is no
// longer among live clients — reuses the same clients.matchAll() liveness
// check claim-client already performs; (2) all three registries are capped
// by TTL-since-insertion and by max entry count (oldest-first, since Map
// preserves insertion order), so even an id whose owner never comes back
// (procsub/fd carry no tabId to check liveness against) can't accumulate
// forever.
const SW_REGISTRY_TTL_MS = 30 * 60 * 1000; // 30 min
const SW_REGISTRY_MAX_ENTRIES = 500;
function sweepByAge(map) {
    const now = Date.now();
    for (const [key, val] of map) {
        const ts = val && typeof val === 'object' ? (val.startedAt || val.putAt) : null;
        if (typeof ts === 'number' && (now - ts) > SW_REGISTRY_TTL_MS) map.delete(key);
    }
    while (map.size > SW_REGISTRY_MAX_ENTRIES) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
}
async function sweepRegistries() {
    try {
        if (swJobs.size) {
            const live = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            const liveIds = new Set(live.map(c => c.id));
            // job keys are `${id}@${tabId}`; tabId is the client id that registered it.
            for (const [key, job] of swJobs) {
                if (job && job.tabId && !liveIds.has(job.tabId)) swJobs.delete(key);
            }
        }
    } catch (_) { /* clients.matchAll unavailable — fall through to TTL/size sweep */ }
    sweepByAge(swJobs);
    sweepByAge(swProcsubs);
    sweepByAge(swFds);
}

async function handle(op, args) {
    await sweepRegistries();
    if (op === 'ping') return { instanceId: INSTANCE_ID, scope: self.registration.scope, asgiCount: asgiRoutes.size };
    if (op === 'gui-load') return await kvGet(GUI_DB, GUI_STORE, 'gui');
    if (op === 'gui-save') { await kvPut(GUI_DB, GUI_STORE, 'gui', args && args.state); return true; }
    if (op === 'keys-get') {
        const all = await kvGet(KEYS_DB, KEYS_STORE, 'agent_keys') || {};
        if (args && args.provider) return all[args.provider] || null;
        return all;
    }
    if (op === 'keys-set') {
        const provider = args && args.provider;
        if (typeof provider !== 'string' || !provider) throw new Error('keys-set: args.provider must be a non-empty string');
        await kvUpdate(KEYS_DB, KEYS_STORE, 'agent_keys', cur => {
            const all = cur || {};
            if (args && args.key) all[provider] = String(args.key);
            else delete all[provider];
            return all;
        });
        return true;
    }
    if (op === 'keys-list') {
        const all = await kvGet(KEYS_DB, KEYS_STORE, 'agent_keys') || {};
        const out = {};
        for (const k of Object.keys(all)) {
            const s = String(all[k]);
            out[k] = 'sk-...' + s.slice(-4);
        }
        return out;
    }
    if (op === 'keys-clear') {
        await kvDelete(KEYS_DB, KEYS_STORE, 'agent_keys');
        return true;
    }
    if (op === 'nim-url-get') return await kvGet(KEYS_DB, KEYS_STORE, 'nim_url');
    if (op === 'nim-url-set') { await kvPut(KEYS_DB, KEYS_STORE, 'nim_url', args && args.url || ''); return true; }
    if (op === 'purge-instance') {
        const [gui, keys, asgi] = await Promise.all([deleteDb(GUI_DB), deleteDb(KEYS_DB), deleteDb(ASGI_DB)]);
        return { gui, keys, asgi };
    }
    if (op === 'asgi-mount') {
        // Durable-first: persist the route into IDB atomically (kvUpdate folds the
        // mutation into a single transaction so concurrent mounts can't clobber
        // each other) BEFORE touching the in-memory map. A crash during the write
        // then leaves asgiRoutes consistent with the persisted table rather than
        // ahead of it, so an activate()-time restore can't lose this mount.
        const prefix = String(args && args.prefix || '/');
        const meta = { kind: args && args.kind || 'asgi', mountedAt: Date.now() };
        await kvUpdate(ASGI_DB, ASGI_STORE, 'routes', cur => {
            const map = new Map(Array.isArray(cur) ? cur : []);
            map.set(prefix, meta);
            return Array.from(map.entries());
        });
        asgiRoutes.set(prefix, meta);
        return { prefix };
    }
    if (op === 'asgi-unmount') {
        // Durable-first: remove from the persisted table atomically before the
        // in-memory delete, so a crash mid-write can't leave a route the SW
        // believes is gone yet restores on the next activate().
        const prefix = String(args && args.prefix || '/');
        await kvUpdate(ASGI_DB, ASGI_STORE, 'routes', cur => {
            const map = new Map(Array.isArray(cur) ? cur : []);
            map.delete(prefix);
            return Array.from(map.entries());
        });
        return asgiRoutes.delete(prefix);
    }
    if (op === 'asgi-find') {
        const path = String(args && args.path || '/');
        let best = null;
        for (const prefix of asgiRoutes.keys()) {
            if (prefix === '/' || path === prefix || path.startsWith(prefix + '/')) {
                if (!best || prefix.length > best.length) best = prefix;
            }
        }
        return best ? { prefix: best, kind: asgiRoutes.get(best).kind } : null;
    }
    if (op === 'asgi-list') return Array.from(asgiRoutes.entries()).map(([prefix, meta]) => ({ prefix, ...meta }));
    if (op === 'claim-client') {
        const cid = (args && args.clientId) || null;
        // Evict stale client IDs before adding the new claimant so the Set does
        // not accumulate dead tab IDs that could be reused by a future browser
        // session to impersonate the original owner.
        const live = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
        const liveIds = new Set(live.map(c => c.id));
        for (const id of [...ownerClientIds]) { if (!liveIds.has(id)) ownerClientIds.delete(id); }
        if (cid && liveIds.has(cid)) { ownerClientId = cid; ownerClientIds.add(cid); }
        return { ownerClientId, ownerClientIds: [...ownerClientIds] };
    }
    if (op === 'job-register') {
        if (!args || typeof args.id !== 'string' || !args.id || typeof args.tabId !== 'string' || !args.tabId) {
            throw new Error('job-register: args.id and args.tabId must be non-empty strings');
        }
        swJobs.set(args.id + '@' + args.tabId, { id: args.id, cmd: args.cmd, tabId: args.tabId, startedAt: Date.now() });
        return true;
    }
    if (op === 'job-unregister') { swJobs.delete((args && args.id) + '@' + (args && args.tabId)); return true; }
    if (op === 'job-list') return [...swJobs.values()];
    if (op === 'procsub-put') { swProcsubs.set(String(args.id), { data: args.data, putAt: Date.now() }); return true; }
    if (op === 'procsub-delete') { return swProcsubs.delete(String(args && args.id)); }
    if (op === 'fd-put') { swFds.set(String(args.id), { data: args.data, putAt: Date.now() }); return true; }
    if (op === 'fd-delete') { return swFds.delete(String(args && args.id)); }
    throw new Error('unknown op: ' + op);
}

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        // Restore the ASGI routing table persisted by asgi-mount/unmount. Without
        // this a SW restart/update loses the entire routing table (it is only
        // initialized empty at module load), silently breaking asgi-find routing.
        try {
            const saved = await kvGet(ASGI_DB, ASGI_STORE, 'routes');
            if (Array.isArray(saved)) {
                // Validate each restored entry before trusting it: a corrupted IDB
                // value (non-pair entry, null meta, missing meta.kind) would later
                // crash asgi-find's `asgiRoutes.get(best).kind` access. Skip and warn
                // on anything malformed so a single bad row can't poison routing.
                for (const entry of saved) {
                    if (!Array.isArray(entry)) { console.warn('sw: skipped malformed ASGI route entry', entry); continue; }
                    const [prefix, meta] = entry;
                    if (typeof prefix === 'string' && prefix
                        && meta && typeof meta === 'object' && typeof meta.kind === 'string') {
                        asgiRoutes.set(prefix, meta);
                    } else {
                        console.warn('sw: skipped malformed ASGI route', prefix, meta);
                    }
                }
            }
        } catch (_) { /* swallow: IDB unavailable — start with empty routes */ }
        // Evict stale ownership state before claiming. A crash between SW updates
        // can leave ownerClientId/ownerClientIds pointing to dead tab IDs that
        // will never re-claim, causing pickClient to return null on every fetch.
        const liveAtActivate = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
        const liveAtActivateIds = new Set(liveAtActivate.map(c => c.id));
        for (const id of [...ownerClientIds]) { if (!liveAtActivateIds.has(id)) ownerClientIds.delete(id); }
        if (ownerClientId && !liveAtActivateIds.has(ownerClientId)) ownerClientId = null;
        await self.clients.claim();
    })());
});

const OWNER_GATED_OPS = new Set([
    'keys-get', 'keys-set', 'keys-list', 'keys-clear',
    'nim-url-get', 'nim-url-set',
    'asgi-mount', 'asgi-unmount', 'asgi-find', 'asgi-list',
    // writes into per-instance fd/procsub registries are owner-only too — without
    // this a non-owner client could seed another instance's fd/procsub stores.
    // job registry mutations and reads are owner-only for the same reason.
    'procsub-put', 'procsub-delete', 'fd-put', 'fd-delete', 'job-register', 'job-unregister', 'job-list'
]);

self.addEventListener('message', event => {
    const { op, args, id } = event.data || {};
    const port = event.ports && event.ports[0];
    const sourceId = event.source && event.source.id || null;
    const sourceUrl = event.source && event.source.url || null;
    const replyErr = (msg) => {
        const m = { id, error: msg };
        if (port) port.postMessage(m); else event.source && event.source.postMessage(m);
    };
    if (sourceUrl) {
        let ok = false;
        try { ok = new URL(sourceUrl).origin === self.location.origin; } catch { ok = false; }
        if (!ok) { replyErr('sw: cross-origin message rejected'); return; }
    }
    // claim-client ownership is always keyed to the BROWSER-attested sourceId; a
    // client-supplied args.clientId is untrusted and would let any client claim
    // ownership as an arbitrary id, so it is ignored entirely.
    const augmented = (op === 'claim-client')
        ? { ...(args || {}), clientId: sourceId }
        : args;
    Promise.resolve()
        .then(async () => {
            if (OWNER_GATED_OPS.has(op)) {
                // Per-instance key isolation: only clients that have claimed THIS instance's
                // registry may run gated ops (keys/asgi). A non-owner client must be rejected
                // — see the sw_blocks_non_owner_keys_get invariant. The live race where a
                // legit owner's claim hadn't landed yet is fixed CLIENT-side (raised
                // claim-client timeout 2s->8s), NOT by weakening this boundary.
                if (!sourceId || ownerClientIds.size === 0 || !ownerClientIds.has(sourceId)) {
                    throw new Error('sw: op not permitted from non-owner client');
                }
                // Re-validate sourceId is still alive: a dead tab ID that hasn't been
                // evicted yet (between claim-client calls) must not pass the gate.
                const liveNow = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
                const liveNowIds = new Set(liveNow.map(c => c.id));
                if (!liveNowIds.has(sourceId)) {
                    throw new Error('sw: op not permitted from non-owner client');
                }
            }
            return handle(op, augmented);
        })
        .then(result => {
            const msg = { id, result };
            if (port) port.postMessage(msg); else event.source && event.source.postMessage(msg);
        })
        .catch(err => {
            const msg = { id, error: String(err && err.message || err) };
            if (port) port.postMessage(msg); else event.source && event.source.postMessage(msg);
        });
});

function corsHeaders(extra) {
    const h = { 'x-thebird-instance': INSTANCE_ID };
    if (extra) Object.assign(h, extra);
    return h;
}

async function pickClient() {
    const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    // The page that owns this instance's registry calls `claim-client` after
    // registration. That's the only client that has the asgiApps for this id.
    if (ownerClientId) {
        const owner = all.find(c => c.id === ownerClientId);
        if (owner) return owner;
        // Owner is claimed but has unloaded. Refuse to silently downgrade to
        // URL-pattern heuristic — a rogue iframe matching the regex could intercept
        // EXPRESS_REQUEST. Return null so callers emit 503 and force re-claim.
        return null;
    }
    // No owner has ever claimed this instance. Return null so callers emit 503
    // and the page's sw-client retries claim-client. This prevents a rogue iframe
    // matching the URL heuristic from intercepting EXPRESS_REQUEST before the
    // legitimate owner claims the registry.
    return null;
}

async function serveFromClient(path) {
    const target = await pickClient();
    if (!target) return new Response('no client', { status: 503, headers: corsHeaders() });
    const chan = new MessageChannel();
    try { target.postMessage({ type: 'SW_STREAM_READ', path, instanceId: INSTANCE_ID }, [chan.port2]); }
    catch (_) { return new Response('client error', { status: 503, headers: corsHeaders() }); }
    return new Promise(res => {
        const timeout = setTimeout(() => { try { chan.port1.close(); } catch (_) { /* swallow: port may already be closed/GC'd after the response resolved */ } res(new Response('timeout', { status: 504, headers: corsHeaders() })); }, 5000);
        chan.port1.onmessage = msg => {
            clearTimeout(timeout);
            const d = msg.data || {};
            if (!d.found) res(new Response('not found', { status: 404, headers: corsHeaders() }));
            else res(new Response(d.data, { status: 200, headers: corsHeaders({ 'Content-Type': 'text/plain' }) }));
        };
    });
}

// Text-ish content-types are safe to read via request.text() (already
// UTF-8 in transit) and are handed to the client as a JS string for
// backward-compat with existing ASGI apps that expect a string body.
// Everything else (multipart uploads, images, protobuf, gzip, or a
// missing content-type on a non-empty body) is read as raw bytes via
// arrayBuffer() and transferred through the MessageChannel as a
// Uint8Array/ArrayBuffer (structured-clone-safe) so binary bytes are
// never forced through a UTF-8 text decode + re-encode round trip,
// which corrupts any byte sequence that is not valid UTF-8.
function isTextContentType(ct) {
    if (!ct) return false;
    ct = ct.toLowerCase();
    return ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') ||
        ct.includes('javascript') || ct.includes('x-www-form-urlencoded');
}

async function forwardExpress(request, path) {
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method);
    const contentType = request.headers.get('content-type') || '';
    let body = null;
    let transfer = [];
    if (hasBody) {
        if (isTextContentType(contentType)) {
            body = await request.text();
        } else {
            const buf = await request.arrayBuffer();
            body = new Uint8Array(buf);
            transfer = [body.buffer];
        }
    }
    const headers = [];
    request.headers.forEach((v, k) => { headers.push([k, v]); });
    const target = await pickClient();
    if (!target) return new Response('no client', { status: 503, headers: corsHeaders() });
    const chan = new MessageChannel();
    try { target.postMessage({ type: 'EXPRESS_REQUEST', path, method: request.method, body, headers, instanceId: INSTANCE_ID }, [chan.port2, ...transfer]); }
    catch (_) { return new Response('client error', { status: 503, headers: corsHeaders() }); }
    return new Promise(res => {
        const timeout = setTimeout(() => { try { chan.port1.close(); } catch (_) { /* swallow: port may already be closed/GC'd after the response resolved */ } res(new Response('timeout', { status: 504, headers: corsHeaders() })); }, 30000);
        chan.port1.onmessage = msg => {
            clearTimeout(timeout);
            const d = msg.data || {};
            const isBinaryBody = d.body instanceof Uint8Array || d.body instanceof ArrayBuffer;
            const fallbackType = isBinaryBody ? 'application/octet-stream' : 'text/html';
            res(new Response(d.body, { status: d.status || 200, headers: corsHeaders({ 'Content-Type': d.contentType || fallbackType }) }));
        };
    });
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const scopePath = new URL(self.registration.scope).pathname;
    if (!url.pathname.startsWith(scopePath)) return;
    const sub = url.pathname.slice(scopePath.length);
    if (!sub.startsWith('preview/')) return;
    const path = '/' + sub.slice('preview/'.length);

    const procsubM = path.match(/^\/procsub\/(\d+)$/);
    if (procsubM) { event.respondWith(serveFromClient(path)); return; }
    if (path.startsWith('/dev/fd/')) { event.respondWith(serveFromClient(path)); return; }
    const tcpM = path.match(/^\/dev\/tcp\/([^/]+)\/(\d+)(\/.*)?$/);
    if (tcpM) {
        event.respondWith(fetch('http://' + tcpM[1] + ':' + tcpM[2] + (tcpM[3] || '/'), {
            method: event.request.method,
            body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? event.request.body : undefined
        }));
        return;
    }
    event.respondWith(forwardExpress(event.request, path));
});
