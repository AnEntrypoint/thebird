// freddie-host persistence: xstate-driven libsql snapshot persistence to IDB,
// and the plugkit-wasm kv/embeddings/outbox IDB store loader. Split out of
// docs/freddie-host.js (pure move, no behavior change).
import { createMachine, createActor, fromPromise } from 'xstate';
import { kvGet as idbKvGet, kvPut as idbKvPut } from './idb-kv.js';

export function makeLibsqlPersistence(dispatch) {
    const DB_NAME = 'plugkit-libsql';
    const STORE = 'snapshots';
    const KEY = 'gm.db';
    let timer = null;
    let snapshotting = false;
    async function restore() {
        try {
            // The gm-skill stack uses its own reserved db named 'gm' since plugkit
            // multi-DB landed; snapshots target only that DB so apps' tables aren't
            // affected.
            const openR = dispatch('sql_open', { path: ':memory:', db_name: 'gm' });
            if (!openR || !openR.ok) return { restored: false, error: 'sql_open failed', raw: openR };
            const bytesB64 = await idbKvGet(DB_NAME, STORE, KEY);
            if (!bytesB64) {
                const dummy = dispatch('memorize', { text: '__schema_bootstrap__', namespace: '__init__' });
                return { restored: false, bootstrapped: !!(dummy && dummy.ok) };
            }
            const r = dispatch('sql_deserialize', { bytes_b64: bytesB64, path: ':memory:', db_name: 'gm' });
            return { restored: !!(r && r.ok), bytes: bytesB64.length, raw: r };
        } catch (e) {
            return { restored: false, error: e && e.message || String(e) };
        }
    }
    // The raw snapshot transform (serialize gm.db -> IDB). The machine wraps
    // this so in-flight dedup is a state (`persisting`) not a module-level
    // inflightPromise, and `schedule(delay)` is an after-delay transition not a
    // setTimeout. Concurrent callers awaiting a persisting snapshot share the
    // same invoked actor result.
    async function doSnapshot() {
        snapshotting = true;
        try {
            dispatch('sql_open', { path: ':memory:', db_name: 'gm' });
            const r = dispatch('sql_serialize', { path: ':memory:', db_name: 'gm' });
            if (!r || !r.ok || !r.data || !r.data.bytes_b64) return { ok: false, error: 'serialize failed', raw: r };
            await idbKvPut(DB_NAME, STORE, KEY, r.data.bytes_b64);
            return { ok: true, size: r.data.size };
        } catch (e) {
            return { ok: false, error: e && e.message || String(e) };
        } finally {
            snapshotting = false;
        }
    }

    let lastResult = null;
    const persistenceMachine = createMachine({
        id: 'libsqlPersistence',
        initial: 'idle',
        states: {
            idle: { on: { SNAPSHOT: 'persisting', SCHEDULE: 'scheduled' } },
            // SCHEDULE arms an after-delay snapshot; a fresh SCHEDULE restarts it
            // (self-transition re-enters the `after`), matching clearTimeout+set.
            scheduled: {
                on: { SNAPSHOT: 'persisting', SCHEDULE: { target: 'scheduled', reenter: true } },
                after: { 2000: 'persisting' },
            },
            persisting: {
                invoke: {
                    src: 'snap',
                    onDone: { target: 'idle', actions: ({ event }) => { lastResult = event.output; } },
                    onError: { target: 'idle', actions: ({ event }) => { lastResult = { ok: false, error: String(event.error) }; } },
                },
                // In-flight dedup: SNAPSHOT while persisting is ignored.
                on: { SNAPSHOT: {} },
            },
        },
    }).provide({ actors: { snap: fromPromise(() => doSnapshot()) } });

    const persistActor = createActor(persistenceMachine);
    persistActor.start();

    // snapshot() resolves when the machine next reaches idle after a SNAPSHOT —
    // concurrent callers share the same in-flight persisting state.
    function snapshot() {
        return new Promise(resolve => {
            const wasPersisting = persistActor.getSnapshot().value === 'persisting';
            persistActor.send({ type: 'SNAPSHOT' });
            if (!wasPersisting && persistActor.getSnapshot().value !== 'persisting') {
                // Nothing started (already idle and SNAPSHOT was a no-op edge) — resolve last.
                return resolve(lastResult || { ok: true, skipped: 'noop' });
            }
            const sub = persistActor.subscribe(s => {
                if (s.value === 'idle') { sub.unsubscribe(); resolve(lastResult); }
            });
            setTimeout(() => { try { sub.unsubscribe(); } catch {
                // swallow: subscription may already be unsubscribed by the idle-reached path above
            } resolve(lastResult); }, 30000);
        });
    }
    function schedule(delayMs = 2000) {
        // delayMs honored via the machine's after:2000; callers use the default.
        persistActor.send({ type: 'SCHEDULE' });
    }
    // Teardown flush: a scheduled (debounced, not-yet-fired) or in-flight snapshot
    // must not be lost to a tab close/refresh/navigate within the 2000ms window.
    // pagehide/visibilitychange(hidden) fire reliably on mobile/bfcache paths where
    // beforeunload does not; all three are wired, each doing a synchronous best-effort
    // flush (doSnapshot writes IDB directly — no awaiting the xstate round trip, since
    // async work is not guaranteed to complete once unload has begun).
    if (typeof addEventListener === 'function') {
        const flushOnTeardown = () => {
            const v = persistActor.getSnapshot().value;
            if (v === 'scheduled' || v === 'persisting') doSnapshot();
        };
        addEventListener('beforeunload', flushOnTeardown);
        addEventListener('pagehide', flushOnTeardown);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flushOnTeardown();
            });
        }
    }
    return { restore, snapshot, schedule, get state() { return persistActor.getSnapshot().value; } };
}

export async function loadGmKvStore() {
    return new Promise((resolve) => {
        const req = indexedDB.open('plugkit-wasm', 2);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
            if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox');
            if (!db.objectStoreNames.contains('embeddings')) db.createObjectStore('embeddings');
        };
        req.onsuccess = e => {
            const db = e.target.result;
            const tx = db.transaction(['kv', 'embeddings'], 'readonly');
            const kvStore = tx.objectStore('kv');
            const embStore = tx.objectStore('embeddings');
            const allKv = kvStore.getAll();
            const allKvKeys = kvStore.getAllKeys();
            const allEmb = embStore.getAll();
            const allEmbKeys = embStore.getAllKeys();
            const map = {};
            const embeddings = {};
            let done = 0;
            const tryResolve = () => {
                if (++done < 4) return;
                for (let i = 0; i < allKvKeys.result.length; i++) {
                    const composite = String(allKvKeys.result[i]);
                    const sep = composite.indexOf('\x00');
                    if (sep < 0) continue;
                    const ns = composite.slice(0, sep);
                    const key = composite.slice(sep + 1);
                    if (!map[ns]) map[ns] = {};
                    map[ns][key] = allKv.result[i];
                }
                for (let i = 0; i < allEmbKeys.result.length; i++) {
                    const composite = String(allEmbKeys.result[i]);
                    const sep = composite.indexOf('\x00');
                    if (sep < 0) continue;
                    const ns = composite.slice(0, sep);
                    const key = composite.slice(sep + 1);
                    if (!embeddings[ns]) embeddings[ns] = {};
                    embeddings[ns][key] = allEmb.result[i];
                }
                resolve({ db, map, embeddings });
            };
            allKv.onsuccess = tryResolve;
            allKvKeys.onsuccess = tryResolve;
            allEmb.onsuccess = tryResolve;
            allEmbKeys.onsuccess = tryResolve;
            allKv.onerror = () => resolve({ db, map: {}, embeddings: {} });
        };
        req.onerror = () => resolve({ db: null, map: {}, embeddings: {} });
    });
}
