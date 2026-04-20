export function makeStreamingZlib(streamMod,Buf,fflate){
  const Transform=streamMod.Transform;
  const mkT=(Klass,errMsg)=>()=>{let inst=null;const chunks=[];const out=new Transform({transform(c,e,cb){try{if(!inst)inst=new fflate[Klass]((chunk,fin)=>{out.push(Buf.from(chunk));});inst.push(c instanceof Uint8Array?c:new TextEncoder().encode(String(c)),false);cb();}catch(e){cb(e);}},flush(cb){try{if(inst)inst.push(new Uint8Array(0),true);cb();}catch(e){cb(e);}}});return out;};
  return{
    createGzip:mkT('Gzip'),
    createGunzip:mkT('Gunzip'),
    createDeflate:mkT('Deflate'),
    createInflate:mkT('Inflate'),
    createDeflateRaw:mkT('Deflate'),
    createInflateRaw:mkT('Inflate'),
    createBrotliCompress:()=>{throw new Error('brotli: not in webcrypto/CompressionStream — use gzip instead');},
    createBrotliDecompress:()=>{throw new Error('brotli: not supported in browser');},
    brotliCompressSync:()=>{throw new Error('brotli: not supported — use gzipSync');},
    brotliDecompressSync:()=>{throw new Error('brotli: not supported');},
  };
}

export function makeVmModule(){
  const contexts=new WeakMap();
  const registry=typeof FinalizationRegistry!=='undefined'?new FinalizationRegistry(iframe=>{try{iframe.remove();}catch{}}):{register(){}};
  const hasDom=typeof document!=='undefined';
  const cloneAcross=v=>{if(v==null||typeof v!=='object'&&typeof v!=='function')return v;if(typeof v==='function')return v;try{return structuredClone(v);}catch{return v;}};
  const mkIframe=ctx=>{if(!hasDom)return{iframe:null,win:globalThis};const f=document.createElement('iframe');f.style.display='none';f.setAttribute('sandbox','allow-scripts allow-same-origin');document.body.appendChild(f);const win=f.contentWindow;if(ctx)for(const k of Object.keys(ctx))win[k]=cloneAcross(ctx[k]);registry.register(ctx||{},f);return{iframe:f,win};};
  const syncBack=(ctx,win)=>{for(const k of Object.keys(ctx))if(k in win)ctx[k]=cloneAcross(win[k]);for(const k of Object.keys(win))if(!(k in ctx)&&!['window','self','document','location','navigator','parent','top','frames','opener','localStorage','sessionStorage'].includes(k))ctx[k]=cloneAcross(win[k]);};
  return{
    runInThisContext:code=>(0,eval)(code),
    runInNewContext:(code,ctx={})=>{const{win}=mkIframe(ctx);const r=win.eval?win.eval(code):(0,eval)(code);if(win.eval)syncBack(ctx,win);return cloneAcross(r);},
    runInContext:(code,ctxObj)=>{const ref=contexts.get(ctxObj);if(!ref)throw new Error('vm.runInContext: context not created via createContext');const r=ref.win.eval(code);syncBack(ctxObj,ref.win);return cloneAcross(r);},
    createContext:(ctx={})=>{const ref=mkIframe(ctx);contexts.set(ctx,ref);return ctx;},
    isContext:ctx=>contexts.has(ctx),
    Script:class Script{constructor(code){this.code=code;}runInThisContext(){return(0,eval)(this.code);}runInNewContext(ctx={}){const{win}=mkIframe(ctx);const r=win.eval?win.eval(this.code):(0,eval)(this.code);if(win.eval)syncBack(ctx,win);return cloneAcross(r);}runInContext(ctx){const ref=contexts.get(ctx);if(!ref)throw new Error('Script.runInContext: createContext first');const r=ref.win.eval(this.code);syncBack(ctx,ref.win);return cloneAcross(r);}},
    compileFunction:(code,params=[])=>new Function(...params,code),
  };
}

export function makeModuleRegister(MODULES,snap,pathmod){
  const hooks=[];
  return{
    register(specifier,parentURL){hooks.push({specifier,parentURL:parentURL||'file:///'});return{addEventListener(){}};},
    _runResolve:async(specifier,context)=>{let result={url:specifier,shortCircuit:false};for(const h of hooks){try{const m=await import(h.specifier);if(m.resolve){const nextResolve=async(s,c)=>({url:s,shortCircuit:true});const r=await m.resolve(specifier,context,nextResolve);if(r&&r.shortCircuit){result=r;break;}if(r)result=r;}}catch{}}return result;},
    _runLoad:async(url,context)=>{let result={format:'module',source:null,shortCircuit:false};for(const h of hooks){try{const m=await import(h.specifier);if(m.load){const nextLoad=async(u,c)=>({format:'module',source:null,shortCircuit:true});const r=await m.load(url,context,nextLoad);if(r&&r.shortCircuit){result=r;break;}if(r)result=r;}}catch{}}return result;},
    _hooks:hooks,
  };
}

export function makeHttp2(){
  const mkStream=()=>{const handlers={};const on=(e,f)=>{(handlers[e]=handlers[e]||[]).push(f);return stream;};const emit=(e,...a)=>{for(const f of handlers[e]||[])f(...a);};const stream={on,once:on,emit,close(){emit('close');},end(){emit('end');},write(){},pipe:d=>d,setEncoding(){return stream;}};return{stream,emit};};
  return{
    connect(authority){
      const h={};let closed=false;
      const session={
        on:(e,f)=>{(h[e]=h[e]||[]).push(f);return session;},
        once:(e,f)=>session.on(e,f),
        emit:(e,...a)=>{for(const f of h[e]||[])f(...a);},
        close(){closed=true;session.emit('close');},
        destroy(){closed=true;session.emit('close');},
        request(headers){
          const {stream,emit}=mkStream();
          const method=headers[':method']||'GET';
          const path=headers[':path']||'/';
          const url=authority.toString().replace(/\/$/,'')+path;
          const fetchHeaders={};for(const[k,v]of Object.entries(headers))if(!k.startsWith(':'))fetchHeaders[k]=v;
          fetch(url,{method,headers:fetchHeaders}).then(async r=>{const respHeaders={':status':r.status};r.headers.forEach((v,k)=>{respHeaders[k]=v;});emit('response',respHeaders,0);const reader=r.body?.getReader();if(reader)for(;;){const{value,done}=await reader.read();if(done)break;emit('data',new Uint8Array(value));}emit('end');emit('close');}).catch(e=>emit('error',e));
          return stream;
        },
      };
      queueMicrotask(()=>session.emit('connect',session));
      return session;
    },
    constants:{NGHTTP2_REFUSED_STREAM:0xb,HTTP2_HEADER_METHOD:':method',HTTP2_HEADER_PATH:':path',HTTP2_HEADER_STATUS:':status'},
  };
}

let wasiPromise=null;
async function getWasi(){if(!wasiPromise)wasiPromise=import('https://esm.sh/@bjorn3/browser_wasi_shim@0.3.0/es2022/browser_wasi_shim.mjs').then(m=>m.default||m);return wasiPromise;}

export function makeWasi(){
  return{
    WASI:class WASI{
      constructor(opts={}){this._opts=opts;this._lib=null;this.wasiImport={};}
      async _load(){if(!this._lib){this._lib=await getWasi();const args=this._opts.args||[];const env=Object.entries(this._opts.env||{}).map(([k,v])=>`${k}=${v}`);const fds=[new this._lib.OpenFile(new this._lib.File([])),new this._lib.OpenFile(new this._lib.File([])),new this._lib.OpenFile(new this._lib.File([]))];this._wasi=new this._lib.WASI(args,env,fds);this.wasiImport=this._wasi.wasiImport;}return this._wasi;}
      async start(instance){await this._load();return this._wasi.start(instance);}
      async initialize(instance){await this._load();return this._wasi.initialize(instance);}
    }
  };
}
