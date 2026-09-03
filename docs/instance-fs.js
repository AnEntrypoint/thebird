import { createMachine, createActor, fromPromise } from 'xstate';
import { kvGet, kvPut } from './lib/idb-kv.js';
import { openOpfsStore } from './instance-fs-opfs.js';

const KEY = 'snapshot';
const STORE = 'fs';

// Debounced IDB persistence as a state machine: clean -> dirty -> (after 250ms)
// persisting -> clean. A CHANGE during persisting re-dirties. FLUSH forces an
// immediate write (teardown / destroy). Mirrors the gui-state machine shape so
// every debounced-persist surface in thebird is the same deterministic actor.
//
// Concurrency contract (bug found + fixed 2026-07): a rapid burst of CHANGE/
// FLUSH events -- e.g. several bg-job spawns each calling flush() without
// awaiting it, as docs/shell.js's persistTermState() does -- can drive the
// machine through MANY dirty->persisting cycles in the same tick, each one
// invoking `doSave` (spawning its own concurrent idbSave() call, each with
// its own IndexedDB transaction). Those transactions do NOT necessarily
// COMMIT in invocation order; a stale, earlier-captured snapshot's write can
// land in IndexedDB *after* a fresher one, silently clobbering it even though
// the state machine already reported 'clean'. See makeSerializedSaver below --
// every `doSave` passed in here MUST already be wrapped so overlapping
// invocations serialize onto a single in-flight write and always persist the
// CURRENT snapshot at actual execution time, never a stale closure capture.
function makeFsPersistMachine(doSave, onSaveError) {
    return createMachine({
        id: 'fsPersist',
        initial: 'clean',
        states: {
            clean: { on: { CHANGE: 'dirty' } },
            dirty: {
                on: { CHANGE: {}, FLUSH: 'persisting' },
                after: { 250: 'persisting' },
            },
            persisting: {
                // onError still returns to 'clean' (the debounce contract needs a
                // terminal state to accept the next CHANGE) but the underlying
                // error -- e.g. QuotaExceededError -- is surfaced via onSaveError
                // first so a write failure is never silently indistinguishable
                // from a successful save (this instance-fs used to swallow it).
                invoke: { src: 'save', onDone: 'clean', onError: { target: 'clean', actions: ({ event }) => onSaveError(event.error) } },
                // A CHANGE arriving mid-save must move to 'dirty', not self-loop:
                // `save` already captured `snapshot` via JSON.stringify at invoke
                // time, so a write landing after that capture but before this
                // invoke settles would otherwise never get its own persist cycle
                // -- lost on refresh/crash unless an unrelated later write happens
                // to fire again. Routing to 'dirty' restarts the 250ms debounce
                // once this save settles, guaranteeing the freshest snapshot flushes.
                on: { CHANGE: 'dirty' },
            },
        },
    }).provide({ actors: { save: fromPromise(async () => { await doSave(); }) } });
}

async function idbLoad(dbName) {
    return kvGet(dbName, STORE, KEY);
}

async function idbSave(dbName, data) {
    await kvPut(dbName, STORE, KEY, data);
}

// Single-flight save serializer. The xstate machine above can enter
// 'persisting' many times back-to-back within one macrotask (each FLUSH/
// after-250ms transition spawns its own `save` invoke), and each of those
// would otherwise open its own concurrent IndexedDB readwrite transaction --
// transactions that do not necessarily COMMIT in the order they were opened.
// A stale (earlier-captured) write landing after a fresher one silently
// clobbers it, even though the machine already reported 'clean'. This
// wrapper guarantees: (1) at most one real idbSave() is ever in flight, (2)
// any calls made while a save is in flight coalesce onto a single queued
// follow-up run (never one queued run per call -- that would just replay the
// same pile-up after a delay), and (3) that follow-up run reads `getData()`
// at ITS OWN execution time -- i.e. always the freshest snapshot, never a
// value captured before earlier queued calls resolved.
function makeSerializedSaver(getData, save) {
    let inFlight = null;
    let queuedWaiters = null; // array of {resolve, reject} waiting on the next run after the current one
    function run() {
        const data = getData();
        const waiters = queuedWaiters;
        queuedWaiters = null;
        inFlight = save(data).then(
            () => { inFlight = null; waiters?.forEach(w => w.resolve()); },
            (err) => { inFlight = null; waiters?.forEach(w => w.reject(err)); throw err; }
        );
        return inFlight;
    }
    return function scheduleSave() {
        if (!inFlight) return run();
        if (!queuedWaiters) queuedWaiters = [];
        return new Promise((resolve, reject) => {
            queuedWaiters.push({ resolve, reject });
            // Once the in-flight save settles, if this call is still the
            // reason a follow-up is queued, kick it off (queuedWaiters is
            // reset to null by `run` before the next save starts, so a
            // second concurrent settle-handler won't double-fire it).
            inFlight.then(() => { if (queuedWaiters) run(); }, () => { if (queuedWaiters) run(); });
        });
    };
}

const toKey = p => String(p).replace(/^\//, '');

export async function createFs(instanceId, { seed = null } = {}) {
    if (!instanceId) throw new Error('createFs: instanceId required');
    const dbName = 'thebird-fs-' + String(instanceId).replace(/[^A-Za-z0-9_-]/g, '_');

    // OPFS is the primary persistent backing when available (real per-file
    // storage, no whole-snapshot reserialization per write, much larger
    // practical quota than a single IndexedDB blob key). IndexedDB is kept
    // as (a) the one-time migration source for instances that persisted
    // under the pre-OPFS design, and (b) the full fallback backend when OPFS
    // is unavailable (Safari<15.2, non-secure-context, some automation/
    // embedded browsers) -- behavior in that case is byte-identical to
    // before this module existed.
    const opfs = openOpfsStore(dbName);
    let snapshot;
    let usingOpfs = false;
    if (opfs) {
        try {
            const fromOpfs = await opfs.loadAll();
            if (fromOpfs && Object.keys(fromOpfs).length > 0) {
                // Real OPFS files already exist for this instance -- primary
                // storage is live and populated, use it directly.
                snapshot = fromOpfs;
                usingOpfs = true;
            } else {
                // No OPFS files yet: either a brand-new instance, or an
                // existing instance that persisted only under the prior
                // IndexedDB-blob design. Check IDB for a one-time migration.
                const saved = await idbLoad(dbName);
                if (saved) {
                    snapshot = JSON.parse(saved);
                    // Migrate every key into real OPFS files now, so every
                    // subsequent boot takes the fromOpfs branch above and
                    // IndexedDB is never read again for this instance. Verify
                    // every key actually landed before committing to the OPFS
                    // path -- a partial saveAll (quota/driver error mid-loop)
                    // must not strand IndexedDB as an abandoned source of
                    // truth for the keys that never made it across.
                    let migrated = false;
                    try {
                        await opfs.saveAll(snapshot);
                        const verify = await opfs.loadAll();
                        const verifyKeys = new Set(Object.keys(verify || {}));
                        migrated = Object.keys(snapshot).every(k => verifyKeys.has(k));
                        if (!migrated) console.error('[instance-fs] OPFS migration incomplete for', dbName, '-- missing keys after saveAll, staying on IndexedDB this boot');
                    } catch (err) {
                        console.error('[instance-fs] OPFS migration failed for', dbName, err);
                    }
                    usingOpfs = migrated;
                    if (!usingOpfs) {
                        // Partial migration wrote some real OPFS files before
                        // failing. Left in place, the NEXT boot's top-level
                        // `fromOpfs.length > 0` check (above) would see that
                        // debris as a live populated store and take the OPFS
                        // branch directly -- skipping IndexedDB entirely and
                        // silently losing every key that never made it across.
                        // Wipe the partial tree now (tree-wide barriered, so
                        // it's race-safe against any in-flight save) so the
                        // next boot finds OPFS empty and retries migration
                        // from IndexedDB, the actual source of truth this boot.
                        await opfs.destroy().catch(err => console.error('[instance-fs] failed to prune partial OPFS migration for', dbName, err));
                        opfs.dispose();
                    }
                } else if (seed && typeof seed === 'object') {
                    snapshot = { ...seed };
                    await opfs.saveAll(snapshot).catch(err => console.error('[instance-fs] OPFS seed write failed for', dbName, err));
                    usingOpfs = true;
                } else {
                    snapshot = {};
                    usingOpfs = true;
                }
            }
        } catch (err) {
            // OPFS reachable-but-broken mid-load (rare: quota/driver error) --
            // fail safe to the pure-IndexedDB path rather than losing data.
            console.error('[instance-fs] OPFS load failed for', dbName, '-- falling back to IndexedDB', err);
            opfs.dispose();
            usingOpfs = false;
        }
    }
    if (!usingOpfs) {
        const saved = await idbLoad(dbName);
        if (saved) snapshot = JSON.parse(saved);
        else if (seed && typeof seed === 'object') snapshot = { ...seed };
        else snapshot = {};
    }

    // Change-notification hooks (fs.subscribe). The in-memory snapshot is the
    // single mutation layer shared by BOTH backends (OPFS and the IndexedDB
    // fallback), so trapping IT -- not the persistence layer -- fires
    // identically whichever backend is live, and fires at MUTATION time,
    // never at debounced-flush time. Reads never fire. Trapping via a Proxy
    // (instead of only instrumenting writeFile/writeJson/unlink below) is
    // what catches the 22+ consumers that mutate `fs.snapshot[...] = ...` /
    // `delete fs.snapshot[...]` DIRECTLY (shell builtins, shell.js redirect
    // writes, the posix/node fs shims); the fs object's own mutators write
    // through the same proxy so there is exactly one notify path. `path` is
    // the snapshot key (no leading '/'); `kind` is 'write' for sets and
    // 'delete' for deletes -- this flat key-value fs has no distinct
    // mkdir/rename op: directory creation materializes as a `<dir>/.keep`
    // write (reported as 'mkdir'), a rename surfaces as a delete+write pair.
    const listeners = new Set();
    function notify(path, kind) {
        for (const fn of listeners) {
            // Per-listener isolation: a throwing listener must never break
            // the mutation that fired it (or starve the other listeners).
            try { fn({ path, kind }); } catch (err) { console.error('[instance-fs] fs.subscribe listener threw for', dbName, path, err); }
        }
    }
    // Keys deleted from `snapshot` since the last successful saveAll --
    // populated ONLY by the deleteProperty trap below (the single mutation
    // path every consumer's `delete fs.snapshot[...]`/unlink() goes through),
    // so saveAll's OPFS prune step gets an explicit, caller-known list of
    // files to remove instead of inferring deletions by diffing a captured
    // snapshot copy against the tree (see makeSerializedSaver below for why
    // that inference was a stale-snapshot race).
    const pendingDeletes = new Set();
    // Set at the top of destroy(), before flush()/opfs teardown run. Every
    // mutation entry point (the proxy set/deleteProperty traps that back
    // writeFile/writeJson/unlink/direct `snapshot[k]=v`, and fastPathWrite's
    // opfs.saveOne/deleteOne calls) checks this and throws instead of
    // silently no-op'ing -- otherwise a write racing teardown lands on an
    // already-disposed OPFS store (worker=null) and is swallowed by
    // fastPathWrite's `.catch(console.error)`, so the caller believes the
    // write succeeded while the data is dropped (see
    // destroy-does-not-guard-concurrent-fastpath-writes).
    let destroyed = false;
    function assertNotDestroyed(op) {
        if (destroyed) throw Object.assign(new Error('[instance-fs] ' + op + ' on ' + dbName + ' rejected: instance is being/was destroyed'), { code: 'EFSDESTROYED' });
    }
    const snapshotProxy = new Proxy(snapshot, {
        set(target, prop, value) {
            assertNotDestroyed('write:' + String(prop));
            target[prop] = value;
            const p = String(prop);
            pendingDeletes.delete(p);
            notify(p, p.endsWith('/.keep') ? 'mkdir' : 'write');
            return true;
        },
        deleteProperty(target, prop) {
            assertNotDestroyed('delete:' + String(prop));
            delete target[prop];
            const p = String(prop);
            pendingDeletes.add(p);
            notify(p, 'delete');
            return true;
        },
    });

    // Persistence is an xstate actor (clean/dirty/persisting). schedulePersist
    // = a CHANGE event; flush = a FLUSH event then await the write settling.
    // The actual write is routed through makeSerializedSaver so a rapid burst
    // of CHANGE/FLUSH (many dirty->persisting cycles in one macrotask, e.g.
    // several un-awaited flush() calls from docs/shell.js's
    // persistTermState()) never opens overlapping concurrent transactions --
    // see the block comment above makeSerializedSaver for the exact race
    // this closes (a stale write committing after a fresh one). When OPFS
    // backs this instance, each save is a full saveAll() resync (still
    // single-flight-serialized, still correctness-safe) rather than a
    // per-key diff -- a real per-key-diff fast path is a further
    // optimization, not required for OPFS to be the PRIMARY store; the
    // fast per-key path (opfs.saveOne) is used opportunistically by
    // writeJson/writeFile below for the common single-key-changed case,
    // with this full resync remaining the correctness backstop for flush()
    // and for changes that only ever mutate `snapshot` directly (unlink,
    // POSIX fs writes routed through shell-posix.js's own persist() calls).
    let lastPersistError = null;
    const scheduleSave = makeSerializedSaver(
        () => (usingOpfs ? { ...snapshot } : JSON.stringify(snapshot)),
        (data) => {
            if (!usingOpfs) return idbSave(dbName, data);
            // Snapshot the delete set at the SAME synchronous instant as
            // `data` was captured (both come from getData()'s single call),
            // so the keys handed to saveAll for pruning are exactly the ones
            // known-deleted as of that instant -- never a broader "absent
            // from data" inference that could catch a key written after
            // capture but before this queued op actually runs.
            const deletedKeys = Array.from(pendingDeletes);
            return opfs.saveAll(data, deletedKeys).then((res) => {
                for (const k of deletedKeys) pendingDeletes.delete(k);
                return res;
            });
        }
    );
    // Tracks the promise of the most recently scheduled save so flush() can
    // await the ACTUAL write settling, not just the xstate machine's first
    // 'clean' observation (which -- before this fix -- could be reached by a
    // stale, already-superseded save's onDone while a fresher one, or the
    // save this very flush() call triggered, was still in flight).
    let lastSavePromise = Promise.resolve();
    const persistActor = createActor(makeFsPersistMachine(
        () => {
            lastSavePromise = scheduleSave().then(() => { lastPersistError = null; });
            return lastSavePromise;
        },
        (err) => { lastPersistError = err; console.error('[instance-fs] persist failed for', dbName, err); }
    ));
    persistActor.start();

    function schedulePersist() {
        persistActor.send({ type: 'CHANGE' });
    }

    async function flush() {
        // Loop rather than a single wait: a CHANGE can arrive (re-dirtying
        // the machine) in the gap between "we observed clean" and "we
        // actually returned," e.g. from another un-awaited flush() call
        // racing this one. Keep sending FLUSH and waiting until the machine
        // is BOTH clean AND has no in-flight/queued save left to settle,
        // which is the only state that actually guarantees the freshest
        // snapshot has landed in the backing store (real OPFS files when
        // usingOpfs, else the single IndexedDB blob key).
        for (let guard = 0; guard < 50; guard++) {
            const v = persistActor.getSnapshot().value;
            if (v !== 'clean') {
                persistActor.send({ type: 'FLUSH' });
                await new Promise(resolve => {
                    const sub = persistActor.subscribe(s => {
                        if (s.value === 'clean') { sub.unsubscribe(); resolve(); }
                    });
                    // Safety: resolve after a bounded wait regardless.
                    setTimeout(() => { try { sub.unsubscribe(); } catch { /* swallow: subscription may already be unsubscribed by the 'clean' handler above racing this timeout */ } resolve(); }, 2000);
                });
            }
            // Await the actual save I/O this cycle triggered (or the last one
            // scheduled). If a fresh CHANGE snuck in while we were awaiting
            // that, the machine will be 'dirty' again and the loop repeats.
            await lastSavePromise.catch(() => {});
            if (persistActor.getSnapshot().value === 'clean') return;
        }
    }

    function readJson(path, dflt = null) {
        try { return JSON.parse(snapshot[toKey(path)]); } catch { return dflt; }
    }
    // Opportunistic per-key fast path: when OPFS backs this instance, a
    // single-key write goes straight to its own OPFS file immediately
    // (parallel to, not instead of, the debounced full-resync `schedulePersist`
    // below) so a page crash/close between now and the next 250ms debounce
    // window still has the freshest value durable on disk. `.catch` here is
    // deliberate best-effort -- schedulePersist's serialized full-resync save
    // is the correctness backstop that still runs regardless, so a transient
    // per-key write failure (e.g. one bad path segment) never loses data.
    // Tracks fast-path OPFS promises (saveOne/deleteOne) still in flight so
    // destroy() can drain them before tearing the worker down -- otherwise a
    // straggling postMessage that hasn't been read/replied to yet at the
    // moment opfs.dispose() terminates the worker never resolves via its
    // normal path (only via the 10s supersession/timeout fallback deep in
    // the worker call() machinery), well after destroy() appeared to finish.
    const inflightFastPathWrites = new Set();
    function trackFastPath(p) {
        const tracked = p.catch(() => {});
        inflightFastPathWrites.add(tracked);
        tracked.finally(() => inflightFastPathWrites.delete(tracked));
        return p;
    }
    function fastPathWrite(key, value) {
        if (destroyed) return;
        if (usingOpfs) trackFastPath(opfs.saveOne(key, value)).catch(err => console.error('[instance-fs] OPFS fast-path write failed for', dbName, key, err));
    }
    function writeJson(path, obj) {
        const key = toKey(path);
        snapshotProxy[key] = JSON.stringify(obj);
        fastPathWrite(key, snapshot[key]);
        schedulePersist();
    }

    const fs = {
        instanceId,
        dbName,
        get snapshot() { return snapshotProxy; },
        // Set when the last debounced IDB write failed (e.g. QuotaExceededError).
        // Cleared automatically on the next successful save. Callers writing
        // user data (todo/notes/config) can check this after schedulePersist
        // fires to surface a real failure instead of assuming the write landed.
        get lastPersistError() { return lastPersistError; },
        readJson,
        writeJson,
        getConfig() {
            // Defensive: previous code paths or external corruption may have
            // written a non-object (string/number/array) to config.yaml. Coerce
            // to the default shape so callers (setApiKey, freddie /config set)
            // don't throw on property assignment.
            const raw = readJson('/etc/freddie/config.yaml', null);
            // Only a genuinely non-object payload (string/number/array/null) is
            // unrecoverable -- default it. An object that merely lacks/mis-types
            // `providers` still carries whatever sibling top-level blocks
            // (agent/acptoapi/skills/plugins) prior writes persisted; preserve
            // them instead of replacing the whole config wholesale, or the very
            // next setConfig() call from a caller like chat-config.js writes the
            // stripped-down shape back and permanently erases those blocks.
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                return { providers: {}, defaultProvider: null };
            }
            if (!raw.providers || typeof raw.providers !== 'object') raw.providers = {};
            return raw;
        },
        setConfig(cfg) { writeJson('/etc/freddie/config.yaml', cfg); },
        getApiKey(provider) { const c = this.getConfig(); return c.providers && c.providers[provider] && c.providers[provider].apiKey || null; },
        setApiKey(provider, key) { const c = this.getConfig(); c.providers[provider] = { ...(c.providers[provider]||{}), apiKey: key }; this.setConfig(c); },
        readFile(path) {
            const v = snapshot[toKey(path)];
            if (v == null) throw Object.assign(new Error('ENOENT: ' + path), { code: 'ENOENT' });
            return v;
        },
        writeFile(path, data) {
            // Optional policy-engine hook: fs.policy is set lazily by callers
            // that construct createPolicyEngine({fs}, ...) (docs/policy.js)
            // and attach it back onto this fs object -- never required here,
            // so if absent this is a no-op and behavior is unchanged. A
            // denial throws PolicyDeniedError (already audit-logged by the
            // engine) before the write lands.
            if (fs.policy && typeof fs.policy.check === 'function') {
                fs.policy.check('file.write', path);
            }
            const k = toKey(path);
            snapshotProxy[k] = String(data);
            fastPathWrite(k, snapshot[k]);
            schedulePersist();
        },
        unlink(path) {
            const k = toKey(path);
            if (!(k in snapshot)) throw Object.assign(new Error('ENOENT: ' + path), { code: 'ENOENT' });
            delete snapshotProxy[k];
            if (usingOpfs && !destroyed) trackFastPath(opfs.deleteOne(k)).catch(err => console.error('[instance-fs] OPFS fast-path delete failed for', dbName, k, err));
            schedulePersist();
        },
        exists(path) { return toKey(path) in snapshot; },
        list(prefix = '') {
            const p = toKey(prefix);
            return Object.keys(snapshot).filter(k => k.startsWith(p));
        },
        get usingOpfs() { return usingOpfs; },
        // Change notifications: fn({path, kind}) is called SYNCHRONOUSLY at
        // mutation time (kind 'write'|'delete'|'mkdir' -- see the proxy
        // comment above for the exact contract). Returns an unsubscribe
        // function. Listener exceptions are isolated per listener (logged,
        // never rethrown) so a bad listener can neither break a mutation nor
        // starve the other listeners.
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        flush,
        async destroy() {
            // Set BEFORE flush() (per the finding): flush()'s serialized save
            // is itself async, so any fastPathWrite/writeFile/writeJson/unlink
            // call that lands on this instance from here on -- including one
            // racing this very flush() -- must see `destroyed` already true
            // and refuse to enqueue new OPFS I/O against a store that is
            // mid-teardown or already disposed, rather than silently
            // no-op'ing via fastPathWrite's `.catch(console.error)`.
            destroyed = true;
            await flush();
            if (usingOpfs) {
                // Drain any fast-path write/delete still in flight before the
                // tree-wide destroy runs, so no straggling postMessage can be
                // sitting unread in the worker's queue when dispose() below
                // terminates it (see inflightFastPathWrites comment above).
                await Promise.all(Array.from(inflightFastPathWrites));
                await opfs.destroy().catch(err => console.error('[instance-fs] OPFS destroy failed for', dbName, err));
                opfs.dispose();
            }
            return new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(dbName);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
                req.onblocked = () => resolve();
            });
        },
    };

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[instanceId] = window.__debug.instances[instanceId] || {};
        window.__debug.instances[instanceId].fs = fs;
    }
    return fs;
}
