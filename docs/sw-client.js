// Page-side client for the per-instance Service Worker. Registers
// docs/sw-instance.js once per instance at a unique scope (./sw-i<N>/) with
// a distinct ?inst=<id> script query so each registration is its own SW thread.

import { dispatchAsgi, findAsgiApp } from './asgi-bridge.js';
import { getInstanceById } from './lib/instance-registry.js';

let idSeq = 0;

const CT_MAP = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.txt': 'text/plain' };
function guessCt(p) { const i = p.lastIndexOf('.'); return (i >= 0 && CT_MAP[p.slice(i).toLowerCase()]) || 'application/octet-stream'; }

// Tab-global router state. Instance lookup by id goes through
// docs/lib/instance-registry.js (the single source of truth for the live
// `instances` Map os-shell.js owns) instead of this module keeping its own
// parallel array of instance Maps — os-shell.js used to register the exact
// same Map object with both this module and instance-registry.js, which was
// true duplication, not two distinct pieces of state.
let __swRouterInstalled = false;

function lookupInstance(id) {
    return getInstanceById(id);
}

// Installs the single navigator.serviceWorker message listener that routes
// SW EXPRESS_REQUEST/SW_STREAM_READ messages back to the owning instance.
// Idempotent — safe to call on every instance creation (os-shell.js does).
export function installSwMessageRouter() {
    if (__swRouterInstalled) return;
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    __swRouterInstalled = true;
    navigator.serviceWorker.addEventListener('message', async (e) => {
        const d = e.data || {};
        const replyPort = e.ports && e.ports[0];
        if (!replyPort) return;
        const inst = d.instanceId ? lookupInstance(d.instanceId) : null;
        if (d.type === 'SW_STREAM_READ') {
            const path = d.path;
            const procsub = path.match(/^\/procsub\/(\d+)$/);
            const shell = (typeof window !== 'undefined') ? window.__debug?.shell : null;
            if (procsub && shell?.procsubRead) {
                const data = shell.procsubRead(procsub[1]);
                replyPort.postMessage({ data: data || '', found: data != null });
                return;
            }
            const fdM = path.match(/^\/dev\/fd\/(\d+)$/);
            if (fdM && shell?.fdRead) {
                try { const data = shell.fdRead(fdM[1]); replyPort.postMessage({ data: data || '', found: true }); }
                catch { replyPort.postMessage({ data: '', found: false }); }
                return;
            }
            replyPort.postMessage({ found: false });
            return;
        }
        if (d.type !== 'EXPRESS_REQUEST') return;
        const { path, method, body: reqBody, headers: reqHeaders } = d;
        if (!inst) { replyPort.postMessage({ status: 503, body: 'no instance ' + d.instanceId, contentType: 'text/plain' }); return; }
        const asgiMatch = findAsgiApp(path, inst);
        if (asgiMatch && method === 'GET') {
            const rel = path.slice(asgiMatch.prefix.length).replace(/^\//, '') || '';
            const distSet = (typeof window !== 'undefined') ? window.__debug?.appDistFiles?.[asgiMatch.prefix] : null;
            if (rel && distSet && distSet.has && distSet.has(rel)) {
                try {
                    const url = window.__debug.appDistBase[asgiMatch.prefix] + rel;
                    const r = await fetch(url);
                    const buf = await r.arrayBuffer();
                    const ct = r.headers.get('content-type') || guessCt(rel);
                    const isBin = !(ct.startsWith('text/') || ct.includes('json') || ct.includes('javascript'));
                    const setCookies = (typeof r.headers.getSetCookie === 'function') ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
                    replyPort.postMessage({ status: r.status, body: isBin ? new Uint8Array(buf) : new TextDecoder().decode(buf), contentType: ct, setCookies });
                } catch (err) {
                    replyPort.postMessage({ status: 500, body: 'dist-fetch: ' + err.message, contentType: 'text/plain' });
                }
                return;
            }
        }
        if (asgiMatch) {
            try {
                const r = await dispatchAsgi(method, path, reqHeaders, reqBody, inst);
                const setCookies = (r.headersAll || []).filter(([k]) => k === 'set-cookie').map(([, v]) => v);
                replyPort.postMessage({ status: r.status, body: r.body, contentType: r.headers['content-type'] || 'text/plain', setCookies });
            } catch (err) {
                replyPort.postMessage({ status: 500, body: 'asgi: ' + err.message, contentType: 'text/plain' });
            }
            return;
        }
        // Fallback: serve static files from the per-instance fs at the requested path.
        // Lets freddie (or any in-browser agent) write a file to fs and have it
        // appear at sw-i<N>/preview/<path> without needing to mount an asgi app.
        if (method === 'GET' && inst.fs && typeof inst.fs.readFile === 'function') {
            try {
                const rel = path.replace(/^\/+/, '');
                const exists = inst.fs.exists ? await inst.fs.exists(rel) : true;
                if (exists) {
                    const data = await inst.fs.readFile(rel);
                    if (data != null) {
                        const ct = guessCt(rel) || 'text/html';
                        const body = typeof data === 'string' ? data : (data && data.buffer ? new TextDecoder().decode(data) : String(data));
                        replyPort.postMessage({ status: 200, body, contentType: ct });
                        return;
                    }
                }
            } catch (err) { /* swallow: fs read failed (missing/unsupported), fall through to 404 response below */ }
        }
        replyPort.postMessage({ status: 404, body: 'no route for ' + method + ' ' + path, contentType: 'text/plain' });
    });
}

async function waitForActive(reg, timeoutMs = 8000) {
    if (reg.active) return reg.active;
    return new Promise(resolve => {
        const sw = reg.installing || reg.waiting;
        const done = (v) => resolve(v);
        if (!sw) { setTimeout(() => done(reg.active || null), timeoutMs); return; }
        const onChange = () => { if (sw.state === 'activated') done(sw); };
        sw.addEventListener('statechange', onChange);
        setTimeout(() => done(reg.active || null), timeoutMs);
    });
}

async function pickWorker(reg) {
    // Prefer reg.active; fall back to waiting an extra moment for activation
    if (reg.active) return reg.active;
    return await waitForActive(reg, 4000);
}

// Matches scripts/gen-static-sws.mjs COUNT and os-shell.js MAX_RESTORE_INSTANCES.
const SW_INSTANCE_CAP = 50;

export async function getInstanceSW(instanceId) {
    if (!('serviceWorker' in navigator)) throw new Error('ServiceWorker not supported');
    // Cap instances at the number of pre-generated static SW files. Beyond that,
    // the dynamic fallback would require Service-Worker-Allowed headers which
    // most static hosts (GH Pages) don't provide — make the limit explicit.
    const idMatch = /^i(\d+)$/.exec(String(instanceId || ''));
    if (idMatch && Number(idMatch[1]) > SW_INSTANCE_CAP) {
        throw new Error('thebird: per-instance SW cap of ' + SW_INSTANCE_CAP + ' reached. Close some instances or extend the static SW generator (scripts/gen-static-sws.mjs).');
    }
    const scope = new URL('./sw-' + instanceId + '/', location.href).href;
    const previewPrefix = new URL('./sw-' + instanceId + '/preview/', location.href).href;
    // Prefer the static per-id SW file (script lives INSIDE its own scope, so
    // no Service-Worker-Allowed header is required — works on GH Pages and
    // any plain static host). Fall back to the dynamic sw-instance.js?inst=
    // path for instance numbers beyond what was pre-generated, or if the
    // static file isn't present (e.g. older deploy).
    const staticUrl = new URL('./sw-' + instanceId + '/index.js', location.href).href;
    const dynamicUrl = new URL('./sw-instance.js?inst=' + instanceId, location.href).href;
    let reg = null;
    let expectedScriptUrl = null;
    try {
        const headCtrl = new AbortController();
        const headTimer = setTimeout(() => headCtrl.abort(), 3000);
        try {
            const head = await fetch(staticUrl, { method: 'HEAD', cache: 'no-store', signal: headCtrl.signal });
            if (head.ok) { reg = await navigator.serviceWorker.register(staticUrl, { scope }); expectedScriptUrl = staticUrl; }
        } finally { clearTimeout(headTimer); }
    } catch (err) { console.debug('[sw-client] static SW HEAD probe failed for ' + staticUrl + ':', err); }
    if (!reg) { reg = await navigator.serviceWorker.register(dynamicUrl, { scope }); expectedScriptUrl = dynamicUrl; }
    const active = await waitForActive(reg);
    if (!active) throw new Error('sw[' + instanceId + '] did not activate');
    // Stale-script detection: if a previously-registered SW at this scope has a
    // different script URL (e.g. switched from dynamic to static after a deploy),
    // force an update so we run the script we just registered.
    if (reg.active && expectedScriptUrl && reg.active.scriptURL !== expectedScriptUrl) {
        try { await reg.update(); await waitForActive(reg); } catch (err) { console.debug('[sw-client] update() failed:', err); }
        if (reg.active && reg.active.scriptURL !== expectedScriptUrl) {
            console.warn('[sw-client] sw[' + instanceId + '] scriptURL still mismatched after update: have ' + reg.active.scriptURL + ', expected ' + expectedScriptUrl);
        }
    }

    // Same op set sw-instance.js gates ownership on (docs/sw-instance.js
    // OWNER_GATED_OPS). Kept as a literal duplicate rather than fetched over
    // the SW channel — it must be evaluable synchronously, before any message
    // is sent, to decide whether to re-race claim-client first.
    const OWNER_GATED_OPS = new Set([
        'keys-get', 'keys-set', 'keys-list', 'keys-clear',
        'nim-url-get', 'nim-url-set',
        'asgi-mount', 'asgi-unmount', 'asgi-find', 'asgi-list',
        'procsub-put', 'procsub-delete', 'fd-put', 'fd-delete', 'job-register', 'job-unregister', 'job-list'
    ]);

    const rawCall = async (op, args) => {
        const worker = await pickWorker(reg);
        if (!worker) throw new Error('sw[' + instanceId + '] no active worker for ' + op);
        return await new Promise((resolve, reject) => {
            const ch = new MessageChannel();
            const id = ++idSeq;
            const timer = setTimeout(() => { try { ch.port1.close(); } catch { /* swallow: port may already be closed if the response arrived just as the timeout fired */ } reject(new Error('sw[' + instanceId + '] ' + op + ' timeout')); }, 15000);
            ch.port1.onmessage = e => {
                const d = e.data || {};
                if (d.id !== id) { console.warn('[sw-client] sw[' + instanceId + '] ' + op + ' reply id mismatch: expected ' + id + ', got ' + d.id); return; }
                clearTimeout(timer);
                if (d.error) reject(new Error(d.error));
                else resolve(d.result);
                try { ch.port1.close(); } catch { /* swallow: port may already be closed (double-close is harmless, only ordering is uncertain) */ }
            };
            worker.postMessage({ op, args, id }, [ch.port2]);
        });
    };

    // Wraps rawCall so an owner-gated op issued while claim-client is still
    // in flight (or previously timed out) re-races claim-client once instead
    // of surfacing sw-instance.js's generic "non-owner client" error — the
    // graceful-degradation path the claimed flag was documented to enable.
    const call = async (op, args) => {
        if (claimed || !OWNER_GATED_OPS.has(op)) return rawCall(op, args);
        try {
            await Promise.race([
                rawCall('claim-client'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('claim-client timeout')), 8000)),
            ]);
            claimed = true;
        } catch (err) {
            console.warn('[sw-client] re-race claim-client failed for sw[' + instanceId + '] before ' + op + ':', err);
        }
        return rawCall(op, args);
    };

    // Tell the SW which client (this page) owns this instance's page-side
    // registry so SW fetch handlers route EXPRESS_REQUEST back here instead
    // of the wrong client (e.g. an iframe also controlled by the same scope).
    // Awaited (with 2s timeout) so preview fetches downstream don't race the claim.
    // `claimed` is set false on timeout so callers can gate owner-only ops (keys-get,
    // asgi-mount, gui-save) rather than silently receiving 503 from pickClient().
    let claimed = false;
    try {
        await Promise.race([
            call('claim-client'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('claim-client timeout')), 8000)),
        ]);
        claimed = true;
    } catch { console.warn('[sw-client] claim-client timeout for sw[' + instanceId + ']; owner-gated ops will fail until claim succeeds'); }

    return {
        instanceId,
        registration: reg,
        scope,
        previewPrefix,
        claimed,
        call,
        // Do NOT unregister: the same scope may be shared across page contexts
        // (e.g. an outer page + an osframe iframe both registering sw-i1).
        // Unregistering globally breaks the other consumer. SW cleans up on
        // page unload.
        dispose: async () => { /* refcounted at scope level: leave SW alive */ },
        // Instance is being permanently destroyed (not just tab-scoped
        // teardown): purge the SW-owned per-instance IDB stores (gui/keys/asgi)
        // it created via openDb(GUI_DB/KEYS_DB/ASGI_DB) — these are separate
        // databases from instance-fs.js's thebird-fs-<id>, which fs.destroy()
        // already deletes, so without this call they orphan forever.
        purge: async () => { try { return await call('purge-instance'); } catch (err) { console.warn('[sw-client] purge-instance failed for', instanceId, err); return null; } }
    };
}
