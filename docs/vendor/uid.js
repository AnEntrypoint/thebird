// Single source of quasi-unique id generation for the whole SDK and every
// static-site consumer, instead of each call site pasting its own
// Math.random().toString(36) one-liner. Prefers crypto.randomUUID() (both
// browser and modern Node have this); falls back to a Math.random-based
// id only when crypto.randomUUID is unavailable (older runtimes).
//
// ORDERING WARNING: neither uid() nor shortUid() is monotonic or lexically
// sortable. crypto.randomUUID() is fully random (UUIDv4), and the fallback
// appends a base36 timestamp as a trailing suffix, not a sortable prefix, so
// lexical/numeric sort of these ids does NOT recover creation order. Callers
// that need creation-order semantics must sort by an explicit timestamp
// field (e.g. `createdAt`) stored alongside the id, never by the id itself.
export function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        let hex = '';
        for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
        return hex;
    }
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Short id variant for call sites that just want a compact suffix (e.g.
// DOM ids, temp-file names) rather than a full UUID. `len` caps the
// random-part length (default 8, matching the common `.slice(2, 10)` idiom).
// Not ordered/sortable either -- same warning as uid() above applies.
export function shortUid(len = 8) {
    return uid().replace(/-/g, '').slice(0, len);
}
