let brotliMod=null;let brotliPromise=null;
// brotli-wasm has no streaming API, so the Transform polyfills below buffer the whole
// input until stream end before (de)compressing. Cap total buffered bytes so a runaway
// stream aborts with an error instead of exhausting memory (matches RX_HIGH_WATER in shell-node-net.js).
const BROTLI_MAX_BUFFER=256*1024*1024;

async function loadBrotli(){
  if(!brotliPromise)brotliPromise=import('./vendor/esm/brotli-wasm.mjs').then(async m=>{const lib=m.default||m;if(lib.then)return await lib;if(lib.compress&&lib.decompress)return lib;return lib;});
  return brotliPromise;
}

export async function preloadBrotli(){brotliMod=await loadBrotli();return brotliMod;}

export function makeBrotli(streamMod,Buf){
  const need=()=>{if(!brotliMod)throw new Error('brotli: call preloadBrotli() once before sync brotli calls (auto-preloaded on node entry)');return brotliMod;};
  const toBytes=d=>d instanceof Uint8Array?d:new TextEncoder().encode(String(d));
  const encodeErr=fn=>{try{return fn();}catch(e){throw new Error('brotli: '+e.message);}};
  return{
    brotliCompressSync:b=>{const bytes=toBytes(b);if(bytes.length>BROTLI_MAX_BUFFER)throw new Error('brotli: input exceeds BROTLI_MAX_BUFFER ('+BROTLI_MAX_BUFFER+' bytes)');return Buf.from(encodeErr(()=>need().compress(bytes)));},
    brotliDecompressSync:b=>{const dec=encodeErr(()=>need().decompress(toBytes(b)));if(dec.length>BROTLI_MAX_BUFFER)throw new Error('brotli: decompressed output exceeds limit ('+BROTLI_MAX_BUFFER+' bytes)');return Buf.from(dec);},
    brotliCompress:async(b,cb)=>{try{await loadBrotli();const out=Buf.from(need().compress(toBytes(b)));if(cb)cb(null,out);return out;}catch(e){if(cb)cb(e);else throw e;}},
    brotliDecompress:async(b,cb)=>{try{await loadBrotli();const dec=need().decompress(toBytes(b));if(dec.length>BROTLI_MAX_BUFFER){const e=new Error('brotli: decompressed output exceeds limit ('+BROTLI_MAX_BUFFER+' bytes)');if(cb)cb(e);else throw e;return;}const out=Buf.from(dec);if(cb)cb(null,out);return out;}catch(e){if(cb)cb(e);else throw e;}},
    createBrotliCompress:()=>{const chunks=[];let total=0;return new streamMod.Transform({transform(c,e,cb){const b=toBytes(c);total+=b.length;if(total>BROTLI_MAX_BUFFER){cb(new Error('brotli: input exceeds BROTLI_MAX_BUFFER ('+BROTLI_MAX_BUFFER+' bytes)'));return;}chunks.push(b);cb();},flush(cb){try{const all=new Uint8Array(total);let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}this.push(Buf.from(need().compress(all)));cb();}catch(e){cb(e);}}});},
    // NOTE: BROTLI_MAX_BUFFER guards compressed input size. Decompressed output is also
    // bounded by maxOutputSize (default BROTLI_MAX_BUFFER). Pass opts.__maxDecompressOutput
    // to override for trusted sources or to enforce a stricter limit for untrusted input.
    createBrotliDecompress:(opts={})=>{const maxOut=opts.__maxDecompressOutput!=null?opts.__maxDecompressOutput:BROTLI_MAX_BUFFER;const chunks=[];let total=0;return new streamMod.Transform({transform(c,e,cb){const b=toBytes(c);total+=b.length;if(total>BROTLI_MAX_BUFFER){cb(new Error('brotli: input exceeds BROTLI_MAX_BUFFER ('+BROTLI_MAX_BUFFER+' bytes)'));return;}chunks.push(b);cb();},flush(cb){try{const all=new Uint8Array(total);let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}const dec=need().decompress(all);if(dec.length>maxOut){cb(new Error('brotli: decompressed output exceeds limit ('+maxOut+' bytes)'));return;}this.push(Buf.from(dec));cb();}catch(e){cb(e);}}});},
  };
}
