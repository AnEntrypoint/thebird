const snap = () => globalThis.__debug?.idbSnapshot || {};
const toKey = p => String(p).replace(/^\//, '');
function readFileSync(p, enc) { const v = snap()[toKey(p)]; if (v == null) throw new Error('ENOENT: ' + p); if (enc) return v; return new TextEncoder().encode(v); }
function writeFileSync(p, d) { snap()[toKey(p)] = typeof d === 'string' ? d : new TextDecoder().decode(d); globalThis.__debug?.idbPersist?.(); }
function existsSync(p) { return toKey(p) in snap(); }
function readdirSync(d) { const k = toKey(d); const out = new Set(); for (const key of Object.keys(snap())) { if (key.startsWith(k + '/')) { out.add(key.slice(k.length + 1).split('/')[0]); } } return [...out]; }
function mkdirSync(p, opts) { /* noop — IDB snapshot has no dir semantics */ return undefined; }
function statSync(p) {
    const k = toKey(p);
    if (k in snap()) return { isFile: () => true, isDirectory: () => false, size: (snap()[k] || '').length, mtimeMs: Date.now() };
    // treat unknown as directory so callers can readdir
    return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: Date.now() };
}
// Append-mode write stream backed by the IDB snapshot. Freddie's logger calls
// this to write JSONL log lines; without it, the agent loop crashes the first
// time it tries to log anything ('fs.createWriteStream is not a function').
function createWriteStream(p, opts) {
    const k = toKey(p);
    const append = !!(opts && (opts.flags === 'a' || opts.flags === 'a+'));
    if (!append || !(k in snap())) snap()[k] = '';
    return {
        write(chunk) {
            const s = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            snap()[k] = (snap()[k] || '') + s;
            try { globalThis.__debug?.idbPersist?.(); } catch {}
            return true;
        },
        end(chunk) { if (chunk != null) this.write(chunk); return this; },
        close() {},
        on() { return this; },
        once() { return this; },
        removeListener() { return this; },
        emit() { return false; },
    };
}
const _fs = { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, createWriteStream, promises: { readFile: async (p, e) => readFileSync(p, e), writeFile: async (p, d) => writeFileSync(p, d), mkdir: async () => {}, stat: async (p) => statSync(p) } };
export default _fs;
export { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, createWriteStream };
