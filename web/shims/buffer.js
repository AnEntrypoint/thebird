const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');

function bytesOf(value, encoding) {
  if (typeof value === 'string') {
    if (encoding === 'hex') return Uint8Array.from(value.match(/../g) ?? [], (h) => parseInt(h, 16));
    if (encoding === 'base64') return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') return Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff);
    return utf8Encoder.encode(value);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

export class Buffer extends Uint8Array {
  static from(value, encodingOrOffset, length) {
    const bytes = bytesOf(value, typeof encodingOrOffset === 'string' ? encodingOrOffset : undefined);
    return new Buffer(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  }

  static alloc(size, fill = 0) {
    const out = new Buffer(size);
    out.fill(fill);
    return out;
  }

  static allocUnsafe(size) {
    return Buffer.alloc(size);
  }

  static concat(list, total) {
    const size = total ?? list.reduce((sum, item) => sum + item.byteLength, 0);
    const out = new Buffer(size);
    let offset = 0;
    for (const item of list) {
      out.set(item.subarray(0, Math.min(item.byteLength, size - offset)), offset);
      offset += item.byteLength;
    }
    return out;
  }

  static byteLength(value, encoding) {
    return bytesOf(value, encoding).byteLength;
  }

  static isBuffer(value) {
    return value instanceof Buffer;
  }

  toString(encoding = 'utf8', start = 0, end = this.length) {
    const view = this.subarray(start, end);
    if (encoding === 'hex') return Array.from(view, (b) => b.toString(16).padStart(2, '0')).join('');
    if (encoding === 'base64') return btoa(String.fromCharCode(...view));
    if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') return String.fromCharCode(...view);
    return utf8Decoder.decode(view);
  }

  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const slice = this.subarray(sourceStart, sourceEnd);
    target.set(slice.subarray(0, Math.max(0, target.length - targetStart)), targetStart);
    return slice.length;
  }

  readUInt32LE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset).getUint32(offset, true);
  }

  writeUInt32LE(value, offset = 0) {
    new DataView(this.buffer, this.byteOffset).setUint32(offset, value >>> 0, true);
    return offset + 4;
  }

  readDoubleLE(offset = 0) {
    return new DataView(this.buffer, this.byteOffset).getFloat64(offset, true);
  }

  writeDoubleLE(value, offset = 0) {
    new DataView(this.buffer, this.byteOffset).setFloat64(offset, value, true);
    return offset + 8;
  }

  equals(other) {
    return this.length === other.length && this.every((b, i) => b === other[i]);
  }
}
