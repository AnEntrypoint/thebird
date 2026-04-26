const COLORS = { string: '\x1b[32m', number: '\x1b[33m', boolean: '\x1b[33m', bigint: '\x1b[33m', null: '\x1b[1m', undefined: '\x1b[90m', symbol: '\x1b[35m', regexp: '\x1b[31m', date: '\x1b[35m', special: '\x1b[36m' };
const RESET = '\x1b[0m';
const paint = (s, c, on) => on ? c + s + RESET : s;

function inspectPrimitive(v, colors) {
  if (v === null) return paint('null', COLORS.null, colors);
  if (v === undefined) return paint('undefined', COLORS.undefined, colors);
  const t = typeof v;
  if (t === 'string') return paint("'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'", COLORS.string, colors);
  if (t === 'bigint') return paint(String(v) + 'n', COLORS.bigint, colors);
  if (t === 'number' || t === 'boolean') return paint(String(v), COLORS[t], colors);
  if (t === 'symbol') return paint(v.toString(), COLORS.symbol, colors);
  if (t === 'function') return paint('[Function' + (v.name ? ': ' + v.name : ' (anonymous)') + ']', COLORS.special, colors);
  return null;
}

export function inspect(v, opts = {}, depth = 0, seen = new Map(), refCount = { n: 0 }) {
  const colors = !!opts.colors;
  const prim = inspectPrimitive(v, colors);
  if (prim !== null) return prim;
  if (v instanceof Date) return paint(v.toISOString(), COLORS.date, colors);
  if (v instanceof RegExp) return paint(v.toString(), COLORS.regexp, colors);
  if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
  if (seen.has(v)) { const id = seen.get(v); if (id.ref == null) id.ref = ++refCount.n; return '[Circular *' + id.ref + ']'; }
  const entry = { ref: null }; seen.set(v, entry);
  const maxDepth = opts.depth ?? 2;
  if (depth > maxDepth) return Array.isArray(v) ? '[Array]' : '[Object]';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[ ' + v.map(x => inspect(x, opts, depth + 1, seen, refCount)).join(', ') + ' ]';
  }
  if (v instanceof Map) {
    const entries = [...v.entries()].map(([k, val]) => inspect(k, opts, depth + 1, seen, refCount) + ' => ' + inspect(val, opts, depth + 1, seen, refCount));
    return 'Map(' + v.size + ')' + (v.size ? ' { ' + entries.join(', ') + ' }' : ' {}');
  }
  if (v instanceof Set) {
    const items = [...v].map(x => inspect(x, opts, depth + 1, seen, refCount));
    return 'Set(' + v.size + ')' + (v.size ? ' { ' + items.join(', ') + ' }' : ' {}');
  }
  if (v instanceof Uint8Array) {
    const hex = [...v.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join(' ');
    return '<Buffer ' + hex + (v.length > 16 ? ' ... ' + (v.length - 16) + ' more bytes' : '') + '>';
  }
  const keys = opts.showHidden ? Object.getOwnPropertyNames(v) : Object.keys(v);
  const syms = Object.getOwnPropertySymbols(v);
  if (!keys.length && !syms.length) return '{}';
  const parts = keys.map(k => {
    const ks = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : "'" + k + "'";
    return ks + ': ' + inspect(v[k], opts, depth + 1, seen, refCount);
  }).concat(syms.map(s => '[' + s.toString() + ']: ' + inspect(v[s], opts, depth + 1, seen, refCount)));
  const ctor = v.constructor && v.constructor !== Object ? v.constructor.name + ' ' : '';
  const body = ctor + '{ ' + parts.join(', ') + ' }';
  return entry.ref != null ? '<ref *' + entry.ref + '> ' + body : body;
}

export function format(...args) {
  if (!args.length) return '';
  const fmt = args[0];
  if (typeof fmt !== 'string') return args.map(a => typeof a === 'object' ? inspect(a) : String(a)).join(' ');
  let i = 1;
  const out = fmt.replace(/%[sdifjoO%]/g, m => {
    if (m === '%%') return '%';
    if (i >= args.length) return m;
    const a = args[i++];
    if (m === '%s') return String(a);
    if (m === '%d' || m === '%i') return String(parseInt(a, 10));
    if (m === '%f') return String(parseFloat(a));
    if (m === '%j') return JSON.stringify(a);
    if (m === '%o' || m === '%O') return inspect(a);
    return m;
  });
  const extra = args.slice(i).map(a => typeof a === 'object' ? inspect(a) : String(a));
  return extra.length ? out + ' ' + extra.join(' ') : out;
}

export { createHash } from './shell-node-crypto.js';

let fflatePromise = null;
async function getFflate() {
  if (!fflatePromise) fflatePromise = import('./vendor/esm/fflate.mjs').then(m => m.gzipSync ? m : (m.default && m.default.gzipSync ? m.default : m));
  return fflatePromise;
}
let fflateSync = null;
export async function preloadFflate() { fflateSync = await getFflate(); return fflateSync; }

export function createZlib(Buf) {
  const need = () => { if (!fflateSync) throw new Error('zlib sync: preloadFflate() must run before sync zlib calls (auto-preloaded on node entry)'); return fflateSync; };
  return {
    gzipSync: b => Buf.from(need().gzipSync(b instanceof Uint8Array ? b : new TextEncoder().encode(String(b)))),
    gunzipSync: b => Buf.from(need().gunzipSync(b)),
    deflateSync: b => Buf.from(need().deflateSync(b instanceof Uint8Array ? b : new TextEncoder().encode(String(b)))),
    inflateSync: b => Buf.from(need().inflateSync(b)),
    deflateRawSync: b => Buf.from(need().deflateSync(b, { raw: true }) || need().deflateSync(b)),
    inflateRawSync: b => Buf.from(need().inflateSync(b, { raw: true }) || need().inflateSync(b)),
    gzip: async (buf, cb) => { try { const p = await getFflate(); const out = Buf.from(p.gzipSync(buf instanceof Uint8Array ? buf : new TextEncoder().encode(String(buf)))); if (cb) cb(null, out); return out; } catch (e) { if (cb) cb(e); else throw e; } },
    gunzip: async (buf, cb) => { try { const p = await getFflate(); const out = Buf.from(p.gunzipSync(buf)); if (cb) cb(null, out); return out; } catch (e) { if (cb) cb(e); else throw e; } },
    deflate: async (buf, cb) => { const p = await getFflate(); const out = Buf.from(p.deflateSync(buf instanceof Uint8Array ? buf : new TextEncoder().encode(String(buf)))); if (cb) cb(null, out); return out; },
    inflate: async (buf, cb) => { const p = await getFflate(); const out = Buf.from(p.inflateSync(buf)); if (cb) cb(null, out); return out; },
    createGzip: () => ({ pipe: () => {}, on: () => {}, write: () => {}, end: () => {} }),
    createGunzip: () => ({ pipe: () => {}, on: () => {}, write: () => {}, end: () => {} }),
    constants: { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1 },
  };
}
