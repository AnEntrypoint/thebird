const _crypto = globalThis.crypto;
function randomBytes(n) { const b = new Uint8Array(n); _crypto.getRandomValues(b); return b; }
function randomUUID() { return _crypto.randomUUID(); }
async function createHash(alg) {
  const a = alg.toUpperCase().replace(/^SHA/, 'SHA-');
  let chunks = [];
  return {
    update(d) { chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : d); return this; },
    digest: async (enc) => {
      const total = new Uint8Array(chunks.reduce((s,c)=>s+c.length,0));
      let o=0; for (const c of chunks) { total.set(c,o); o+=c.length; }
      const buf = await _crypto.subtle.digest(a, total);
      const arr = new Uint8Array(buf);
      if (enc === 'hex') return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
      return arr;
    },
  };
}
const _mod = { randomBytes, randomUUID, createHash, webcrypto: _crypto };
export default _mod;
export { randomBytes, randomUUID, createHash };
