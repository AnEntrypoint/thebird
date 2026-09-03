const ESM_API='https://esm.sh';
const cache=new Map();
// _online tracks the most recently observed network reachability across all concurrent calls.
// It is NOT per-call state: if two calls race, the last to complete overwrites the value.
// Callers that need per-call network state should inspect the thrown error's .code field
// ('NOT_FOUND' = server reachable, 'NETWORK_UNAVAILABLE' = offline/timeout).
let _online=true;

async function esmMeta(name){
  const stale=cache.has(name)?cache.get(name):null;
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),5000);
  try{
    const url=`${ESM_API}/${name}/package.json`;
    const r=await fetch(url,{signal:ac.signal});
    clearTimeout(timer);
    if(!r.ok){
      _online=true;
      const err=new Error(`registry: ${name} not found (HTTP ${r.status})`);
      err.code='NOT_FOUND';
      throw err;
    }
    const pj=await r.json();
    _online=true;
    cache.set(name,pj);return pj;
  }catch(e){
    clearTimeout(timer);
    if(e.code==='NOT_FOUND')throw e;
    // network timeout or connectivity failure — return stale cache if available
    _online=false;
    if(stale){console.warn(`[registry] network unavailable for ${name}; returning cached metadata`);return stale;}
    const err=new Error(`registry: cannot fetch ${name} — ${e.message}`);
    err.code='NETWORK_UNAVAILABLE';
    throw err;
  }
}

export function makeRegistry(){
  const reg={
    // view(spec) — requires network unless cached; throws with err.code='NOT_FOUND' or 'NETWORK_UNAVAILABLE'
    async view(spec){const[name,field]=spec.split(/\s+/);const pj=await esmMeta(name);if(field){const parts=field.split('.');let v=pj;for(const p of parts)v=v?.[p];return v;}return pj;},
    // search(q) — requires network; returns [] on any failure (network or parse error)
    async search(q){try{const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),5000);try{const r=await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`,{signal:ac.signal});clearTimeout(timer);const j=await r.json();_online=true;return j.objects?.map(o=>({name:o.package.name,version:o.package.version,description:o.package.description}))||[];}finally{clearTimeout(timer);}}catch(e){_online=false;const err=new Error(`registry: search failed for "${q}" — ${e.message}`);err.code='NETWORK_UNAVAILABLE';throw err;}},
    async deps(name,version='latest'){const pj=await esmMeta(version==='latest'?name:`${name}@${version}`);return{dependencies:pj.dependencies||{},devDependencies:pj.devDependencies||{},peerDependencies:pj.peerDependencies||{}};},
    async tarballUrl(name,version){const pj=await esmMeta(`${name}@${version}`);return`https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${pj.version}.tgz`;},
    async fetchTarball(name,version){const url=await reg.tarballUrl(name,version);const r=await fetch(url);return new Uint8Array(await r.arrayBuffer());},
    clearCache(){cache.clear();},
  };
  return reg;
}
