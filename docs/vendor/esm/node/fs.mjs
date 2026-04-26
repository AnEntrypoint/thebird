const snap = () => globalThis.__debug?.idbSnapshot || {};
const toKey = p => String(p).replace(/^\//, '');
function readFileSync(p, enc) { const v = snap()[toKey(p)]; if (v == null) throw new Error('ENOENT: ' + p); if (enc) return v; return new TextEncoder().encode(v); }
function writeFileSync(p, d) { snap()[toKey(p)] = typeof d === 'string' ? d : new TextDecoder().decode(d); globalThis.__debug?.idbPersist?.(); }
function existsSync(p) { return toKey(p) in snap(); }
function readdirSync(d) { const k = toKey(d); const out = new Set(); for (const key of Object.keys(snap())) { if (key.startsWith(k + '/')) { out.add(key.slice(k.length + 1).split('/')[0]); } } return [...out]; }
const _fs = { readFileSync, writeFileSync, existsSync, readdirSync, promises: { readFile: async (p, e) => readFileSync(p, e), writeFile: async (p, d) => writeFileSync(p, d) } };
export default _fs;
export { readFileSync, writeFileSync, existsSync, readdirSync };
