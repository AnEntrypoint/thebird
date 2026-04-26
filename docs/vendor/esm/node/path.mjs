function join(...parts) { return parts.filter(Boolean).join('/').replace(/\/+/g, '/'); }
function resolve(...parts) { let cur = '/'; for (const p of parts) { if (!p) continue; cur = p.startsWith('/') ? p : join(cur, p); } return cur.replace(/\/+/g, '/'); }
function dirname(p) { const i = String(p).lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
function basename(p, ext) { let b = String(p).split('/').pop() || ''; if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; }
function extname(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i); }
function normalize(p) { return resolve(p); }
const sep = '/';
const _path = { join, resolve, dirname, basename, extname, normalize, sep };
export default _path;
export { join, resolve, dirname, basename, extname, normalize, sep };
