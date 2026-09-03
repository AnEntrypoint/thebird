export function detectBrowser(){
  const ua=(typeof navigator!=='undefined'?navigator.userAgent:'')||'';
  const vendor=/Firefox\//.test(ua)?'firefox':/Edg\//.test(ua)?'edge':/Chrome\//.test(ua)?'chromium':/Safari\//.test(ua)?'webkit':'unknown';
  const m=ua.match(/(Firefox|Chrome|Edg|Safari|Version)\/([\d.]+)/);
  const version=m?m[2]:'0';
  const g=globalThis;
  const caps={
    opfs:!!(g.navigator?.storage?.getDirectory),
    sharedArrayBuffer:typeof SharedArrayBuffer!=='undefined'&&g.crossOriginIsolated===true,
    performanceMemory:!!(g.performance?.memory),
    compressionStream:typeof g.CompressionStream!=='undefined',
    webTransport:typeof g.WebTransport!=='undefined',
    webRTCDataChannel:typeof g.RTCPeerConnection!=='undefined',
    webCodecs:typeof g.VideoEncoder!=='undefined',
    storageBuckets:!!(g.navigator?.storageBuckets),
    fileSystemObserver:typeof g.FileSystemObserver!=='undefined',
    measureMemory:typeof g.performance?.measureUserAgentSpecificMemory==='function',
    broadcastChannel:typeof g.BroadcastChannel!=='undefined',
  };
  return{vendor,version,ua,capabilities:caps};
}

export function registerPolyfill(reg,name,backing,reason){
  reg.polyfills=reg.polyfills||{};
  reg.polyfills[name]={active:true,backing,reason,activatedAt:Date.now()};
}

export function makeCompressionStreamZlib(streamMod,Buf){
  if(typeof CompressionStream==='undefined')return null;
  const mk=(name,Ctor)=>()=>{const t=new Ctor(name);const reader=t.readable.getReader();const writer=t.writable.getWriter();const out=new streamMod.Transform({transform(c,e,cb){writer.write(c instanceof Uint8Array?c:new TextEncoder().encode(String(c))).then(()=>cb(),cb);},flush(cb){writer.close().then(async()=>{for(;;){const{value,done}=await reader.read();if(done)break;out.push(Buf.from(value));}cb();},cb);}});return out;};
  return{
    createGzip:mk('gzip',CompressionStream),
    createGunzip:mk('gzip',DecompressionStream),
    createDeflate:mk('deflate',CompressionStream),
    createInflate:mk('deflate',DecompressionStream),
    createDeflateRaw:mk('deflate-raw',CompressionStream),
    createInflateRaw:mk('deflate-raw',DecompressionStream),
  };
}

export function makeWebCodecs(){
  const g=globalThis;
  if(typeof g.VideoEncoder==='undefined')return null;
  return{VideoEncoder:g.VideoEncoder,VideoDecoder:g.VideoDecoder,AudioEncoder:g.AudioEncoder,AudioDecoder:g.AudioDecoder,ImageDecoder:g.ImageDecoder,EncodedVideoChunk:g.EncodedVideoChunk,EncodedAudioChunk:g.EncodedAudioChunk,VideoFrame:g.VideoFrame,AudioData:g.AudioData};
}

export function makeWebPush(){
  return{
    async subscribe(applicationServerKey,opts={}){
      if(!navigator.serviceWorker)throw new Error('web-push: serviceWorker not available');
      const reg=await navigator.serviceWorker.ready;
      return reg.pushManager.subscribe({userVisibleOnly:opts.userVisibleOnly!==false,applicationServerKey});
    },
    async getSubscription(){
      const reg=await navigator.serviceWorker?.ready;
      return reg?reg.pushManager.getSubscription():null;
    },
    async unsubscribe(){
      const sub=await this.getSubscription();
      return sub?sub.unsubscribe():false;
    }
  };
}

export function makeStorageHelpers(){
  const g=globalThis;
  return{
    async estimate(){if(!g.navigator?.storage?.estimate)return{usage:0,quota:0,usageDetails:{}};return g.navigator.storage.estimate();},
    async persist(){if(!g.navigator?.storage?.persist)return false;return g.navigator.storage.persist();},
    async persisted(){if(!g.navigator?.storage?.persisted)return false;return g.navigator.storage.persisted();},
    buckets:g.navigator?.storageBuckets||null,
  };
}

export function makeFsObserver(getSnap,fsWatchers){
  const g=globalThis;
  if(typeof g.FileSystemObserver==='undefined')return null;
  return async (opfsRoot)=>{
    const obs=new g.FileSystemObserver(records=>{
      for(const r of records){
        const path=r.relativePathComponents.join('/');
        for(const w of fsWatchers)if(path===w.path||(w.recursive&&path.startsWith(w.path+'/')))for(const h of w.handlers.change)h(r.type,path.split('/').pop());
      }
    });
    if(opfsRoot)await obs.observe(opfsRoot,{recursive:true});
    return obs;
  };
}

export function wrapWorkerForFirefox(opts={}){
  const ua=typeof navigator!=='undefined'?navigator.userAgent:'';
  const isOldFirefox=/Firefox\/(\d+)/.test(ua)&&parseInt(ua.match(/Firefox\/(\d+)/)[1])<128;
  if(!isOldFirefox||opts.type!=='module')return opts;
  return{...opts,type:'classic'};
}
