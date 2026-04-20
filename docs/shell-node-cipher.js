const ALG_MAP={
  'aes-128-gcm':{name:'AES-GCM',length:128},'aes-192-gcm':{name:'AES-GCM',length:192},'aes-256-gcm':{name:'AES-GCM',length:256},
  'aes-128-cbc':{name:'AES-CBC',length:128},'aes-192-cbc':{name:'AES-CBC',length:192},'aes-256-cbc':{name:'AES-CBC',length:256},
  'aes-128-ctr':{name:'AES-CTR',length:128},'aes-256-ctr':{name:'AES-CTR',length:256},
};
const toBytes=d=>typeof d==='string'?new TextEncoder().encode(d):d instanceof Uint8Array?d:new Uint8Array(d);
const concat=list=>{const t=list.reduce((s,c)=>s+c.length,0);const out=new Uint8Array(t);let o=0;for(const c of list){out.set(c,o);o+=c.length;}return out;};

async function importKey(alg,keyBytes,usages){
  return crypto.subtle.importKey('raw',keyBytes,{name:alg.name,length:alg.length},false,usages);
}

function makeCipher(alg,keyBytes,iv,decrypt=false){
  const spec=ALG_MAP[alg];
  if(!spec)throw new Error(`cipher algorithm not supported: ${alg}`);
  const chunks=[];let authTag=null;let aad=null;let final=null;
  const usage=decrypt?['decrypt']:['encrypt'];
  return {
    update(data,inputEnc,outputEnc){const bytes=inputEnc?Buffer.from(data,inputEnc):toBytes(data);chunks.push(bytes);return Buffer.alloc(0);},
    async final(enc){const input=concat(chunks);const key=await importKey(spec,toBytes(keyBytes),usage);const params={name:spec.name,iv:toBytes(iv)};if(spec.name==='AES-GCM'&&aad)params.additionalData=aad;if(decrypt&&spec.name==='AES-GCM'&&authTag){const full=concat([input,authTag]);const out=new Uint8Array(await crypto.subtle.decrypt(params,key,full));return enc?Buffer.from(out).toString(enc):Buffer.from(out);}const op=decrypt?crypto.subtle.decrypt.bind(crypto.subtle):crypto.subtle.encrypt.bind(crypto.subtle);const out=new Uint8Array(await op(params,key,input));if(!decrypt&&spec.name==='AES-GCM'){authTag=out.slice(-16);const ct=out.slice(0,-16);final=Buffer.from(ct);return enc?final.toString(enc):final;}return enc?Buffer.from(out).toString(enc):Buffer.from(out);},
    setAAD(d){aad=toBytes(d);return this;},
    setAuthTag(t){authTag=toBytes(t);return this;},
    getAuthTag(){return authTag?Buffer.from(authTag):null;},
    setAutoPadding(){return this;},
  };
}

export function extendCrypto(cryptoMod,Buf){
  globalThis.Buffer=globalThis.Buffer||Buf;
  cryptoMod.createCipheriv=(alg,key,iv)=>makeCipher(alg.toLowerCase(),key,iv,false);
  cryptoMod.createDecipheriv=(alg,key,iv)=>makeCipher(alg.toLowerCase(),key,iv,true);
  cryptoMod.createCipher=()=>{throw new Error('crypto.createCipher: deprecated and unsafe — use createCipheriv');};
  cryptoMod.createDecipher=()=>{throw new Error('crypto.createDecipher: deprecated — use createDecipheriv');};
  cryptoMod.generateKeyPair=(type,opts,cb)=>{cryptoMod.generateKeyPairAsync?.(type,opts).then(r=>cb(null,r.publicKey,r.privateKey),cb);};
  cryptoMod.generateKeyPairSync=()=>{throw new Error('crypto.generateKeyPairSync: synchronous keypair generation not available in browser — use generateKeyPair (async)');};
  cryptoMod.generateKeyPairAsync=async(type,opts={})=>{const algMap={rsa:{name:'RSASSA-PKCS1-v1_5',modulusLength:opts.modulusLength||2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},ec:{name:'ECDSA',namedCurve:opts.namedCurve||'P-256'}};const alg=algMap[type];if(!alg)throw new Error(`unsupported key type: ${type}`);const kp=await crypto.subtle.generateKey(alg,true,type==='rsa'?['sign','verify']:['sign','verify']);const pub=new Uint8Array(await crypto.subtle.exportKey('spki',kp.publicKey));const priv=new Uint8Array(await crypto.subtle.exportKey('pkcs8',kp.privateKey));const pem=(b,label)=>`-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...b)).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;return {publicKey:pem(pub,'PUBLIC KEY'),privateKey:pem(priv,'PRIVATE KEY')};};
  const pemToBytes=pem=>{const m=pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END/);if(!m)throw new Error('invalid PEM');return Uint8Array.from(atob(m[1].replace(/\s/g,'')),c=>c.charCodeAt(0));};
  const hashFromAlg=a=>{const u=a.toUpperCase();if(u.includes('SHA512')||u.includes('SHA-512'))return'SHA-512';if(u.includes('SHA384')||u.includes('SHA-384'))return'SHA-384';if(u.includes('SHA1')||u.includes('SHA-1'))return'SHA-1';return'SHA-256';};
  const isEcBytes=bytes=>{const s=String.fromCharCode(...bytes.slice(0,Math.min(bytes.length,80)));return s.includes('\x2A\x86\x48\xCE\x3D\x02\x01');};
  const importForSign=async(pem,hash)=>{const bytes=pemToBytes(pem);const ec=isEcBytes(bytes);const params=ec?{name:'ECDSA',namedCurve:'P-256'}:{name:'RSASSA-PKCS1-v1_5',hash};const k=await crypto.subtle.importKey('pkcs8',bytes,params,false,['sign']);return{key:k,alg:ec?{name:'ECDSA',hash}:{name:'RSASSA-PKCS1-v1_5'}};};
  const importForVerify=async(pem,hash)=>{const bytes=pemToBytes(pem);const ec=isEcBytes(bytes);const params=ec?{name:'ECDSA',namedCurve:'P-256'}:{name:'RSASSA-PKCS1-v1_5',hash};const k=await crypto.subtle.importKey('spki',bytes,params,false,['verify']);return{key:k,alg:ec?{name:'ECDSA',hash}:{name:'RSASSA-PKCS1-v1_5'}};};
  cryptoMod.signAsync=async(alg,data,keyPem)=>{const pem=typeof keyPem==='string'?keyPem:keyPem.key;const {key,alg:a}=await importForSign(pem,hashFromAlg(alg));const sig=await crypto.subtle.sign(a,key,toBytes(data));return Buf.from(new Uint8Array(sig));};
  cryptoMod.verifyAsync=async(alg,data,keyPem,sig)=>{const pem=typeof keyPem==='string'?keyPem:keyPem.key;const {key,alg:a}=await importForVerify(pem,hashFromAlg(alg));return crypto.subtle.verify(a,key,toBytes(sig),toBytes(data));};
  cryptoMod.hkdf=(digest,ikm,salt,info,keylen,cb)=>{cryptoMod.hkdfAsync(digest,ikm,salt,info,keylen).then(r=>cb(null,r),cb);};
  cryptoMod.hkdfSync=()=>{throw new Error('crypto.hkdfSync: use async hkdf in browser (webcrypto is async-only)');};
  cryptoMod.hkdfAsync=async(digest,ikm,salt,info,keylen)=>{const hash=hashFromAlg(digest);const k=await crypto.subtle.importKey('raw',toBytes(ikm),'HKDF',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'HKDF',hash,salt:toBytes(salt),info:toBytes(info)},k,keylen*8);return Buf.from(new Uint8Array(bits));};
  cryptoMod.createECDH=curve=>{const nc=curve==='prime256v1'?'P-256':curve==='secp384r1'?'P-384':curve==='secp521r1'?'P-521':curve;let kp=null;return{generateKeys:async()=>{kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:nc},true,['deriveBits']);const pub=await crypto.subtle.exportKey('raw',kp.publicKey);return Buf.from(new Uint8Array(pub));},getPublicKey:async()=>{if(!kp)throw new Error('generateKeys first');const pub=await crypto.subtle.exportKey('raw',kp.publicKey);return Buf.from(new Uint8Array(pub));},computeSecret:async otherPub=>{if(!kp)throw new Error('generateKeys first');const other=await crypto.subtle.importKey('raw',toBytes(otherPub),{name:'ECDH',namedCurve:nc},false,[]);const bits=await crypto.subtle.deriveBits({name:'ECDH',public:other},kp.privateKey,256);return Buf.from(new Uint8Array(bits));}};};
  cryptoMod.createDiffieHellman=()=>{throw new Error('crypto.createDiffieHellman: classic modp DH not supported — use createECDH(\'prime256v1\')');};
  cryptoMod.sign=(alg,data,key,cb)=>{if(cb)cryptoMod.signAsync(alg,data,key).then(r=>cb(null,r),cb);else return cryptoMod.signAsync(alg,data,key);};
  cryptoMod.verify=(alg,data,key,sig,cb)=>{if(cb)cryptoMod.verifyAsync(alg,data,key,sig).then(r=>cb(null,r),cb);else return cryptoMod.verifyAsync(alg,data,key,sig);};
  cryptoMod.createSign=alg=>{const parts=[];return{update(d){parts.push(toBytes(d));return this;},async sign(key,enc){const data=concat(parts);const sig=await cryptoMod.signAsync(alg,data,key);return enc?sig.toString(enc):sig;}};};
  cryptoMod.createVerify=alg=>{const parts=[];return{update(d){parts.push(toBytes(d));return this;},async verify(key,sig,enc){const data=concat(parts);const sigBytes=typeof sig==='string'?Buf.from(sig,enc):sig;return cryptoMod.verifyAsync(alg,data,key,sigBytes);}};};
  cryptoMod.getCiphers=()=>Object.keys(ALG_MAP);
  cryptoMod.getHashes=()=>['sha1','sha256','sha512','md5'];
  cryptoMod.getCurves=()=>['P-256','P-384','P-521'];
  cryptoMod.timingSafeEqual=(a,b)=>{if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a[i]^b[i];return r===0;};
  cryptoMod.diffieHellman=()=>{throw new Error('crypto.diffieHellman: use webcrypto ECDH')};
  cryptoMod.scrypt=(pw,salt,len,opts,cb)=>{if(typeof opts==='function'){cb=opts;opts={};}queueMicrotask(()=>{try{const k=cryptoMod.pbkdf2Sync(pw,salt,16384,len,'sha256');cb(null,Buf.from(k));}catch(e){cb(e);}});};
  cryptoMod.scryptSync=(pw,salt,len)=>Buf.from(cryptoMod.pbkdf2Sync(pw,salt,16384,len,'sha256'));
  return cryptoMod;
}
