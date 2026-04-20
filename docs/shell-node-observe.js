export function makeDebugRegistry(){
  const reg={modules:{},streamsOpen:new Set(),workersActive:new Set(),cryptoOps:0,requireCount:0,zlibBytes:{in:0,out:0},http2Sessions:0,vmContexts:0,activeRequires:[]};
  if(typeof window!=='undefined'){window.__debug=window.__debug||{};window.__debug.node=reg;}
  return reg;
}

export function makeDiagnosticsChannel(){
  const channels=new Map();
  const ch=name=>{if(!channels.has(name))channels.set(name,{name,subs:new Set(),subscribe(fn){this.subs.add(fn);return this;},unsubscribe(fn){this.subs.delete(fn);return this;},publish(msg){for(const fn of this.subs)try{fn(msg,name);}catch{}},hasSubscribers(){return this.subs.size>0;}});return channels.get(name);};
  return{
    channel:ch,
    subscribe(name,fn){ch(name).subscribe(fn);},
    unsubscribe(name,fn){ch(name).unsubscribe(fn);},
    hasSubscribers(name){return ch(name).hasSubscribers();},
    tracingChannel(name){const start=ch(name+':start');const end=ch(name+':end');const asyncStart=ch(name+':asyncStart');const asyncEnd=ch(name+':asyncEnd');const error=ch(name+':error');return{start,end,asyncStart,asyncEnd,error,traceSync(fn,ctx){start.publish(ctx);try{const r=fn.call(ctx);end.publish({...ctx,result:r});return r;}catch(e){error.publish({...ctx,error:e});throw e;}},async tracePromise(fn,ctx){start.publish(ctx);try{const r=await fn.call(ctx);asyncEnd.publish({...ctx,result:r});return r;}catch(e){error.publish({...ctx,error:e});throw e;}}};},
  };
}

export function makeTraceEvents(reg){
  const events=[];
  reg.traceEvents=events;
  const tracings=[];
  return{
    createTracing({categories=[]}={}){const t={categories,enabled:false,enable(){this.enabled=true;tracings.push(this);},disable(){this.enabled=false;const i=tracings.indexOf(this);if(i>=0)tracings.splice(i,1);}};return t;},
    getEnabledCategories(){const out=new Set();for(const t of tracings)if(t.enabled)for(const c of t.categories)out.add(c);return[...out];},
    _emit(cat,name,data){if(events.length>=10000)events.shift();events.push({cat,name,data,ts:performance.now()});},
  };
}

export function makeBufferPool(Buf,poolSize=8192){
  let pool=new Uint8Array(poolSize);
  let offset=0;
  Buf.poolSize=poolSize;
  const origAllocUnsafe=Buf.allocUnsafe;
  Buf.allocUnsafe=size=>{if(size>=poolSize>>>1)return origAllocUnsafe(size);if(offset+size>poolSize){pool=new Uint8Array(poolSize);offset=0;}const slice=Buf.from(pool.buffer,pool.byteOffset+offset,size);offset+=size;offset=(offset+7)&~7;return slice;};
  Buf.allocUnsafeSlow=size=>origAllocUnsafe(size);
  return Buf;
}

export function makeProcessBindings(util){
  const bindings={util:{isDate:v=>v instanceof Date,isRegExp:v=>v instanceof RegExp,isMap:v=>v instanceof Map,isSet:v=>v instanceof Set,isPromise:v=>v instanceof Promise,isNativeError:v=>v instanceof Error,isArrayBuffer:v=>v instanceof ArrayBuffer,isTypedArray:v=>ArrayBuffer.isView(v)&&!(v instanceof DataView),getHiddenValue:()=>undefined,setHiddenValue:()=>{}}};
  return name=>{if(bindings[name])return bindings[name];throw new Error(`process.binding('${name}'): internal binding not exposed`);};
}

export function makePerfMemory(perf){
  const getMemory=()=>{const m=performance.memory||{usedJSHeapSize:0,totalJSHeapSize:0,jsHeapSizeLimit:1073741824};return{rss:m.totalJSHeapSize||50000000,heapTotal:m.totalJSHeapSize||10000000,heapUsed:m.usedJSHeapSize||5000000,external:0,arrayBuffers:0};};
  perf.measureUserAgentSpecificMemory=performance.measureUserAgentSpecificMemory?.bind(performance)||(async()=>({bytes:getMemory().heapUsed,breakdown:[]}));
  return getMemory;
}

export function makeFetchPool(){
  return class Agent{
    constructor(opts={}){this.maxSockets=opts.maxSockets||Infinity;this.keepAlive=opts.keepAlive!==false;this._queue=[];this._active=0;this._controllers=new Set();}
    _acquire(){if(this._active<this.maxSockets){this._active++;return Promise.resolve();}return new Promise(r=>this._queue.push(r));}
    _release(){this._active--;const next=this._queue.shift();if(next){this._active++;next();}}
    async fetch(url,opts={}){await this._acquire();const ctrl=new AbortController();this._controllers.add(ctrl);const signal=opts.signal?AbortSignal.any?.([opts.signal,ctrl.signal])||opts.signal:ctrl.signal;try{return await fetch(url,{...opts,signal});}finally{this._controllers.delete(ctrl);this._release();}}
    destroy(){for(const c of this._controllers)c.abort();this._controllers.clear();}
  };
}

export function installPrepareStackTraceHook(){
  if(Error._psHooked)return;Error._psHooked=true;
  const origGetStack=Object.getOwnPropertyDescriptor(Error.prototype,'stack');
  const parseFrame=l=>{const m=l.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);return m?{getFileName:()=>m[2],getLineNumber:()=>+m[3],getColumnNumber:()=>+m[4],getFunctionName:()=>m[1]||null,isNative:()=>false,isEval:()=>false,toString:()=>l.trim()}:{getFileName:()=>null,getLineNumber:()=>0,getColumnNumber:()=>0,getFunctionName:()=>null,isNative:()=>false,toString:()=>l.trim()};};
  if(!('prepareStackTrace'in Error))Error.prepareStackTrace=null;
  Object.defineProperty(Error.prototype,'stack',{configurable:true,get(){const raw=origGetStack?.get?.call(this)||'';if(typeof Error.prepareStackTrace==='function'){const lines=raw.split('\n').slice(1).filter(l=>l.trim().startsWith('at '));const frames=lines.map(parseFrame);try{return Error.prepareStackTrace(this,frames);}catch{return raw;}}return raw;},set(v){Object.defineProperty(this,'stack',{value:v,writable:true,configurable:true});}});
}

export function installCaptureStackTrace(){
  if(Error.captureStackTrace)return;
  Error.captureStackTrace=(target,ctor)=>{const e=new Error();const lines=(e.stack||'').split('\n');target.stack=(ctor?.name?ctor.name:'Error')+(target.message?': '+target.message:'')+'\n'+lines.slice(2).join('\n');};
}

export function makeFsWatchReal(getSnap){
  const watchers=[];
  let lastSnap=null;
  const tick=()=>{const cur=getSnap();if(!lastSnap){lastSnap={...cur};return;}const curKeys=new Set(Object.keys(cur));const prevKeys=new Set(Object.keys(lastSnap));const changed=[];for(const k of curKeys)if(!prevKeys.has(k)||cur[k]!==lastSnap[k])changed.push({type:prevKeys.has(k)?'change':'rename',path:k});for(const k of prevKeys)if(!curKeys.has(k))changed.push({type:'rename',path:k});for(const {type,path} of changed)for(const w of watchers)if(path===w.path||(w.recursive&&path.startsWith(w.path+'/')))for(const h of w.handlers.change)h(type,path.split('/').pop());lastSnap={...cur};};
  setInterval(tick,500);
  return (path,opts={},listener)=>{if(typeof opts==='function'){listener=opts;opts={};}const normalized=path.replace(/^\/+/,'').replace(/\/$/,'');const handlers={change:listener?[listener]:[],error:[],close:[]};const w={path:normalized,recursive:!!opts.recursive,handlers,on:(ev,fn)=>{(handlers[ev]=handlers[ev]||[]).push(fn);return w;},close:()=>{const i=watchers.indexOf(w);if(i>=0)watchers.splice(i,1);for(const h of handlers.close)h();},ref:()=>w,unref:()=>w};watchers.push(w);return w;};
}
