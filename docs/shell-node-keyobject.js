const pemLabel=pem=>{const m=pem.match(/-----BEGIN ([^-]+)-----/);return m?m[1]:null;};
const pemToBytes=pem=>{const m=pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END/);if(!m)throw new Error('invalid PEM');return Uint8Array.from(atob(m[1].replace(/\s/g,'')),c=>c.charCodeAt(0));};
const bytesToPem=(bytes,label)=>`-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...bytes)).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

export function makeKeyObject(pem,type){
  const label=pemLabel(pem);
  const inferredType=type||(label==='PRIVATE KEY'||label==='RSA PRIVATE KEY'||label==='EC PRIVATE KEY'?'private':label==='PUBLIC KEY'?'public':'secret');
  const bytes=pemToBytes(pem);
  const asymType=(()=>{const s=String.fromCharCode(...bytes.slice(0,Math.min(bytes.length,80)));if(s.includes('\x2A\x86\x48\xCE\x3D\x02\x01'))return'ec';if(s.includes('\x2A\x86\x48\x86\xF7\x0D\x01\x01\x01'))return'rsa';return'unknown';})();
  return{
    type:inferredType,
    asymmetricKeyType:asymType,
    export({format='pem',type:expType}={}){
      if(format==='pem'){const l=inferredType==='private'?'PRIVATE KEY':'PUBLIC KEY';return bytesToPem(bytes,l);}
      if(format==='der')return bytes;
      if(format==='jwk')throw new Error('KeyObject.export jwk: use webcrypto exportKey(\'jwk\') directly');
      throw new Error('unsupported format: '+format);
    },
    toCryptoKey(){throw new Error('KeyObject.toCryptoKey: import via webcrypto.importKey instead');}
  };
}

let x509Mod=null;let x509Promise=null;
async function getX509(){
  if(!x509Promise)x509Promise=import('https://esm.sh/@peculiar/x509@1.9.7/es2022/x509.mjs').then(m=>m.default||m);
  return x509Promise;
}
export async function preloadX509(){x509Mod=await getX509();return x509Mod;}

export class X509Certificate{
  constructor(pem){
    this._pem=typeof pem==='string'?pem:'-----BEGIN CERTIFICATE-----\n'+btoa(String.fromCharCode(...pem)).match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';
    if(x509Mod){this._parsed=new x509Mod.X509Certificate(this._pem);}else{this._parsed=null;}
  }
  async _parse(){
    if(this._parsed)return this._parsed;
    const x509=await getX509();x509Mod=x509;
    this._parsed=new x509.X509Certificate(this._pem);
    return this._parsed;
  }
  async fingerprint256Async(){const p=await this._parse();const hash=await crypto.subtle.digest('SHA-256',p.rawData);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(':');}
  _need(){if(!this._parsed)throw new Error('X509Certificate: call await crypto.preloadX509() once before sync access, or await cert._parse()');return this._parsed;}
  get subject(){return this._need().subject;}
  get issuer(){return this._need().issuer;}
  get validFrom(){return this._need().notBefore.toISOString();}
  get validTo(){return this._need().notAfter.toISOString();}
  get serialNumber(){return this._need().serialNumber;}
  get raw(){return new Uint8Array(this._need().rawData);}
  toString(){return this._pem;}
}

export function extendKeys(cryptoMod){
  cryptoMod.createPrivateKey=input=>{const pem=typeof input==='string'?input:input.key;return makeKeyObject(pem,'private');};
  cryptoMod.createPublicKey=input=>{const pem=typeof input==='string'?input:input.key;return makeKeyObject(pem,'public');};
  cryptoMod.createSecretKey=buf=>({type:'secret',symmetricKeySize:buf.length,export:()=>buf});
  cryptoMod.X509Certificate=X509Certificate;
  cryptoMod.KeyObject={from:pem=>makeKeyObject(pem)};
  cryptoMod.preloadX509=preloadX509;
  return cryptoMod;
}
