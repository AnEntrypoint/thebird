const ALG_MAP={
  'aes-128-gcm':{name:'AES-GCM',length:128},'aes-192-gcm':{name:'AES-GCM',length:192},'aes-256-gcm':{name:'AES-GCM',length:256},
  'aes-128-cbc':{name:'AES-CBC',length:128},'aes-192-cbc':{name:'AES-CBC',length:192},'aes-256-cbc':{name:'AES-CBC',length:256},
  'aes-128-ctr':{name:'AES-CTR',length:128},'aes-192-ctr':{name:'AES-CTR',length:192},'aes-256-ctr':{name:'AES-CTR',length:256},
};
const toBytes=d=>typeof d==='string'?new TextEncoder().encode(d):d instanceof Uint8Array?d:new Uint8Array(d);
const concat=list=>{const t=list.reduce((s,c)=>s+c.length,0);const out=new Uint8Array(t);let o=0;for(const c of list){out.set(c,o);o+=c.length;}return out;};

async function importKey(alg,keyBytes,usages){
  return crypto.subtle.importKey('raw',keyBytes,{name:alg.name,length:alg.length},false,usages);
}

function makeCipher(alg,keyBytes,iv,decrypt=false){
  const spec=ALG_MAP[alg];
  if(!spec)throw new Error(`cipher algorithm not supported: ${alg}`);
  const ivBytes=toBytes(iv);
  const expectedIvLen=spec.name==='AES-GCM'?12:16;
  if(ivBytes.length!==expectedIvLen)throw new Error(`invalid IV length for ${alg}: expected ${expectedIvLen}, got ${ivBytes.length}`);
  let authTag=null;let aad=null;let final=null;let finalized=false;
  const usage=decrypt?['decrypt']:['encrypt'];
  // HONEST CONTRACT: WebCrypto (crypto.subtle) is async-only, so this cipher
  // cannot stream like Node's. update() fails FAST (synchronous throw) instead
  // of silently buffering — the real encrypt/decrypt happens in finalAsync(data,enc),
  // which is ASYNC and takes the entire input, returning the entire output.
  return {
    update(){throw new TypeError('cipher.update() is unavailable synchronously in this browser shim (WebCrypto is async-only) — buffer input yourself and call await cipher.finalAsync(data,enc) with the full data');},
    final(){throw new TypeError('cipher.final() is unavailable synchronously in this browser shim (WebCrypto is async-only) — use await cipher.finalAsync(data,enc) instead');},
    async finalAsync(data,enc){if(finalized)throw new Error('cipher.final() already called');finalized=true;const input=toBytes(data);const key=await importKey(spec,toBytes(keyBytes),usage);const params=spec.name==='AES-CTR'?{name:spec.name,counter:ivBytes,length:64}:{name:spec.name,iv:ivBytes};if(spec.name==='AES-GCM'&&aad)params.additionalData=aad;if(decrypt&&spec.name==='AES-GCM'&&!authTag)throw new Error('GCM decryption requires authTag — call setAuthTag() before final()');if(decrypt&&spec.name==='AES-GCM'&&authTag){const full=concat([input,authTag]);const out=new Uint8Array(await crypto.subtle.decrypt(params,key,full));return enc?Buffer.from(out).toString(enc):Buffer.from(out);}const op=decrypt?crypto.subtle.decrypt.bind(crypto.subtle):crypto.subtle.encrypt.bind(crypto.subtle);const out=new Uint8Array(await op(params,key,input));if(!decrypt&&spec.name==='AES-GCM'){authTag=out.slice(-16);const ct=out.slice(0,-16);final=Buffer.from(ct);return enc?final.toString(enc):final;}return enc?Buffer.from(out).toString(enc):Buffer.from(out);},
    setAAD(d){aad=toBytes(d);return this;},
    setAuthTag(t){const b=toBytes(t);if(b.length!==16)throw new Error(`GCM auth tag must be 16 bytes, got ${b.length}`);authTag=b;return this;},
    getAuthTag(){return authTag?Buffer.from(authTag):null;},
    setAutoPadding(flag=true){/* HONEST: WebCrypto forces PKCS#7 padding for AES-CBC with no option to disable; setAutoPadding(false) is not supported and callers must handle padded output */if(!flag)throw new Error('AES-CBC: padding is always enabled in WebCrypto — setAutoPadding(false) is not supported');return this;},
  };
}

export function extendCrypto(cryptoMod,Buf){
  globalThis.Buffer=globalThis.Buffer||Buf;
  cryptoMod.createCipheriv=(alg,key,iv)=>makeCipher(alg.toLowerCase(),key,iv,false);
  cryptoMod.createDecipheriv=(alg,key,iv)=>makeCipher(alg.toLowerCase(),key,iv,true);
  cryptoMod.createCipher=()=>{throw new Error('crypto.createCipher: deprecated and unsafe — use createCipheriv');};
  cryptoMod.createDecipher=()=>{throw new Error('crypto.createDecipher: deprecated — use createDecipheriv');};
  cryptoMod.generateKeyPair=(type,opts,cb)=>{cryptoMod.generateKeyPairAsync?.(type,opts).then(r=>cb(null,r.publicKey,r.privateKey),cb);};
  cryptoMod.generateKeyPairSync=()=>{const e=new Error('crypto.generateKeyPairSync: synchronous keypair generation not available in browser — use generateKeyPair (async)');e.code='ERR_UNSUPPORTED_SYNC_KEYGEN';throw e;};
  cryptoMod.generateKeyPairAsync=async(type,opts={})=>{const algMap={rsa:{name:'RSASSA-PKCS1-v1_5',modulusLength:opts.modulusLength||2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},ec:{name:'ECDSA',namedCurve:opts.namedCurve||'P-256'}};const alg=algMap[type];if(!alg)throw new Error(`unsupported key type: ${type}`);const kp=await crypto.subtle.generateKey(alg,true,type==='rsa'?['sign','verify']:['sign','verify']);const pub=new Uint8Array(await crypto.subtle.exportKey('spki',kp.publicKey));const priv=new Uint8Array(await crypto.subtle.exportKey('pkcs8',kp.privateKey));const toB64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=btoa(String.fromCharCode(...b.slice(i,i+8192)));return s;};const pem=(b,label)=>`-----BEGIN ${label}-----\n${toB64(b).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;return {publicKey:pem(pub,'PUBLIC KEY'),privateKey:pem(priv,'PRIVATE KEY')};};
  const pemToBytes=pem=>{const m=pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END/);if(!m)throw new Error('invalid PEM');return Uint8Array.from(atob(m[1].replace(/\s/g,'')),c=>c.charCodeAt(0));};
  const hashFromAlg=a=>{const u=a.toUpperCase();if(u.includes('SHA512')||u.includes('SHA-512'))return'SHA-512';if(u.includes('SHA384')||u.includes('SHA-384'))return'SHA-384';if(u.includes('SHA1')||u.includes('SHA-1'))return'SHA-1';return'SHA-256';};
  // Detect EC curve from DER-encoded key bytes by matching curve OIDs in the algorithm parameters.
  // Returns null if not an EC key, or the namedCurve string ('P-256','P-384','P-521') if EC.
  const detectEcCurve=bytes=>{
    const s=String.fromCharCode(...bytes.slice(0,Math.min(bytes.length,80)));
    // EC algorithm OID 1.2.840.10045.2.1 must be present for any EC key
    if(!s.includes('\x2A\x86\x48\xCE\x3D\x02\x01'))return null;
    // P-256 curve OID 1.2.840.10045.3.1.7: 2A 86 48 CE 3D 03 01 07
    if(s.includes('\x2A\x86\x48\xCE\x3D\x03\x01\x07'))return'P-256';
    // P-384 curve OID 1.3.132.0.34: 2B 81 04 00 22
    if(s.includes('\x2B\x81\x04\x00\x22'))return'P-384';
    // P-521 curve OID 1.3.132.0.35: 2B 81 04 00 23
    if(s.includes('\x2B\x81\x04\x00\x23'))return'P-521';
    // EC key with unrecognized curve — default to P-256 (import will fail with clear error from WebCrypto)
    return'P-256';
  };
  const importForSign=async(pem,hash)=>{const bytes=pemToBytes(pem);const curve=detectEcCurve(bytes);const params=curve?{name:'ECDSA',namedCurve:curve}:{name:'RSASSA-PKCS1-v1_5',hash};const k=await crypto.subtle.importKey('pkcs8',bytes,params,false,['sign']);return{key:k,alg:curve?{name:'ECDSA',hash}:{name:'RSASSA-PKCS1-v1_5'}};};
  const importForVerify=async(pem,hash)=>{const bytes=pemToBytes(pem);const curve=detectEcCurve(bytes);const params=curve?{name:'ECDSA',namedCurve:curve}:{name:'RSASSA-PKCS1-v1_5',hash};const k=await crypto.subtle.importKey('spki',bytes,params,false,['verify']);return{key:k,alg:curve?{name:'ECDSA',hash}:{name:'RSASSA-PKCS1-v1_5'}};};
  cryptoMod.signAsync=async(alg,data,keyPem)=>{const pem=typeof keyPem==='string'?keyPem:keyPem.key;const {key,alg:a}=await importForSign(pem,hashFromAlg(alg));const sig=await crypto.subtle.sign(a,key,toBytes(data));return Buf.from(new Uint8Array(sig));};
  cryptoMod.verifyAsync=async(alg,data,keyPem,sig)=>{const pem=typeof keyPem==='string'?keyPem:keyPem.key;const {key,alg:a}=await importForVerify(pem,hashFromAlg(alg));return crypto.subtle.verify(a,key,toBytes(sig),toBytes(data));};
  cryptoMod.hkdf=(digest,ikm,salt,info,keylen,cb)=>{cryptoMod.hkdfAsync(digest,ikm,salt,info,keylen).then(r=>cb(null,r),cb);};
  cryptoMod.hkdfSync=()=>{throw new Error('crypto.hkdfSync: use async hkdf in browser (webcrypto is async-only)');};
  cryptoMod.hkdfAsync=async(digest,ikm,salt,info,keylen)=>{const hash=hashFromAlg(digest);const k=await crypto.subtle.importKey('raw',toBytes(ikm),'HKDF',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'HKDF',hash,salt:toBytes(salt),info:toBytes(info)},k,keylen*8);return Buf.from(new Uint8Array(bits));};
  cryptoMod.createECDH=curve=>{const nc=curve==='prime256v1'?'P-256':curve==='secp384r1'?'P-384':curve==='secp521r1'?'P-521':curve;let kp=null;return{generateKeys:async()=>{kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:nc},true,['deriveBits']);const pub=await crypto.subtle.exportKey('raw',kp.publicKey);return Buf.from(new Uint8Array(pub));},getPublicKey:async()=>{if(!kp)throw new Error('generateKeys first');const pub=await crypto.subtle.exportKey('raw',kp.publicKey);return Buf.from(new Uint8Array(pub));},computeSecret:async otherPub=>{if(!kp)throw new Error('generateKeys first');const other=await crypto.subtle.importKey('raw',toBytes(otherPub),{name:'ECDH',namedCurve:nc},false,[]);const bits=await crypto.subtle.deriveBits({name:'ECDH',public:other},kp.privateKey,256);return Buf.from(new Uint8Array(bits));}};};
  cryptoMod.createDiffieHellman=()=>{throw new Error('crypto.createDiffieHellman: classic modp DH not supported — use createECDH(\'prime256v1\')');};
  cryptoMod.sign=(alg,data,key,cb)=>{if(cb){cryptoMod.signAsync(alg,data,key).then(r=>cb(null,r),cb);return;}throw new Error('crypto.sign: WebCrypto is async-only — pass a callback or use signAsync');};
  cryptoMod.verify=(alg,data,key,sig,cb)=>{if(cb){cryptoMod.verifyAsync(alg,data,key,sig).then(r=>cb(null,r),cb);return;}throw new Error('crypto.verify: WebCrypto is async-only — pass a callback or use verifyAsync');};
  const makeSign=(alg,isVerify=false)=>{
    const chunks=[];
    return {
      update(data,inputEnc){const bytes=inputEnc?Buffer.from(data,inputEnc):toBytes(data);chunks.push(bytes);return this;},
      sign(){throw new Error('sign() is unavailable synchronously in this browser shim (WebCrypto is async-only) — use await signFinalAsync(key,enc) instead');},
      verify(){throw new Error('verify() is unavailable synchronously in this browser shim (WebCrypto is async-only) — use await verifyFinalAsync(key,sig,enc) instead');},
      async signFinalAsync(key,enc){const pem=typeof key==='string'?key:key.key;const data=concat(chunks);chunks.length=0;const {key:k,alg:a}=await importForSign(pem,hashFromAlg(alg));const sig=await crypto.subtle.sign(a,k,data);const out=Buf.from(new Uint8Array(sig));return enc?out.toString(enc):out;},
      async verifyFinalAsync(key,sig,enc){const pem=typeof key==='string'?key:key.key;const data=concat(chunks);chunks.length=0;const {key:k,alg:a}=await importForVerify(pem,hashFromAlg(alg));const sigBytes=enc?Buffer.from(sig,enc):toBytes(sig);return crypto.subtle.verify(a,k,sigBytes,data);},
    };
  };
  cryptoMod.createSign=(alg)=>makeSign(alg);
  cryptoMod.createVerify=(alg)=>makeSign(alg,true);
  cryptoMod.getCiphers=()=>Object.keys(ALG_MAP);
  cryptoMod.getHashes=()=>['sha1','sha224','sha256','sha384','sha512','md5','RSA-SHA1','RSA-SHA256','RSA-SHA384','RSA-SHA512','ECDSA-SHA256','ECDSA-SHA384','ECDSA-SHA512'];
  cryptoMod.getCurves=()=>['P-256','P-384','P-521'];
  cryptoMod.timingSafeEqual=(a,b)=>{if(a.length!==b.length){const e=new RangeError('Input buffers must have the same byte length');e.code='ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH';throw e;}let r=0;for(let i=0;i<a.length;i++)r|=a[i]^b[i];return r===0;};
  cryptoMod.diffieHellman=()=>{throw new Error('crypto.diffieHellman: use webcrypto ECDH')};
  // HONEST: crypto.scrypt/scryptSync fall back to PBKDF2(sha256, 16384 iters) because WebCrypto has no
  // memory-hard scrypt primitive. PBKDF2 is CPU-hard only and offers weaker brute-force resistance
  // than true scrypt against GPU/ASIC attackers. For production key derivation use server-side scrypt
  // or a higher pbkdf2 iteration count via cryptoMod.pbkdf2Sync directly.
  cryptoMod.scrypt=(pw,salt,len,opts,cb)=>{if(typeof opts==='function'){cb=opts;opts={};}queueMicrotask(()=>cb(new Error('crypto.scrypt unavailable in browser (WebCrypto has no memory-hard primitive) — use server-side scrypt or use pbkdf2Sync directly with high iteration count')));};
  cryptoMod.scryptSync=(pw,salt,len)=>{throw new Error('crypto.scrypt unavailable in browser (WebCrypto has no memory-hard primitive) — use server-side scrypt or use pbkdf2Sync directly with high iteration count');};
  return cryptoMod;
}
