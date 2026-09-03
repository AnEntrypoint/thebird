// Browser polyfills so the upstream busybase code can run unmodified in a tab.
// - globalThis.Bun.password.{hash,verify} via WebCrypto PBKDF2-SHA256
// - node:events EventEmitter (minimal)
// - node:fs mkdirSync (no-op; plugkit backend doesn't touch disk)

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}
function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function pbkdf2(password, salt, iters = 100_000) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
    return new Uint8Array(bits);
}

// Format: $bb1$<iters>$<saltB64>$<hashB64>
async function bunPasswordHash(password, _opts) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iters = 100_000;
    const hash = await pbkdf2(String(password), salt, iters);
    return '$bb1$' + iters + '$' + b64(salt) + '$' + b64(hash);
}

async function bunPasswordVerify(password, stored) {
    if (typeof stored !== 'string' || !stored.startsWith('$bb1$')) return false;
    const parts = stored.split('$'); // ["", "bb1", "<iters>", "<saltB64>", "<hashB64>"]
    if (parts.length !== 5) return false;
    const iters = parseInt(parts[2], 10);
    const salt = unb64(parts[3]);
    const expected = unb64(parts[4]);
    const got = await pbkdf2(String(password), salt, iters);
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
    return diff === 0;
}

if (typeof globalThis.Bun === 'undefined') {
    globalThis.Bun = {
        password: {
            hash: bunPasswordHash,
            verify: bunPasswordVerify,
        },
    };
} else if (!globalThis.Bun.password) {
    globalThis.Bun.password = { hash: bunPasswordHash, verify: bunPasswordVerify };
}

export const Bun = globalThis.Bun;
