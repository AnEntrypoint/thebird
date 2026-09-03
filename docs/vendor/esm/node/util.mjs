// Browser shim for node:util.
export function promisify(fn) {
    return function (...args) {
        return new Promise((resolve, reject) => {
            fn(...args, (err, v) => err ? reject(err) : resolve(v));
        });
    };
}
export function inspect(o, _opts) {
    try { return JSON.stringify(o, null, 2); } catch { return String(o); }
}
export class TextEncoder extends globalThis.TextEncoder {}
export class TextDecoder extends globalThis.TextDecoder {}
export const types = {
    isPromise: v => v && typeof v.then === 'function',
    isArrayBuffer: v => v instanceof ArrayBuffer,
    isUint8Array: v => v instanceof Uint8Array,
};
const _util = { promisify, inspect, TextEncoder, TextDecoder, types };
export default _util;
