// Lightweight client-side registry. Subsystems register a snapshot fn;
// `window.__debug` exposes them all for live inspection.

const _registry = new Map();

export function register(name, snapshotFn) {
    if (typeof name !== 'string' || typeof snapshotFn !== 'function') return;
    _registry.set(name, snapshotFn);
    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        Object.defineProperty(window.__debug, name, {
            get() { try { return snapshotFn(); } catch (e) { return { error: String(e) }; } },
            configurable: true,
            enumerable: true,
        });
    }
}

export function unregister(name) {
    _registry.delete(name);
    if (typeof window !== 'undefined' && window.__debug) delete window.__debug[name];
}

export function snapshot() {
    const out = {};
    for (const [k, fn] of _registry) {
        try { out[k] = fn(); } catch (e) { out[k] = { error: String(e) }; }
    }
    return out;
}
