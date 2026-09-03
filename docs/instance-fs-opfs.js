// Real per-file OPFS (Origin Private File System) backing for instance-fs.js.
//
// instance-fs.js's in-memory `snapshot` object (one key per POSIX path,
// mutated synchronously by docs/shell-posix.js's readFileSync/writeFileSync)
// stays the live read/write surface unchanged -- every one of its 22+
// consumers (terminal-app.js, os-shell.js, freddie-chat.js, workspaces-app.js,
// ...) keeps working exactly as before. What changes is PERSISTENCE: instead
// of JSON.stringify-ing the ENTIRE snapshot into one single IndexedDB key on
// every debounced write (instance-fs.js's prior design), each snapshot key
// now persists as its own real file at the matching path inside a real OPFS
// directory tree (navigator.storage.getDirectory()), so a write to one file
// no longer re-serializes every other file in the instance, and the browser's
// OPFS quota (generally far larger than IndexedDB's blob-per-key practical
// limit) backs it instead.
//
// OPFS's synchronous file API (createSyncAccessHandle) only exists inside a
// Worker, so all real I/O here runs in a dedicated Worker (same shape as
// shell-node-opfs.js's existing worker, generalized to whole-snapshot load/
// save/delete instead of single ad hoc reads). The page-context API this
// module exports is async (load/saveOne/deleteOne/saveAll), matching
// instance-fs.js's already-async createFs() -- no consumer of `fs.snapshot`
// itself needs to change since that stays a plain synchronous in-memory object.
//
// A path is only ever encoded through toOpfsParts (POSIX-path -> real nested
// OPFS directories, matching instance-fs.js's own toKey stripping-of-leading-
// slash), so 'etc/freddie/config.yaml' becomes a real
// <root>/etc/freddie/config.yaml file, not a flat escaped filename -- large
// instances (freddie workspaces, git checkouts) get real directory fan-out
// instead of one giant flat listing.
//
// Every incoming message is serialized against operations that could
// actually collide on the same underlying OPFS file, via a per-key lock
// (_keyLocks) plus a whole-tree barrier (_treeBarrier) for saveAll/loadAll/
// destroy -- NOT one single global FIFO queue. OPFS's createSyncAccessHandle
// throws if a second handle is requested for a file that already has one
// open, so instance-fs.js's own fastPathWrite (per-key saveOne) and
// schedulePersist (debounced full saveAll) firing close together for the
// SAME key must still serialize. But a single global queue over-serializes:
// a saveAll's full recursive tree walk+prune (30s timeout budget, can take
// several seconds on a large instance -- gm's .gm/exec-spool, rs-learn.db,
// code-search index, etc.) previously blocked EVERY OTHER queued saveOne for
// unrelated keys behind it, so a burst of small writes (e.g. gm's own
// .dispatch-ledger.json/.last-dispatch-ts/.codeinsight-digest files, each
// written via the 10s-timeout saveOne fast path) would blow their 10s budget
// purely from FIFO queueing delay behind an in-flight saveAll, not from any
// real I/O failure -- found live 2026-07-31 as the
// 'opfs call timeout after 10000ms: saveOne' storm feeding rc=14 sqlite
// failures downstream. Two disjoint-key saveOne/deleteOne calls now run
// CONCURRENTLY (real parallelism OPFS's async directory-handle API supports
// fine); only same-key ops and any op overlapping a whole-tree op still wait.
const WORKER_SRC = `
const _keyLocks = new Map(); // key -> promise chain, so only same-key ops serialize
let _treeBarrier = Promise.resolve(); // resolves once no whole-tree op is in flight
const _inFlightKeyed = new Set(); // promises of currently-running per-key ops
async function _runKeyed(key, fn) {
  await _treeBarrier; // whole-tree op (saveAll/loadAll/destroy) in flight -> wait
  const prev = _keyLocks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tracked = next.catch(() => {}).then(() => { _inFlightKeyed.delete(tracked); });
  _inFlightKeyed.add(tracked);
  _keyLocks.set(key, next.catch(() => {}));
  return next;
}
async function _runTreeWide(fn) {
  // Wait for the current tree barrier (so whole-tree ops themselves still
  // serialize with each other, one at a time), install a NEW barrier
  // immediately so no per-key op that arrives from here on can slip past it,
  // THEN snapshot+await every per-key op already in flight at that instant
  // (no partial-write race against a concurrent saveOne on a key this walk
  // will also touch). Snapshotting the Set right after arming the barrier --
  // rather than checking a counter separately -- means there is no gap
  // between "check if anything is in flight" and "start waiting on it" for
  // a racing completion to fall into.
  const prevBarrier = _treeBarrier;
  let release;
  _treeBarrier = new Promise(res => { release = res; });
  await prevBarrier;
  await Promise.all([..._inFlightKeyed]);
  try {
    return await fn();
  } finally {
    release();
  }
}
self.addEventListener('message', e => {
  handleMessage(e.data).catch(() => {});
});
async function handleMessage({ id, op, dbName, entries, path, deletedKeys }) {
  try {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle(dbName, { create: true });
    const toParts = p => String(p).replace(/^\\/+/, '').split('/').filter(s => s && s !== '.');

    const dirFor = async (parts, create) => {
      let dir = root;
      for (const seg of parts) {
        dir = await dir.getDirectoryHandle(seg, { create });
      }
      return dir;
    };

    if (op === 'loadAll') {
      // Walk the whole tree, collecting {key: value} for every file found.
      // Keys reconstruct the original POSIX path (no leading slash, matching
      // instance-fs.js's toKey convention) by joining the walk's dir segments.
      // Whole-tree op: goes through _runTreeWide so it never observes a
      // torn/partial file mid-write from a concurrent saveOne/deleteOne.
      const out = await _runTreeWide(async () => {
        async function walk(dir, prefix) {
          for await (const [name, handle] of dir.entries()) {
            const key = prefix ? prefix + '/' + name : name;
            if (handle.kind === 'directory') {
              await walk(handle, key);
            } else {
              const file = await handle.getFile();
              out2[key] = await file.text();
            }
          }
        }
        const out2 = {};
        await walk(root, '');
        return out2;
      });
      self.postMessage({ id, ok: true, snapshot: out });
      return;
    }

    if (op === 'saveAll') {
      // Full resync: write every entry (create/update). Deletion is handled
      // via the EXPLICIT deletedKeys list the caller captured at the moment
      // each key was actually removed from the live snapshot (see
      // instance-fs.js's deleteProperty trap), never by diffing this call's
      // entries snapshot against what the tree currently holds -- that
      // prune-anything-absent-from-entries scheme was a race: entries is
      // captured synchronously when the debounced save fires, but a brand
      // new key written via the saveOne fast path AFTER that capture (while
      // this tree-wide op is still queued behind _treeBarrier) would be
      // absent from the stale captured set and get deleted here even though
      // it was never removed from the in-memory snapshot. Only pruning keys
      // the caller positively knows were deleted removes that race entirely.
      // Whole-tree op: goes through _runTreeWide so it waits for every
      // in-flight per-key saveOne/deleteOne to settle first (no partial-
      // write race against a key this walk will also touch), and itself
      // blocks new per-key ops from starting until it's done -- but does NOT
      // block per-key ops on UNRELATED keys queued behind it in a shared
      // FIFO, because there is no shared FIFO anymore; each per-key op only
      // waits on its own key's chain plus this barrier.
      const wantKeys = Object.keys(entries);
      const toDelete = Array.isArray(deletedKeys) ? deletedKeys : [];
      const count = await _runTreeWide(async () => {
        for (const key of wantKeys) {
          const parts = toParts(key);
          const fname = parts.pop();
          const dir = await dirFor(parts, true);
          const fh = await dir.getFileHandle(fname, { create: true });
          const sync = await fh.createSyncAccessHandle();
          try {
            // Write new bytes FIRST, then truncate to the new length only
            // after write() has succeeded -- if write() throws (e.g.
            // QuotaExceededError on quota-exceeded writes), the file is left
            // at its prior on-disk length/content instead of destroyed by an
            // upfront truncate(0). A shrink is still applied, but only once
            // the new bytes are durably written, never before.
            const bytes = new TextEncoder().encode(String(entries[key]));
            sync.write(bytes, { at: 0 });
            sync.truncate(bytes.byteLength);
            sync.flush();
          } finally {
            sync.close();
          }
        }
        for (const key of toDelete) {
          const parts = toParts(key);
          const fname = parts.pop();
          const dir = await dirFor(parts, false).catch(() => null);
          if (dir) await dir.removeEntry(fname).catch(() => {});
        }
        return wantKeys.length;
      });
      self.postMessage({ id, ok: true, count });
      return;
    }

    if (op === 'saveOne') {
      // Per-key op: only serializes against another op on the SAME key (or
      // a whole-tree op in flight) -- never against saveOne/deleteOne calls
      // for unrelated keys, which is exactly the head-of-line-blocking this
      // per-key lock scheme fixes (see the block comment above WORKER_SRC).
      await _runKeyed(path, async () => {
        const parts = toParts(path);
        const fname = parts.pop();
        const dir = await dirFor(parts, true);
        const fh = await dir.getFileHandle(fname, { create: true });
        const sync = await fh.createSyncAccessHandle();
        try {
          // Same write-then-truncate ordering as saveAll above: a failed
          // write() leaves the prior file content intact instead of an
          // upfront truncate(0) destroying it first.
          const bytes = new TextEncoder().encode(String(entries));
          sync.write(bytes, { at: 0 });
          sync.truncate(bytes.byteLength);
          sync.flush();
        } finally {
          sync.close();
        }
      });
      self.postMessage({ id, ok: true });
      return;
    }

    if (op === 'deleteOne') {
      await _runKeyed(path, async () => {
        const parts = toParts(path);
        const fname = parts.pop();
        const dir = await dirFor(parts, false).catch(() => null);
        if (dir) await dir.removeEntry(fname).catch(() => {});
      });
      self.postMessage({ id, ok: true });
      return;
    }

    if (op === 'destroy') {
      await _runTreeWide(async () => {
        await origin.removeEntry(dbName, { recursive: true }).catch(() => {});
      });
      self.postMessage({ id, ok: true });
      return;
    }

    self.postMessage({ id, error: 'unknown op: ' + op });
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
}
`;

let _blobUrl = null;
function workerUrl() {
    if (_blobUrl) return _blobUrl;
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    _blobUrl = URL.createObjectURL(blob);
    return _blobUrl;
}

/** True if this browser/context can actually back a real per-file OPFS store. */
export function opfsSupported() {
    return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

/**
 * Open a per-instance OPFS-backed store. Returns null if OPFS is unavailable
 * (Safari<15.2, non-secure-context, some embedded/automation browsers) --
 * callers fall back to the pure-IndexedDB path in that case, unchanged from
 * before this module existed.
 */
export function openOpfsStore(dbName) {
    if (!opfsSupported()) return null;
    const pending = new Map();
    let nextId = 1;
    let worker = null;
    let disposed = false;
    // Respawn budget: a single transient worker exception (unexpected message
    // shape, unrelated environment hiccup) must not permanently strand this
    // store on a rejects-forever `dead` flag -- respawn a fresh worker and
    // keep serving calls. Only a repeatedly-crashing environment (budget
    // exhausted) fails closed.
    let respawnsLeft = 5;

    function attach(w) {
        w.addEventListener('message', e => {
            const { id, ...rest } = e.data;
            const p = pending.get(id);
            if (!p) return;
            pending.delete(id);
            if (rest.error) p.reject(new Error(rest.error));
            else p.resolve(rest);
        });
        w.addEventListener('error', err => {
            const reason = 'opfs worker error: ' + (err.message || String(err));
            const ps = Array.from(pending.values());
            pending.clear();
            ps.forEach(p => p.reject(new Error(reason)));
            try { w.terminate(); } catch (_e) { /* already gone */ }
            if (worker !== w) return; // already superseded by a prior respawn
            if (disposed || respawnsLeft <= 0) { worker = null; return; }
            respawnsLeft--;
            worker = new Worker(workerUrl());
            attach(worker);
        });
    }
    worker = new Worker(workerUrl());
    attach(worker);
    // Tracks the most-recently-issued pending call id per key (saveOne/
    // deleteOne's `path`). When a call for a key times out on the page side,
    // the worker is NOT told to cancel -- it keeps running the op to
    // completion via its own _runKeyed chain (see WORKER_SRC). Without this
    // map, a later saveOne for the SAME key issued after that timeout (e.g.
    // a caller retry) races the still-in-flight stale op inside the worker's
    // per-key lock: whichever happens to finish last inside the worker wins,
    // an ordering the page side cannot observe or control, so the retry's
    // write can silently be overwritten by the older, already-abandoned one.
    // Fix: remember the latest id issued per key; when ANY response (success,
    // error, or timeout) arrives for an id that is no longer the latest for
    // its key, drop it -- it is superseded, its result must never resolve or
    // reject a caller's promise or be treated as authoritative.
    const latestIdForKey = new Map(); // key -> id of the most recent call for that key
    const call = (op, extra = {}, timeoutMs = 10000, key = null) => {
        if (disposed) return Promise.reject(new Error('opfs store disposed'));
        if (!worker) return Promise.reject(new Error('opfs worker dead: respawn budget exhausted'));
        return new Promise((resolve, reject) => {
            const id = nextId++;
            if (key !== null) latestIdForKey.set(key, id);
            const isStale = () => key !== null && latestIdForKey.get(key) !== id;
            // A stale call must still SETTLE its own promise (as a rejection)
            // -- never leave it silently pending forever. A caller that
            // issued this call is still holding (or awaiting) its promise;
            // only the *outcome* changes (a distinguishable supersession
            // error instead of the real success/failure/timeout), never
            // whether it settles at all.
            const superseded = () => reject(new Error('opfs call superseded by a newer call for the same key: ' + op));
            const t = setTimeout(() => {
                pending.delete(id);
                if (isStale()) { superseded(); return; }
                reject(new Error('opfs call timeout after ' + timeoutMs + 'ms: ' + op));
            }, timeoutMs);
            pending.set(id, {
                resolve: v => { clearTimeout(t); if (isStale()) { superseded(); return; } resolve(v); },
                reject: e => { clearTimeout(t); if (isStale()) { superseded(); return; } reject(e); },
            });
            worker.postMessage({ id, op, dbName, ...extra });
        });
    };
    return {
        // Loads the full snapshot object {key: stringValue} from real OPFS files.
        loadAll: () => call('loadAll', {}, 30000).then(r => r.snapshot),
        // Writes every key in `entries`. `deletedKeys` (optional) names the
        // OPFS files to remove -- explicit, caller-tracked deletions only,
        // never inferred by diffing entries against what the tree currently
        // holds (see the worker's saveAll handler for why that was a race).
        saveAll: (entries, deletedKeys) => call('saveAll', { entries, deletedKeys }, 30000),
        // Fast path for a single-file write (the common case: one key changed).
        // Keyed by `path` so a fresh saveOne for the same path supersedes any
        // still-in-flight-past-its-timeout prior call for that path.
        saveOne: (path, value) => call('saveOne', { path, entries: value }, 10000, path),
        deleteOne: (path) => call('deleteOne', { path }, 10000, path),
        destroy: () => call('destroy', {}, 15000),
        dispose() { disposed = true; if (worker) { try { worker.terminate(); } catch (_e) { /* noop */ } } worker = null; },
    };
}
