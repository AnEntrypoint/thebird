let smMod=null;let smPromise=null;const consumers=new Map();const CAP=5;

async function loadSm(){
  if(!smPromise)smPromise=import('./vendor/esm/source-map-js.mjs').then(m=>m.default||m);
  return smPromise;
}

export async function preloadSourceMap(){smMod=await loadSm();return smMod;}

async function consumerFor(url,snapFn){
  if(consumers.has(url))return consumers.get(url);
  if(consumers.size>50){const first=consumers.keys().next().value;consumers.delete(first);}
  if(!smMod)await loadSm();
  let src='';
  try{
    if(url.startsWith('data:application/json;base64,'))src=atob(url.slice(29));
    else if(url.startsWith('data:application/json,'))src=decodeURIComponent(url.slice(22));
    else if(url.startsWith('http'))src=await (await fetch(url)).text();
    else{const snap=snapFn();const key=url.replace(/^file:\/\/\/?/,'').replace(/^\//,'');src=snap[key]||snap[key+'.map']||'';}
  }catch{return null;}
  if(!src)return null;
  try{const raw=JSON.parse(src);const c=new smMod.SourceMapConsumer(raw);consumers.set(url,c);return c;}catch{return null;}
}

function extractMapUrl(source){
  if(!source)return null;
  const m=source.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/);
  return m?m[1]:null;
}

export function installSourceMapStacks(snapFn){
  if(Error._smHooked)return;Error._smHooked=true;
  const origFormatter=Error.prepareStackTrace;
  Error.prepareStackTrace=(err,frames)=>{
    if(!smMod)return origFormatter?origFormatter(err,frames):err.toString()+'\n'+frames.map(f=>'    at '+f.toString()).join('\n');
    let depth=0;
    const mapped=frames.map(f=>{
      if(depth>=CAP)return f;
      const file=f.getFileName?.();if(!file)return f;
      const snap=snapFn();const src=snap[file.replace(/^file:\/\/\/?/,'').replace(/^\//,'')]||'';
      const mapUrl=extractMapUrl(src);if(!mapUrl)return f;
      depth++;
      const c=consumers.get(mapUrl);if(!c)return f;
      const line=f.getLineNumber?.(),col=f.getColumnNumber?.();if(!line)return f;
      try{const orig=c.originalPositionFor({line,column:col||0});if(!orig.source)return f;return{...f,getFileName:()=>orig.source,getLineNumber:()=>orig.line,getColumnNumber:()=>orig.column,getFunctionName:()=>orig.name||f.getFunctionName?.(),toString:()=>`    at ${orig.name||'<anonymous>'} (${orig.source}:${orig.line}:${orig.column})`};}catch{return f;}
    });
    return origFormatter?origFormatter(err,mapped):err.toString()+'\n'+mapped.map(f=>'    at '+(f.toString?.()||f)).join('\n');
  };
  Promise.resolve().then(async()=>{await loadSm();const snap=snapFn();for(const [key,src] of Object.entries(snap)){const mapUrl=extractMapUrl(src);if(mapUrl)await consumerFor(mapUrl,snapFn);}});
}

export function clearSourceMapCache(){consumers.clear();}
