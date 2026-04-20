const K256 = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotr32 = (x, n) => (x >>> n) | (x << (32 - n));

function padMsg(msg, blockSize, lenBytes, little = false) {
  const bitLen = msg.length * 8;
  const padLen = ((msg.length + lenBytes + 1 + blockSize - 1) & ~(blockSize - 1));
  const p = new Uint8Array(padLen); p.set(msg); p[msg.length] = 0x80;
  const v = new DataView(p.buffer);
  if (little) { v.setUint32(padLen - 8, bitLen >>> 0, true); v.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true); }
  else { v.setUint32(padLen - 4, bitLen >>> 0); v.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000)); }
  return p;
}

export function sha1(msg) {
  const p = padMsg(msg, 64, 8); const v = new DataView(p.buffer);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const W = new Uint32Array(80);
  for (let i = 0; i < p.length; i += 64) {
    for (let j = 0; j < 16; j++) W[j] = v.getUint32(i + j * 4);
    for (let j = 16; j < 80; j++) W[j] = rotr32(W[j - 3] ^ W[j - 8] ^ W[j - 14] ^ W[j - 16], 31);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      const f = j < 20 ? (b & c) | (~b & d) : j < 40 ? b ^ c ^ d : j < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rotr32(a, 27) + f + e + k + W[j]) >>> 0;
      e = d; d = c; c = rotr32(b, 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20); const ov = new DataView(out.buffer);
  ov.setUint32(0, h0); ov.setUint32(4, h1); ov.setUint32(8, h2); ov.setUint32(12, h3); ov.setUint32(16, h4);
  return out;
}

export function sha256(msg) {
  const p = padMsg(msg, 64, 8); const v = new DataView(p.buffer);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let i = 0; i < p.length; i += 64) {
    for (let j = 0; j < 16; j++) W[j] = v.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) { const s0 = rotr32(W[j-15], 7) ^ rotr32(W[j-15], 18) ^ (W[j-15] >>> 3); const s1 = rotr32(W[j-2], 17) ^ rotr32(W[j-2], 19) ^ (W[j-2] >>> 10); W[j] = (W[j-16] + s0 + W[j-7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) { const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K256[j] + W[j]) >>> 0; const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, H[i]);
  return out;
}

export function md5(msg) {
  const p = padMsg(msg, 64, 8, true); const v = new DataView(p.buffer);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Uint32Array([0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391]);
  for (let i = 0; i < p.length; i += 64) {
    const M = new Uint32Array(16); for (let j = 0; j < 16; j++) M[j] = v.getUint32(i + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) { let F, g; if (j < 16) { F = (B & C) | (~B & D); g = j; } else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; } else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * j) % 16; }
      F = (F + A + K[j] + M[g]) >>> 0; A = D; D = C; C = B; B = (B + (((F << s[j]) | (F >>> (32 - s[j]))) >>> 0)) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16); const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}

const K512 = [0x428a2f98d728ae22n,0x7137449123ef65cdn,0xb5c0fbcfec4d3b2fn,0xe9b5dba58189dbbcn,0x3956c25bf348b538n,0x59f111f1b605d019n,0x923f82a4af194f9bn,0xab1c5ed5da6d8118n,0xd807aa98a3030242n,0x12835b0145706fben,0x243185be4ee4b28cn,0x550c7dc3d5ffb4e2n,0x72be5d74f27b896fn,0x80deb1fe3b1696b1n,0x9bdc06a725c71235n,0xc19bf174cf692694n,0xe49b69c19ef14ad2n,0xefbe4786384f25e3n,0x0fc19dc68b8cd5b5n,0x240ca1cc77ac9c65n,0x2de92c6f592b0275n,0x4a7484aa6ea6e483n,0x5cb0a9dcbd41fbd4n,0x76f988da831153b5n,0x983e5152ee66dfabn,0xa831c66d2db43210n,0xb00327c898fb213fn,0xbf597fc7beef0ee4n,0xc6e00bf33da88fc2n,0xd5a79147930aa725n,0x06ca6351e003826fn,0x142929670a0e6e70n,0x27b70a8546d22ffcn,0x2e1b21385c26c926n,0x4d2c6dfc5ac42aedn,0x53380d139d95b3dfn,0x650a73548baf63den,0x766a0abb3c77b2a8n,0x81c2c92e47edaee6n,0x92722c851482353bn,0xa2bfe8a14cf10364n,0xa81a664bbc423001n,0xc24b8b70d0f89791n,0xc76c51a30654be30n,0xd192e819d6ef5218n,0xd69906245565a910n,0xf40e35855771202an,0x106aa07032bbd1b8n,0x19a4c116b8d2d0c8n,0x1e376c085141ab53n,0x2748774cdf8eeb99n,0x34b0bcb5e19b48a8n,0x391c0cb3c5c95a63n,0x4ed8aa4ae3418acbn,0x5b9cca4f7763e373n,0x682e6ff3d6b2b8a3n,0x748f82ee5defb2fcn,0x78a5636f43172f60n,0x84c87814a1f0ab72n,0x8cc702081a6439ecn,0x90befffa23631e28n,0xa4506cebde82bde9n,0xbef9a3f7b2c67915n,0xc67178f2e372532bn,0xca273eceea26619cn,0xd186b8c721c0c207n,0xeada7dd6cde0eb1en,0xf57d4f7fee6ed178n,0x06f067aa72176fban,0x0a637dc5a2c898a6n,0x113f9804bef90daen,0x1b710b35131c471bn,0x28db77f523047d84n,0x32caab7b40c72493n,0x3c9ebe0a15c9bebcn,0x431d67c49c100d4cn,0x4cc5d4becb3e42b6n,0x597f299cfc657e2an,0x5fcb6fab3ad6faecn,0x6c44198c4a475817n];
const MASK64 = 0xffffffffffffffffn;
const rotr64 = (x, n) => (((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64);

export function sha512(msg) {
  const p = padMsg(msg, 128, 16); const v = new DataView(p.buffer);
  const H = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
  const W = new Array(80);
  for (let i = 0; i < p.length; i += 128) {
    for (let j = 0; j < 16; j++) W[j] = (BigInt(v.getUint32(i + j * 8)) << 32n) | BigInt(v.getUint32(i + j * 8 + 4));
    for (let j = 16; j < 80; j++) { const s0 = rotr64(W[j-15], 1) ^ rotr64(W[j-15], 8) ^ (W[j-15] >> 7n); const s1 = rotr64(W[j-2], 19) ^ rotr64(W[j-2], 61) ^ (W[j-2] >> 6n); W[j] = (W[j-16] + s0 + W[j-7] + s1) & MASK64; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 80; j++) { const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41); const ch = (e & f) ^ (~e & MASK64 & g); const t1 = (h + S1 + ch + K512[j] + W[j]) & MASK64; const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) & MASK64; h = g; g = f; f = e; e = (d + t1) & MASK64; d = c; c = b; b = a; a = (t1 + t2) & MASK64; }
    H[0] = (H[0] + a) & MASK64; H[1] = (H[1] + b) & MASK64; H[2] = (H[2] + c) & MASK64; H[3] = (H[3] + d) & MASK64; H[4] = (H[4] + e) & MASK64; H[5] = (H[5] + f) & MASK64; H[6] = (H[6] + g) & MASK64; H[7] = (H[7] + h) & MASK64;
  }
  const out = new Uint8Array(64); const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) { ov.setUint32(i * 8, Number(H[i] >> 32n)); ov.setUint32(i * 8 + 4, Number(H[i] & 0xffffffffn)); }
  return out;
}

function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
function toBytes(d) { return typeof d === 'string' ? new TextEncoder().encode(d) : d; }

const HASH_IMPLS = { sha1: { fn: sha1, size: 64, len: 20 }, sha256: { fn: sha256, size: 64, len: 32 }, sha512: { fn: sha512, size: 128, len: 64 }, md5: { fn: md5, size: 64, len: 16 } };

export function createHash(alg) {
  const a = alg.toLowerCase();
  const spec = HASH_IMPLS[a];
  if (!spec) throw new Error('hash algorithm not supported: ' + a);
  const chunks = [];
  return {
    update(data) { chunks.push(toBytes(data)); return this; },
    digest(enc) { const total = chunks.reduce((s, c) => s + c.length, 0); const buf = new Uint8Array(total); let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; } const out = spec.fn(buf); if (enc === 'hex') return [...out].map(b => b.toString(16).padStart(2, '0')).join(''); if (enc === 'base64') return btoa(String.fromCharCode(...out)); return out; },
  };
}

export function createHmac(alg, key) {
  const spec = HASH_IMPLS[alg.toLowerCase()];
  if (!spec) throw new Error('hmac algorithm not supported: ' + alg);
  let k = toBytes(key);
  if (k.length > spec.size) k = spec.fn(k);
  if (k.length < spec.size) { const pad = new Uint8Array(spec.size); pad.set(k); k = pad; }
  const ipad = new Uint8Array(spec.size), opad = new Uint8Array(spec.size);
  for (let i = 0; i < spec.size; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  const chunks = [];
  return {
    update(data) { chunks.push(toBytes(data)); return this; },
    digest(enc) { const total = chunks.reduce((s, c) => s + c.length, 0); const buf = new Uint8Array(total); let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; } const inner = spec.fn(concat(ipad, buf)); const out = spec.fn(concat(opad, inner)); if (enc === 'hex') return [...out].map(b => b.toString(16).padStart(2, '0')).join(''); if (enc === 'base64') return btoa(String.fromCharCode(...out)); return out; },
  };
}

export function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  const spec = HASH_IMPLS[digest.toLowerCase()];
  if (!spec) throw new Error('pbkdf2 digest not supported: ' + digest);
  const hLen = spec.len;
  const saltB = toBytes(salt);
  const blocks = Math.ceil(keylen / hLen);
  const out = new Uint8Array(blocks * hLen);
  for (let i = 1; i <= blocks; i++) {
    const block = new Uint8Array(saltB.length + 4); block.set(saltB); const dv = new DataView(block.buffer); dv.setUint32(saltB.length, i);
    let U = createHmac(digest, password).update(block).digest();
    let T = new Uint8Array(U);
    for (let j = 1; j < iterations; j++) { U = createHmac(digest, password).update(U).digest(); for (let k = 0; k < hLen; k++) T[k] ^= U[k]; }
    out.set(T, (i - 1) * hLen);
  }
  return out.slice(0, keylen);
}

export function randomBytes(n) { const out = new Uint8Array(n); (globalThis.crypto || { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256 | 0; return a; } }).getRandomValues(out); return out; }
