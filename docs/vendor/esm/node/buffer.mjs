const Buf = globalThis.Buffer || class extends Uint8Array {
  static from(d, enc) {
    if (typeof d === 'string') return new TextEncoder().encode(enc === 'base64' ? atob(d) : d);
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (Array.isArray(d)) return new Uint8Array(d);
    return new Uint8Array(d);
  }
  static alloc(n, fill) { const b = new Uint8Array(n); if (fill != null) b.fill(typeof fill === 'string' ? fill.charCodeAt(0) : fill); return b; }
  static allocUnsafe(n) { return new Uint8Array(n); }
  static isBuffer(o) { return o instanceof Uint8Array; }
  static concat(arr) { let n = 0; for (const a of arr) n += a.length; const r = new Uint8Array(n); let o = 0; for (const a of arr) { r.set(a, o); o += a.length; } return r; }
  toString(enc) { if (enc === 'base64') return btoa(String.fromCharCode(...this)); return new TextDecoder().decode(this); }
};
export const Buffer = Buf;
export default { Buffer: Buf };
