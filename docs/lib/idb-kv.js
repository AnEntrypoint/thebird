// Shared generic IndexedDB key-value helpers. Extracted from sw-instance.js
// (which had the canonical, race-safe implementation) so page-context
// consumers (instance-fs.js, freddie-host.js) and the per-instance Service
// Worker share one implementation instead of three drifting copies.
//
// ES module — sw-instance.js (a classic importScripts-loaded script) reaches
// this via dynamic `import()`, which is valid in classic script context too;
// page-context modules just `import { ... } from './lib/idb-kv.js'` directly.

export function openDb(name, store) {
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

export async function kvGet(dbName, store, key) {
    const db = await openDb(dbName, store);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result == null ? null : req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}

export async function kvPut(dbName, store, key, val) {
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
export async function kvUpdate(dbName, store, key, mutate) {
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

export async function kvDelete(dbName, store, key) {
    const db = await openDb(dbName, store);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}
