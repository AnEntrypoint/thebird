// Shared accessors for the in-browser IDB-backed filesystem snapshot. The shell
// builtins all reach the same window.__debug snapshot protocol; these helpers are
// the single home for it (was 5-6 identical inline copies).
export const toKey = p => p.replace(/^\//, '');
export const snap = () => window.__debug?.idbSnapshot || {};
export const persist = () => window.__debug?.idbPersist?.();
