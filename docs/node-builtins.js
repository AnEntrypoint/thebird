const snap = () => window.__debug?.idbSnapshot || {};
const toKey = p => p.replace(/^\//, '');
const persist = () => window.__debug?.idbPersist?.();
const previewWrite = () => window.__debug?.shell?.onPreviewWrite?.();

export function createPath() {
  const sep = '/';
  const normalize = p => {
    const parts = [];
    for (const s of p.split('/')) {
      if (s === '..') parts.pop();
      else if (s && s !== '.') parts.push(s);
    }
    return (p.startsWith('/') ? '/' : '') + parts.join('/');
  };
  return {
    sep,
    normalize,
    join: (...a) => normalize(a.join('/')),
    resolve: (...a) => {
      let r = '';
      for (const p of a) r = p.startsWith('/') ? p : r + '/' + p;
      return normalize(r);
    },
    dirname: p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); },
    basename: (p, ext) => { const b = p.split('/').pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
    extname: p => { const b = p.split('/').pop() || ''; const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    isAbsolute: p => p.startsWith('/'),
    relative: (from, to) => to.replace(from.replace(/\/$/, '') + '/', ''),
    parse: p => {
      const dir = p.slice(0, p.lastIndexOf('/')) || '/';
      const base = p.split('/').pop() || '';
      const ext = base.lastIndexOf('.') > 0 ? base.slice(base.lastIndexOf('.')) : '';
      return { root: '/', dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
    },
  };
}

export function createFs() {
  const resolveP = p => typeof p === 'string' ? p : p.toString();
  return {
    readFileSync: (p, enc) => {
      const key = toKey(resolveP(p));
      const data = snap()[key];
      if (data == null) throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
      return enc ? data : data;
    },
    writeFileSync: (p, data) => {
      const s = snap();
      s[toKey(resolveP(p))] = typeof data === 'string' ? data : String(data);
      persist();
      previewWrite();
    },
    appendFileSync: (p, data) => {
      const key = toKey(resolveP(p));
      const s = snap();
      s[key] = (s[key] || '') + (typeof data === 'string' ? data : String(data));
      persist();
    },
    existsSync: p => toKey(resolveP(p)) in snap(),
    unlinkSync: p => {
      const key = toKey(resolveP(p));
      if (!(key in snap())) throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
      delete snap()[key];
      persist();
    },
    mkdirSync: (p, opts) => {
      const key = toKey(resolveP(p));
      if (!snap()[key + '/.keep']) { snap()[key + '/.keep'] = ''; persist(); }
    },
    readdirSync: p => {
      const prefix = toKey(resolveP(p));
      const pLen = prefix ? prefix.length + 1 : 0;
      const seen = new Set();
      for (const k of Object.keys(snap())) {
        if (prefix && !k.startsWith(prefix + '/') && k !== prefix) continue;
        if (!prefix && !k.includes('/')) { seen.add(k); continue; }
        const rest = k.slice(pLen);
        const first = rest.split('/')[0];
        if (first && first !== '.keep') seen.add(first);
      }
      return [...seen];
    },
    statSync: p => {
      const key = toKey(resolveP(p));
      const s = snap();
      const isFile = key in s;
      const isDir = !isFile && Object.keys(s).some(k => k.startsWith(key + '/'));
      if (!isFile && !isDir) throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
      return { isFile: () => isFile, isDirectory: () => isDir, size: isFile ? (s[key]?.length || 0) : 0 };
    },
    renameSync: (o, n) => {
      const s = snap();
      const ok = toKey(resolveP(o)), nk = toKey(resolveP(n));
      if (!(ok in s)) throw Object.assign(new Error('ENOENT: ' + o), { code: 'ENOENT' });
      s[nk] = s[ok];
      delete s[ok];
      persist();
    },
    copyFileSync: (s, d) => {
      const src = snap()[toKey(resolveP(s))];
      if (src == null) throw Object.assign(new Error('ENOENT: ' + s), { code: 'ENOENT' });
      snap()[toKey(resolveP(d))] = src;
      persist();
    },
  };
}

export function createEvents() {
  return class EventEmitter {
    constructor() { this._e = {}; }
    on(ev, fn) { (this._e[ev] = this._e[ev] || []).push(fn); return this; }
    once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; return this.on(ev, w); }
    off(ev, fn) { this._e[ev] = (this._e[ev] || []).filter(f => f !== fn); return this; }
    removeListener(ev, fn) { return this.off(ev, fn); }
    removeAllListeners(ev) { if (ev) delete this._e[ev]; else this._e = {}; return this; }
    emit(ev, ...a) { for (const fn of (this._e[ev] || [])) fn(...a); return (this._e[ev] || []).length > 0; }
    listeners(ev) { return (this._e[ev] || []).slice(); }
    listenerCount(ev) { return (this._e[ev] || []).length; }
  };
}

export function createUrl() {
  return {
    parse: s => {
      const u = new URL(s);
      return { protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, query: u.search.slice(1), hash: u.hash, href: u.href };
    },
    format: o => {
      const u = new URL('http://x');
      for (const [k, v] of Object.entries(o)) { try { u[k] = v; } catch {} }
      return u.href;
    },
    resolve: (from, to) => new URL(to, from).href,
  };
}

export function createQuerystring() {
  return {
    parse: s => Object.fromEntries(new URLSearchParams(s)),
    stringify: o => new URLSearchParams(o).toString(),
    escape: s => encodeURIComponent(s),
    unescape: s => decodeURIComponent(s),
  };
}

export function createBuffer() {
  class Buf extends Uint8Array {
    toString(enc) {
      if (enc === 'base64') return btoa(String.fromCharCode(...this));
      if (enc === 'hex') return [...this].map(b => b.toString(16).padStart(2, '0')).join('');
      return new TextDecoder().decode(this);
    }
    toJSON() { return { type: 'Buffer', data: [...this] }; }
    slice(s, e) { return Buf.from(super.slice(s, e)); }
  }
  Buf.from = (d, enc) => {
    if (d instanceof Uint8Array) return new Buf(d);
    if (Array.isArray(d)) return new Buf(d);
    if (typeof d !== 'string') return new Buf(0);
    if (enc === 'base64') return new Buf(Uint8Array.from(atob(d), c => c.charCodeAt(0)));
    if (enc === 'hex') return new Buf(d.match(/.{2}/g).map(h => parseInt(h, 16)));
    return new Buf(new TextEncoder().encode(d));
  };
  Buf.alloc = (n, fill) => { const b = new Buf(n); if (fill) b.fill(typeof fill === 'number' ? fill : fill.charCodeAt(0)); return b; };
  Buf.concat = list => { const t = list.reduce((s, b) => s + b.length, 0); const r = new Buf(t); let o = 0; for (const b of list) { r.set(b, o); o += b.length; } return r; };
  Buf.isBuffer = o => o instanceof Buf;
  Buf.byteLength = (s, enc) => Buf.from(s, enc).length;
  return Buf;
}
