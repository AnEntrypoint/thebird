// This Buffer polyfill's whole point is a toString('utf8') that actually
// decodes bytes instead of falling through to Array-ish numeric joining --
// isomorphic-git's own object parser (at.unwrap in vendor/esm/isomorphic-git.mjs)
// calls exactly that on every git-object header it reads, and a raw
// Uint8Array's inherited toString() ignores the encoding argument entirely,
// producing something like "116,114,101,101" instead of "tree". Two separate
// defects used to make that override unreachable in practice:
//
// 1. every static factory (from/alloc/allocUnsafe/concat) returned a plain
//    `new Uint8Array(...)` instead of an instance of this subclass, so the
//    override on the prototype was simply never present on the object callers
//    actually held -- e.g. `Buffer.from('tree 0\0').constructor.name` was
//    literally "Uint8Array".
// 2. even a genuine Buf instance loses the subclass across
//    TypedArray.prototype.slice()/subarray() (both engine-spec'd to return
//    the base species unless the subclass overrides them), so
//    `buf.slice(a,b).toString('utf8')` reverted to the same broken default
//    the moment any slicing happened -- which is exactly the call shape
//    at.unwrap uses to split a decompressed object into its header/body.
//
// Concretely this made isomorphic-git misparse the well-known empty-tree
// sentinel object (the literal buffer "tree 0\0"): unwrap's
// `t.slice(r+1,n).toString('utf8')` on the single length-digit byte 0x30
// ('0') returned the STRING "48" (its decimal char code) instead of "0",
// because that slice's toString saw only the numeric Uint8Array fallback --
// parseInt("48") !== the real 0-byte content length, throwing "Length
// mismatch: expected 48 bytes but got 0 instead." on literally every git
// status/log/diff call in a fresh or HEAD-less repo (any op that falls back
// to the empty tree). Every construction path below now explicitly wraps
// its result in `new Buf(...)` (never a bare `new Uint8Array(...)`), and
// slice/subarray are overridden to do the same, so every Buffer-shaped value
// in this module keeps its real toString('utf8') no matter how it was
// produced or re-sliced.
const Buf = globalThis.Buffer || class Buf extends Uint8Array {
  static from(d, enc) {
    if (typeof d === 'string') {
      // 'hex' must decode the string's hex DIGITS into the bytes they
      // represent, not UTF8-encode the string's own characters -- e.g.
      // isomorphic-git's GitIndex.toObject() does exactly
      // `Buffer.from(sha1HexString, "hex")` to turn a 40-char hex checksum
      // into the 20 raw bytes appended to the index file. Falling through
      // to the utf8 branch below silently produced a 40-BYTE buffer of the
      // hex string's own ASCII characters instead of a 20-byte binary
      // checksum, so every index write's trailing checksum was wrong length
      // AND wrong content -- the next read's checksum verification then
      // failed with "Invalid checksum in GitIndex buffer" on literally the
      // first `git add` after the magic-number/toString-range fixes above.
      if (enc === 'hex') return new Buf(Uint8Array.from(d.match(/.{1,2}/g) || [], h => parseInt(h, 16)));
      if (enc === 'base64') return new Buf(Uint8Array.from(atob(d), c => c.charCodeAt(0)));
      return new Buf(new TextEncoder().encode(d).buffer);
    }
    if (d instanceof ArrayBuffer) return new Buf(d);
    if (Array.isArray(d)) return new Buf(d);
    if (d instanceof Uint8Array) return new Buf(d.buffer, d.byteOffset, d.length);
    return new Buf(d);
  }
  static alloc(n, fill) { const b = new Buf(n); if (fill != null) b.fill(typeof fill === 'string' ? fill.charCodeAt(0) : fill); return b; }
  static allocUnsafe(n) { return new Buf(n); }
  static isBuffer(o) { return o instanceof Uint8Array; }
  static concat(arr) { let n = 0; for (const a of arr) n += a.length; const r = new Buf(n); let o = 0; for (const a of arr) { r.set(a, o); o += a.length; } return r; }
  // TypedArray.prototype.slice/subarray return the base Uint8Array species
  // unless explicitly overridden -- without these, every sliced view drops
  // back to the broken default toString the moment it's re-sliced (see the
  // block comment above for why that's the actual crash trigger).
  slice(...args) { return new Buf(Uint8Array.prototype.slice.apply(this, args).buffer); }
  subarray(...args) { const v = Uint8Array.prototype.subarray.apply(this, args); return new Buf(v.buffer, v.byteOffset, v.length); }
  // Real Buffer.prototype.toString(encoding, start, end) takes an optional
  // byte range -- isomorphic-git's own BufferCursor wrapper (`ve` in the
  // vendored bundle) relies on exactly that 3-arg form for every bounded
  // read (`this.buffer.toString(t, this._start, this._start+r)`), most
  // critically GitIndex.fromBuffer's very first check, `n.toString("utf8",
  // 4)` == "DIRC" (read 4 bytes starting at offset 0) to validate the index
  // file's magic header before parsing the rest of it as binary. A 1-arg
  // toString silently ignoring start/end decoded the ENTIRE buffer instead
  // of the first 4 bytes, so the magic-number check compared "DIRC" against
  // the whole (partly-binary-garbage-as-utf8) index content and always
  // failed with "Invalid dircache magic file number: <mangled everything>"
  // -- on literally every read of an index that `git add` itself had just
  // written correctly seconds earlier in the very same call.
  toString(enc, start = 0, end = this.length) {
    const view = start === 0 && end === this.length ? this : this.subarray(start, end);
    if (enc === 'base64') return btoa(String.fromCharCode(...view));
    if (enc === 'hex') return Array.from(view, b => b.toString(16).padStart(2, '0')).join('');
    return new TextDecoder().decode(view);
  }
  // Real Buffer.prototype.write(string, offset, length, encoding) -- called
  // directly (isomorphic-git's own BufferCursor wrapper class in the
  // vendored bundle, `ve`, does `this.buffer.write(t, this._start, r, n)`
  // for every fixed-width git-index entry field it serializes: oid as hex,
  // path as utf8, etc.) -- so a Buffer-shaped value with no .write() at all
  // made every `git add`/index-write throw "this.buffer.write is not a
  // function" the moment isomorphic-git tried to persist the staged index,
  // even though status/log/commit (which never touch the index writer)
  // worked fine. offset/length here follow Node's real signature: any
  // omitted between the string and the encoding is filled from defaults,
  // not treated positionally as the encoding itself.
  write(string, offset = 0, length, encoding) {
    if (typeof offset !== 'number') { encoding = offset; offset = 0; length = undefined; }
    else if (typeof length !== 'number') { encoding = length; length = undefined; }
    const bytes = encoding === 'hex'
      ? Uint8Array.from(string.match(/.{1,2}/g) || [], h => parseInt(h, 16))
      : new TextEncoder().encode(string);
    const n = length != null ? Math.min(length, bytes.length) : bytes.length;
    this.set(bytes.subarray(0, n), offset);
    return n;
  }
  // Fixed-width integer accessors -- isomorphic-git's own BufferCursor
  // wrapper class (`ve` in the vendored bundle) delegates every one of
  // these directly onto the underlying Buffer (`this.buffer.readUInt32BE(
  // this._start)` etc.) when serializing/parsing the binary git index
  // (ctime/mtime/dev/ino/mode/uid/gid/size/flags fields, each a fixed-width
  // BE integer per the real git index format) -- entirely missing from this
  // polyfill until now, so any index read/write beyond the object-header
  // string parsing (fixed above) still threw "this.buffer.readUInt32BE is
  // not a function" the moment `git add`/`git commit` touched the index.
  #dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
  readUInt8(o) { return this.#dv().getUint8(o); }
  writeUInt8(v, o) { this.#dv().setUint8(o, v); return o + 1; }
  readUInt16BE(o) { return this.#dv().getUint16(o, false); }
  writeUInt16BE(v, o) { this.#dv().setUint16(o, v, false); return o + 2; }
  readUInt32BE(o) { return this.#dv().getUint32(o, false); }
  writeUInt32BE(v, o) { this.#dv().setUint32(o, v, false); return o + 4; }
  readInt32BE(o) { return this.#dv().getInt32(o, false); }
  writeInt32BE(v, o) { this.#dv().setInt32(o, v, false); return o + 4; }
  copy(target, targetStart = 0, start = 0, end = this.length) {
    const src = this.subarray(start, end);
    target.set(src, targetStart);
    return src.length;
  }
};
export const Buffer = Buf;
export default { Buffer: Buf };
