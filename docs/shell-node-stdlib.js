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

const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

function sha256Bytes(data) {
  const msg = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const bitLen = msg.length * 8;
  const padLen = (msg.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(msg); padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0); view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) W[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(W[j - 15], 7) ^ rotr(W[j - 15], 18) ^ (W[j - 15] >>> 3);
      const s1 = rotr(W[j - 2], 17) ^ rotr(W[j - 2], 19) ^ (W[j - 2] >>> 10);
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + W[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, H[i]);
  return out;
}

export function createHash(alg) {
  const a = alg.toLowerCase();
  const chunks = [];
  return {
    update(data) { chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data); return this; },
    digest(enc) {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const buf = new Uint8Array(total); let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      if (a !== 'sha256') throw new Error('hash algorithm not supported: ' + a + ' (sha256 only)');
      const out = sha256Bytes(buf);
      if (enc === 'hex') return [...out].map(b => b.toString(16).padStart(2, '0')).join('');
      if (enc === 'base64') return btoa(String.fromCharCode(...out));
      return out;
    },
  };
}

let fflatePromise = null;
async function getFflate() {
  if (!fflatePromise) fflatePromise = import('https://esm.sh/fflate@0.8.2/es2022/fflate.mjs').then(m => m.gzipSync ? m : (m.default && m.default.gzipSync ? m.default : m));
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
