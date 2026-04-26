let brotliMod=null;let brotliPromise=null;

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
    brotliCompressSync:b=>Buf.from(encodeErr(()=>need().compress(toBytes(b)))),
    brotliDecompressSync:b=>Buf.from(encodeErr(()=>need().decompress(toBytes(b)))),
    brotliCompress:async(b,cb)=>{try{await loadBrotli();const out=Buf.from(need().compress(toBytes(b)));if(cb)cb(null,out);return out;}catch(e){if(cb)cb(e);else throw e;}},
    brotliDecompress:async(b,cb)=>{try{await loadBrotli();const out=Buf.from(need().decompress(toBytes(b)));if(cb)cb(null,out);return out;}catch(e){if(cb)cb(e);else throw e;}},
    createBrotliCompress:()=>{const chunks=[];return new streamMod.Transform({transform(c,e,cb){chunks.push(toBytes(c));cb();},flush(cb){try{const all=new Uint8Array(chunks.reduce((s,c)=>s+c.length,0));let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}this.push(Buf.from(need().compress(all)));cb();}catch(e){cb(e);}}});},
    createBrotliDecompress:()=>{const chunks=[];return new streamMod.Transform({transform(c,e,cb){chunks.push(toBytes(c));cb();},flush(cb){try{const all=new Uint8Array(chunks.reduce((s,c)=>s+c.length,0));let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}this.push(Buf.from(need().decompress(all)));cb();}catch(e){cb(e);}}});},
  };
}
