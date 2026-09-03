// Minimal node:fs shim — busybase's embedded.ts only uses mkdirSync, and only when
// backend === 'libsql' (file:-URL persistence). For the plugkit backend it's never
// called. No-op is safe.
export function mkdirSync(_path, _opts) { /* no-op in browser */ }
export default { mkdirSync };
