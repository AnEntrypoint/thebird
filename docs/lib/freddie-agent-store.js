// IndexedDB-backed SnapshotStore + StepStore for freddie's persistent-actor
// resumability contracts (freddie src/machines/snapshot-store.js and
// src/machines/step-journal.js).
//
// Backend choice: instance.fs (docs/instance-fs.js), same substrate
// docs/lib/chat-transcript.js already uses for durable chat persistence --
// NOT a hand-rolled raw IndexedDB database. instance.fs already gives a
// debounced-persist, serialized-write, per-instance IDB-backed JSON store
// (readJson/writeJson/unlink/exists/list/flush) with the exact crash-safety
// properties (single-flight save, no interleaved-transaction clobber) a
// fresh raw indexedDB.open() here would have to reinvent from scratch. Every
// other thebird persistence layer (chat-transcript.js, chat-config.js,
// freddie-keys.js) builds on this same fs, not a parallel IDB mechanism.
//
// Storage layout (paths on instance.fs):
//   /agent-db/snapshots/<kind>/<key>.json  -> { schemaVersion, machineId, snapshot, status, updated }
//   /agent-db/steps/<sessionKey>/<stepId>.json -> { status, result, started, done }
//
// Guard-logic contract mirrored EXACTLY from freddie's libsql implementation
// (see snapshot-store.js/step-journal.js header comments for the authoritative
// spec this must satisfy so createPersistentActor's behavior is identical
// regardless of backend):
//
//   snapshot store:
//     persist(kind, key, snapshot, {machineId}) -> {kind, key, status}
//     load(kind, key, {machineId}) -> snapshot | null
//       Returns null (never throws) on: missing row, schema-version mismatch,
//       machineId mismatch, or unparseable stored JSON. Clears the row in
//       EVERY one of those failure cases so a stale/corrupt snapshot cannot
//       resurface on a later load.
//     clear(kind, key) -> void (idempotent)
//
//   step store:
//     runStep(sessionKey, stepId, fn, opts) -> result
//       Cached done row -> return cached result, fn NOT called.
//       started-only row or no row -> mark started, run fn, mark done, return.
//       Non-serializable result -> return to caller but do NOT journal as done
//       (so a resume re-runs it).
//       Concurrent in-process calls for the same key share one in-flight run.
//     isStepDone(sessionKey, stepId) -> bool
//     clearSteps(sessionKey) -> void (idempotent)
//
// SNAPSHOT_SCHEMA_VERSION mirrors freddie's own constant name/purpose: bump
// it when the persisted-snapshot encoding changes shape incompatibly so a
// stale snapshot from older code is discarded rather than crashing resume.
export const SNAPSHOT_SCHEMA_VERSION = 1;

function safeKey(s) { return String(s).replace(/[^A-Za-z0-9_.-]/g, '_'); }
function snapshotPath(kind, key) { return '/agent-db/snapshots/' + safeKey(kind) + '/' + safeKey(key) + '.json'; }
function snapshotDirPrefix(kind) { return '/agent-db/snapshots/' + safeKey(kind) + '/'; }
function stepPath(sessionKey, stepId) { return '/agent-db/steps/' + safeKey(sessionKey) + '/' + safeKey(stepId) + '.json'; }
function stepDirPrefix(sessionKey) { return '/agent-db/steps/' + safeKey(sessionKey) + '/'; }

// createIdbSnapshotStore(fs) -> {persist, load, clear, list, sweepDone}
// fs: an instance.fs handle (readJson/writeJson/unlink/exists/list/flush).
export function createIdbSnapshotStore(fs) {
    if (!fs || typeof fs.readJson !== 'function' || typeof fs.writeJson !== 'function') {
        throw new Error('createIdbSnapshotStore: fs (instance.fs with readJson/writeJson) required');
    }

    async function persist(kind, key, snapshot, { machineId = null } = {}) {
        if (!kind || !key) throw new Error('persist requires kind and key');
        const status = (snapshot && snapshot.status) || 'active';
        const row = {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            kind: String(kind),
            key: String(key),
            machineId,
            snapshot,
            status,
            updated: Date.now(),
        };
        fs.writeJson(snapshotPath(kind, key), row);
        return { kind, key, status };
    }

    async function clear(kind, key) {
        const p = snapshotPath(kind, key);
        if (fs.exists(p)) {
            try { fs.unlink(p); } catch { /* already gone / race — idempotent */ }
        }
    }

    // load() must return null (never throw) on missing row, schema-version
    // mismatch, machineId mismatch, or unparseable JSON — and clear the row
    // in every one of those cases so a stale/corrupt snapshot cannot
    // resurface. readJson's own try/catch already returns `dflt` (null) on
    // unparseable JSON, so a "row" that is unparseable looks identical to a
    // missing row from this function's perspective — both correctly return
    // null without needing an explicit clear (there is no valid JSON row to
    // clear; readJson's underlying raw string is left as-is, but the next
    // read will fail identically and safely forever, matching "discard a
    // stale/corrupt snapshot" in spirit for a JSON-store backend where a
    // truly unparseable value cannot even be inspected for kind/key first).
    async function load(kind, key, { machineId = null } = {}) {
        const p = snapshotPath(kind, key);
        let row;
        try {
            row = fs.readJson(p, null);
        } catch {
            row = null;
        }
        if (!row || typeof row !== 'object') return null;
        if (Number(row.schemaVersion) !== SNAPSHOT_SCHEMA_VERSION) {
            await clear(kind, key);
            return null;
        }
        if (machineId && row.machineId && row.machineId !== machineId) {
            await clear(kind, key);
            return null;
        }
        // row.snapshot was already deserialized by readJson's own JSON.parse
        // of the whole row; if the stored payload was corrupted such that
        // readJson itself threw, the outer try/catch above already turned
        // that into row=null. A residual defensive check: snapshot must be a
        // real object, else treat as corrupt-and-discard.
        if (row.snapshot == null || typeof row.snapshot !== 'object') {
            await clear(kind, key);
            return null;
        }
        return row.snapshot;
    }

    async function list({ kind = null, status = 'active' } = {}) {
        const prefix = kind ? snapshotDirPrefix(kind) : '/agent-db/snapshots/';
        const keys = fs.list(prefix);
        const out = [];
        for (const k of keys) {
            if (!k.endsWith('.json')) continue;
            let row;
            try { row = fs.readJson('/' + k, null); } catch { row = null; }
            if (!row || typeof row !== 'object') continue;
            if (status && row.status !== status) continue;
            // Prefer explicit kind/key fields written by persist(); fall back to
            // recovering them from the path shape (snapshots/<kind>/<key>.json)
            // for rows persisted before this field existed.
            let parsedKind = row.kind;
            let parsedKey = row.key;
            if (parsedKind == null || parsedKey == null) {
                const rel = k.slice('agent-db/snapshots/'.length).replace(/\.json$/, '');
                const slash = rel.indexOf('/');
                parsedKind = slash < 0 ? rel : rel.slice(0, slash);
                parsedKey = slash < 0 ? '' : rel.slice(slash + 1);
            }
            out.push({ kind: parsedKind, key: parsedKey, schemaVersion: row.schemaVersion, machineId: row.machineId, status: row.status, updated: row.updated });
        }
        out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
        return out;
    }

    // Quarantine window: a terminal (non-active) row younger than this is left
    // alone so a persist(status:'done'/'error') that just landed can't be
    // raced away by a concurrent or immediately-following sweepDone() before
    // any consumer (list()+load() panel, resume-check) has had a chance to
    // read it back. Default chosen to comfortably outlast a same-tick or
    // same-frame race without meaningfully delaying real garbage collection.
    const SWEEP_GRACE_MS = 5000;

    async function sweepDone({ graceMs = SWEEP_GRACE_MS } = {}) {
        const all = await list({ kind: null, status: null });
        let removed = 0;
        const cutoff = Date.now() - graceMs;
        for (const row of all) {
            if (row.status === 'active') continue;
            if ((row.updated || 0) > cutoff) continue; // too fresh — quarantined
            await clear(row.kind, row.key);
            removed++;
        }
        return { removed };
    }

    return { persist, load, clear, list, sweepDone };
}

// createIdbStepStore(fs) -> {runStep, isStepDone, clearSteps, listSteps}
export function createIdbStepStore(fs) {
    if (!fs || typeof fs.readJson !== 'function' || typeof fs.writeJson !== 'function') {
        throw new Error('createIdbStepStore: fs (instance.fs with readJson/writeJson) required');
    }

    // In-process lock, same shape as freddie's own step-journal.js: within one
    // live page, two concurrent runStep calls for the same key must not both
    // run fn. Does not survive a reload (fine — a reload is exactly the crash
    // case runStep's started-only-row branch below is designed to recover).
    const inflight = new Map(); // `${sessionKey} ${stepId}` -> Promise

    async function runStep(sessionKey, stepId, fn, { serialize = JSON.stringify, deserialize = JSON.parse } = {}) {
        if (!sessionKey || !stepId) return await fn();
        const lockKey = sessionKey + ' ' + stepId;
        if (inflight.has(lockKey)) return await inflight.get(lockKey);

        const exec = (async () => {
            const p = stepPath(sessionKey, stepId);
            let row = null;
            try { row = fs.readJson(p, null); } catch { row = null; }
            if (row && row.status === 'done') {
                try { return deserialize(row.result); }
                catch {
                    // Stored result unparseable — discard and re-run rather than crash.
                    try { fs.unlink(p); } catch { /* already gone */ }
                }
            }
            // A prior run's result could not be journaled (non-serializable).
            // The side effect already happened once; do not silently re-run
            // it forever — surface a loud error so the caller/operator can
            // fix the underlying non-serializable result instead of it being
            // swallowed and re-executed on every future call.
            if (row && row.status === 'done-unpersisted') {
                throw new Error(
                    'runStep: step ' + JSON.stringify(sessionKey) + '/' + JSON.stringify(stepId) +
                    ' previously ran but its result could not be journaled (non-serializable) — ' +
                    'refusing to silently re-run a side-effecting step. Clear this step explicitly ' +
                    '(clearSteps) to force a re-run, or fix the step function to return a serializable result.'
                );
            }
            // No completed row (fresh, or started-only from a crash mid-fn): (re)run.
            fs.writeJson(p, { status: 'started', result: null, started: Date.now(), done: null });
            const result = await fn();
            let json;
            try { json = serialize(result); }
            catch (serializeErr) {
                // Non-serializable result: the call already ran and we cannot
                // journal it as 'done'. Mark it 'done-unpersisted' (distinct
                // from 'started') so a resume does NOT silently re-run this
                // step's side effects indefinitely, and surface the failure
                // instead of swallowing it.
                try {
                    fs.writeJson(p, { status: 'done-unpersisted', result: null, started: Date.now(), done: Date.now() });
                } catch { /* best effort */ }
                try {
                    console.error('runStep: step result not serializable, journaled as done-unpersisted', sessionKey, stepId, serializeErr);
                } catch { /* console unavailable */ }
                return result;
            }
            fs.writeJson(p, { status: 'done', result: json, started: Date.now(), done: Date.now() });
            return result;
        })();

        inflight.set(lockKey, exec);
        try { return await exec; }
        finally { inflight.delete(lockKey); }
    }

    async function isStepDone(sessionKey, stepId) {
        if (!sessionKey || !stepId) return false;
        let row = null;
        try { row = fs.readJson(stepPath(sessionKey, stepId), null); } catch { row = null; }
        return !!row && row.status === 'done';
    }

    async function listSteps(sessionKey) {
        const keys = fs.list(stepDirPrefix(sessionKey));
        const out = [];
        for (const k of keys) {
            if (!k.endsWith('.json')) continue;
            let row = null;
            try { row = fs.readJson('/' + k, null); } catch { row = null; }
            if (!row) continue;
            const stepId = k.slice(k.lastIndexOf('/') + 1).replace(/\.json$/, '');
            out.push({ step_id: stepId, status: row.status, started: row.started, done: row.done });
        }
        out.sort((a, b) => (a.started || 0) - (b.started || 0));
        return out;
    }

    async function clearSteps(sessionKey) {
        if (!sessionKey) return;
        const keys = fs.list(stepDirPrefix(sessionKey));
        for (const k of keys) {
            try { fs.unlink('/' + k); } catch { /* already gone */ }
        }
    }

    return { runStep, isStepDone, clearSteps, listSteps };
}

// Convenience: build both stores from one instance.fs handle, matching the
// {persist,load,clear} + {runStep,isStepDone,clearSteps} shape
// createPersistentActor/createAgentMachine/runStep(..., {store}) expect.
export function createIdbAgentStores(fs) {
    return {
        snapshotStore: createIdbSnapshotStore(fs),
        stepStore: createIdbStepStore(fs),
    };
}
