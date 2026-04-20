const NATIVE_DISPATCH={
  'better_sqlite3.node':()=>import('https://esm.sh/sql.js@1.11.0/dist/sql-wasm.js').then(m=>{const Lib=m.default||m;return{__native:true,Database:Lib.Database||Lib};}),
  'bcrypt_lib.node':()=>import('https://esm.sh/bcryptjs@2.4.3').then(m=>({__native:true,...(m.default||m)})),
  'sharp.node':()=>({__native:true,resize:()=>{throw new Error('sharp native requires WASM variant — use @img/sharp-wasm32');}}),
  'argon2.node':()=>import('https://esm.sh/argon2-browser@1.18.0').then(m=>({__native:true,hash:m.default.hash,verify:m.default.verify})),
  'bufferutil.node':()=>({__native:true,mask:(src,mask,out,offset,length)=>{for(let i=0;i<length;i++)out[offset+i]=src[i]^mask[i&3];},unmask:(buf,mask)=>{for(let i=0;i<buf.length;i++)buf[i]^=mask[i&3];}}),
  'utf_8_validate.node':()=>({__native:true,default:(s,buf)=>{try{new TextDecoder('utf-8',{fatal:true}).decode(buf);return true;}catch{return false;}}}),
  'farmhash.node':()=>({__native:true,hash32:s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;},hash64:s=>BigInt(NATIVE_DISPATCH['farmhash.node']().hash32(s))}),
};

export function makeNativeLoader(){
  return{
    async dlopen(target,path){const key=path.split('/').pop();const loader=NATIVE_DISPATCH[key];if(!loader)throw new Error(`process.dlopen: no WASM/browser equivalent for ${path}`);const mod=await loader();target.exports=mod;return target;},
    resolve:key=>NATIVE_DISPATCH[key]?'virtual:native/'+key:null,
    register:(name,loader)=>{NATIVE_DISPATCH[name]=loader;},
    list:()=>Object.keys(NATIVE_DISPATCH),
  };
}

export function wireNativeRequire(makeRequire,nativeLoader){
  const origRequire=makeRequire;
  return dir=>{
    const req=origRequire(dir);
    const wrapped=function(id){
      if(id.endsWith('.node')){const key=id.split('/').pop();if(nativeLoader.resolve(key)){const target={exports:{}};nativeLoader.dlopen(target,id);return target.exports;}throw new Error(`Cannot find native addon: ${id}`);}
      return req(id);
    };
    wrapped.resolve=req.resolve;wrapped.cache=req.cache;
    return wrapped;
  };
}
