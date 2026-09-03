// Browser shim for node:stream. Minimal enough to satisfy module-load.
import { EventEmitter } from './events.mjs';
export class Readable extends EventEmitter {
    constructor(opts) { super(); this._opts = opts || {}; }
    pipe(dest) { this.on('data', d => dest.write(d)); this.on('end', () => dest.end()); return dest; }
    push() { return false; }
    read() { return null; }
}
export class Writable extends EventEmitter {
    constructor(opts) { super(); this._opts = opts || {}; }
    write(_chunk, _enc, cb) { if (cb) queueMicrotask(cb); return true; }
    end(_chunk, _enc, cb) { if (cb) queueMicrotask(cb); this.emit('finish'); }
}
export class Duplex extends Readable {}
export class Transform extends Duplex {
    _transform(chunk, enc, cb) { cb(null, chunk); }
}
export class PassThrough extends Transform {}
export function pipeline(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    queueMicrotask(() => cb && cb(null));
}
export function finished(_s, cb) { queueMicrotask(() => cb && cb(null)); }
const _stream = { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
export default _stream;
