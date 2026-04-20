export function extendBuffer(Buf) {
  const proto = Buf.prototype;
  proto.readBigUInt64BE = function(o=0){return (BigInt(this.readUInt32BE(o))<<32n)|BigInt(this.readUInt32BE(o+4));};
  proto.readBigUInt64LE = function(o=0){return (BigInt(this.readUInt32LE(o)))|(BigInt(this.readUInt32LE(o+4))<<32n);};
  proto.readUInt32LE = function(o=0){return (this[o]|(this[o+1]<<8)|(this[o+2]<<16)|(this[o+3]*0x1000000))>>>0;};
  proto.readDoubleBE = function(o=0){return new DataView(this.buffer,this.byteOffset+o,8).getFloat64(0,false);};
  proto.readDoubleLE = function(o=0){return new DataView(this.buffer,this.byteOffset+o,8).getFloat64(0,true);};
  proto.readFloatBE = function(o=0){return new DataView(this.buffer,this.byteOffset+o,4).getFloat32(0,false);};
  proto.readFloatLE = function(o=0){return new DataView(this.buffer,this.byteOffset+o,4).getFloat32(0,true);};
  proto.writeUInt16BE = function(v,o=0){this[o]=(v>>8)&0xff;this[o+1]=v&0xff;return o+2;};
  proto.writeUInt16LE = function(v,o=0){this[o]=v&0xff;this[o+1]=(v>>8)&0xff;return o+2;};
  proto.writeUInt32BE = function(v,o=0){this[o]=(v>>>24)&0xff;this[o+1]=(v>>>16)&0xff;this[o+2]=(v>>>8)&0xff;this[o+3]=v&0xff;return o+4;};
  proto.swap16 = function(){for(let i=0;i<this.length;i+=2){const t=this[i];this[i]=this[i+1];this[i+1]=t;}return this;};
  proto.swap32 = function(){for(let i=0;i<this.length;i+=4){[this[i],this[i+3]]=[this[i+3],this[i]];[this[i+1],this[i+2]]=[this[i+2],this[i+1]];}return this;};
  proto.swap64 = function(){for(let i=0;i<this.length;i+=8){for(let j=0;j<4;j++){const t=this[i+j];this[i+j]=this[i+7-j];this[i+7-j]=t;}}return this;};
  Buf.copyBytesFrom = (view,off=0,len)=>Buf.from(view.buffer,view.byteOffset+off,len??view.byteLength-off);
  return Buf;
}

const WIN = /^[A-Za-z]:[\\/]/;
function win32Mod(){
  const sep='\\';
  const norm=p=>{const abs=WIN.test(p);const parts=[];for(const s of p.replace(/\//g,'\\').split('\\')){if(s==='..')parts.pop();else if(s&&s!=='.')parts.push(s);}return (abs?p.slice(0,3):'')+parts.slice(abs?1:0).join('\\');};
  return {sep,delimiter:';',normalize:norm,join:(...a)=>norm(a.join('\\')),resolve:(...a)=>{let r='';for(const p of a)r=WIN.test(p)?p:r+'\\'+p;return norm(r);},dirname:p=>{const i=p.replace(/\//g,'\\').lastIndexOf('\\');return i<=0?'.':p.slice(0,i);},basename:(p,ext)=>{const b=p.replace(/\//g,'\\').split('\\').pop()||'';return ext&&b.endsWith(ext)?b.slice(0,-ext.length):b;},extname:p=>{const b=p.split(/[\\/]/).pop()||'';const i=b.lastIndexOf('.');return i>0?b.slice(i):'';},isAbsolute:p=>WIN.test(p)||p.startsWith('\\'),relative:(f,t)=>t.replace(f+'\\',''),parse:p=>({root:WIN.test(p)?p.slice(0,3):'',dir:p.slice(0,p.lastIndexOf('\\'))||'',base:p.split('\\').pop()||'',ext:'',name:''})};
}
export function extendPath(posix){
  posix.delimiter=':';
  posix.posix=posix;
  posix.win32=win32Mod();
  return posix;
}

export function createUrlExt(){
  const pathToFileURL=p=>{const u=new URL('file://');u.pathname=p.startsWith('/')?p:'/'+p;return u;};
  const fileURLToPath=u=>{const url=typeof u==='string'?new URL(u):u;if(url.protocol!=='file:')throw new TypeError('only file: supported');return decodeURIComponent(url.pathname);};
  return {URL,URLSearchParams,parse:s=>{const u=new URL(s);return{protocol:u.protocol,host:u.host,hostname:u.hostname,port:u.port,pathname:u.pathname,search:u.search,query:u.search.slice(1),hash:u.hash,href:u.href};},format:o=>{if(o instanceof URL)return o.href;const u=new URL('http://x');for(const[k,v]of Object.entries(o)){try{u[k]=v;}catch{}}return u.href;},resolve:(f,t)=>new URL(t,f).href,pathToFileURL,fileURLToPath,domainToASCII:s=>s,domainToUnicode:s=>s};
}

export function makeStringDecoder(){
  class StringDecoder{
    constructor(enc='utf8'){this.encoding=enc;this._td=new TextDecoder(enc==='utf8'?'utf-8':enc,{fatal:false});this._buf=null;}
    write(b){return this._td.decode(b,{stream:true});}
    end(b){return this._td.decode(b||new Uint8Array(0),{stream:false});}
  }
  return {StringDecoder};
}

export function makeReadline(term,proc){
  return {
    createInterface:({input,output,prompt='> '}={})=>{
      const handlers={line:[],close:[]};
      const rl={
        on:(ev,fn)=>{(handlers[ev]=handlers[ev]||[]).push(fn);return rl;},
        once:(ev,fn)=>rl.on(ev,(...a)=>{rl.off(ev,fn);fn(...a);}),
        off:(ev,fn)=>{handlers[ev]=(handlers[ev]||[]).filter(f=>f!==fn);return rl;},
        write:s=>output?.write?.(s),
        prompt:()=>output?.write?.(prompt),
        question:(q,cb)=>{output?.write?.(q);handlers.line.push(function onLine(l){cb(l);rl.off('line',onLine);});},
        close:()=>{for(const h of handlers.close)h();},
        setPrompt:p=>{prompt=p;},
        pause:()=>rl,resume:()=>rl,
      };
      input?._onLine?.(l=>{for(const h of handlers.line)h(l);});
      return rl;
    },
    cursorTo:(s,x,y)=>{},clearLine:()=>{},clearScreenDown:()=>{},moveCursor:()=>{},emitKeypressEvents:()=>{},
  };
}

export function makeTimersMod(){
  return {setTimeout,setInterval,setImmediate:fn=>setTimeout(fn,0),clearTimeout,clearInterval,clearImmediate:clearTimeout,promises:{setTimeout:ms=>new Promise(r=>setTimeout(r,ms)),setImmediate:()=>Promise.resolve(),setInterval:async function*(ms){while(1){await new Promise(r=>setTimeout(r,ms));yield;}}}};
}

export function makePerfHooks(){
  return {performance:globalThis.performance,PerformanceObserver:class{observe(){}disconnect(){}},monitorEventLoopDelay:()=>({enable(){},disable(){},reset(){},min:0,max:0,mean:0,stddev:0,percentile:()=>0}),constants:{NODE_PERFORMANCE_GC_MAJOR:2}};
}

export function makeV8Mod(){
  return {getHeapStatistics:()=>({total_heap_size:20000000,used_heap_size:10000000,heap_size_limit:2000000000,total_available_size:1990000000}),getHeapSpaceStatistics:()=>[],serialize:o=>new TextEncoder().encode(JSON.stringify(o)),deserialize:b=>JSON.parse(new TextDecoder().decode(b)),cachedDataVersionTag:()=>0,setFlagsFromString:()=>{}};
}

export function makeAsyncHooks(){
  return {createHook:()=>({enable(){return this;},disable(){return this;}}),executionAsyncId:()=>1,triggerAsyncId:()=>0,executionAsyncResource:()=>({}),AsyncLocalStorage:class{constructor(){this._s=null;}run(s,fn,...a){const p=this._s;this._s=s;try{return fn(...a);}finally{this._s=p;}}getStore(){return this._s;}enterWith(s){this._s=s;}disable(){this._s=null;}exit(fn,...a){const p=this._s;this._s=null;try{return fn(...a);}finally{this._s=p;}}},AsyncResource:class{constructor(){}runInAsyncScope(fn,t,...a){return fn.apply(t,a);}}};
}

export function makeStubs(ctx){
  const stub=name=>({__stub:name,toString:()=>`[${name} stub]`});
  return {
    inspector:{open:()=>{},close:()=>{},url:()=>undefined,waitForDebugger:()=>{},Session:class{connect(){}post(){}}},
    cluster:{isPrimary:true,isMaster:true,isWorker:false,workers:{},fork:()=>{throw new Error('cluster.fork: not supported in browser')},on:()=>{},emit:()=>{}},
    sea:{isSea:()=>false,getAsset:()=>{throw new Error('sea.getAsset: no SEA blob')},getRawAsset:()=>{throw new Error('sea.getRawAsset: no SEA blob')}},
    test_runner:{test:(n,fn)=>Promise.resolve(fn?.()),describe:(n,fn)=>fn?.(),it:(n,fn)=>Promise.resolve(fn?.()),before:fn=>fn?.(),after:fn=>fn?.(),beforeEach:()=>{},afterEach:()=>{},run:()=>({})},
    readline_promises:{createInterface:()=>({close(){},question:q=>Promise.resolve('')})},
    punycode:{encode:s=>s,decode:s=>s,toASCII:s=>s,toUnicode:s=>s,ucs2:{encode:a=>String.fromCodePoint(...a),decode:s=>[...s].map(c=>c.codePointAt(0))}},
    tty:{isatty:()=>true,ReadStream:class{isTTY=true;},WriteStream:class{isTTY=true;columns=80;rows=24;}},
    domain:{create:()=>({run:fn=>fn(),add(){},remove(){},dispose(){},on(){},emit(){}})},
    diagnostics_channel:{channel:name=>({hasSubscribers:false,publish(){},subscribe(){},unsubscribe(){}}),hasSubscribers:()=>false},
    string_decoder:makeStringDecoder(),
    tls:{connect:()=>{throw new Error('tls.connect: use fetch() for HTTPS in browser');},createServer:()=>{throw new Error('tls.createServer: not supported in browser');},DEFAULT_CIPHERS:'',DEFAULT_MIN_VERSION:'TLSv1.2',DEFAULT_MAX_VERSION:'TLSv1.3'},
  };
}

export function makeErrorCodes(){
  const codes={ERR_MODULE_NOT_FOUND:'Cannot find module',ERR_INVALID_ARG_TYPE:'Invalid argument type',ERR_INVALID_ARG_VALUE:'Invalid argument value',ERR_OUT_OF_RANGE:'Value out of range',ERR_UNHANDLED_ERROR:'Unhandled error',ERR_ASSERTION:'Assertion failed',ERR_UNSUPPORTED_DIR_IMPORT:'Directory import not supported',ERR_PACKAGE_PATH_NOT_EXPORTED:'Package path not exported',ERR_REQUIRE_ESM:'Cannot require() ESM module',ERR_UNKNOWN_FILE_EXTENSION:'Unknown file extension',ERR_UNKNOWN_BUILTIN_MODULE:'Unknown builtin module',ERR_INVALID_URL:'Invalid URL',ERR_STREAM_DESTROYED:'Stream destroyed',ERR_STREAM_WRITE_AFTER_END:'Write after end',ERR_STREAM_PREMATURE_CLOSE:'Premature close'};
  const make=(code,msg)=>{const e=new Error(msg||codes[code]);e.code=code;return e;};
  return {codes,make};
}

export function extendProcessExtras(proc,ctx){
  proc.stdout.columns=80;proc.stdout.rows=24;proc.stdout.isTTY=true;proc.stdout.getColorDepth=()=>8;proc.stdout.hasColors=()=>true;
  proc.stderr.columns=80;proc.stderr.rows=24;proc.stderr.isTTY=true;
  proc.stdin.isTTY=true;
  proc.resourceUsage=()=>({userCPUTime:0,systemCPUTime:0,maxRSS:50000,sharedMemorySize:0,unsharedDataSize:0,unsharedStackSize:0,minorPageFault:0,majorPageFault:0,swappedOut:0,fsRead:0,fsWrite:0,ipcSent:0,ipcReceived:0,signalsCount:0,voluntaryContextSwitches:0,involuntaryContextSwitches:0});
  proc.binding=name=>{throw new Error(`process.binding('${name}'): internal bindings not available`);};
  proc.allowedNodeEnvironmentFlags=new Set(['--experimental-vm-modules','--no-warnings','--loader','--import','--require','-r']);
  proc.report={getReport:()=>({}),writeReport:()=>'report.json'};
  proc.availableMemory=()=>1073741824;
  proc.constrainedMemory=()=>0;
  proc.loadEnvFile=p=>{};
  proc.noDeprecation=false;proc.throwDeprecation=false;proc.traceDeprecation=false;
  proc.sourceMapsEnabled=false;
  proc.channel=undefined;proc.connected=false;
  const sigH={};
  const origOn=proc.on?.bind(proc);
  proc.on=(ev,fn)=>{if(['SIGINT','SIGTERM','SIGHUP','exit','beforeExit','uncaughtException','unhandledRejection','warning','message'].includes(ev)){(sigH[ev]=sigH[ev]||[]).push(fn);}origOn?.(ev,fn);return proc;};
  proc._emitSignal=(ev,...a)=>{for(const h of sigH[ev]||[])h(...a);};
  proc.kill=()=>true;
  return proc;
}

export function makeStreamConsumers(){
  const toArr=async it=>{const a=[];for await(const c of it)a.push(c);return a;};
  return {text:async s=>{const a=await toArr(s);return a.map(c=>typeof c==='string'?c:new TextDecoder().decode(c)).join('');},json:async s=>JSON.parse(await (await import('./shell-node-extras.js')).makeStreamConsumers().text(s)),arrayBuffer:async s=>{const a=await toArr(s);const b=Buffer.concat(a.map(c=>c instanceof Uint8Array?c:new TextEncoder().encode(c)));return b.buffer;},buffer:async s=>{const a=await toArr(s);return Buffer.concat(a.map(c=>c instanceof Uint8Array?c:new TextEncoder().encode(c)));}};
}
