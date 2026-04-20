const ESM_API='https://esm.sh';
const cache=new Map();

async function esmMeta(name){
  if(cache.has(name))return cache.get(name);
  try{
    const url=`${ESM_API}/${name}/package.json`;
    const r=await fetch(url);
    if(!r.ok)throw new Error('not found');
    const pj=await r.json();
    cache.set(name,pj);return pj;
  }catch(e){throw new Error(`registry: cannot fetch ${name} — ${e.message}`);}
}

export function makeRegistry(){
  return{
    async view(spec){const[name,field]=spec.split(/\s+/);const pj=await esmMeta(name);if(field){const parts=field.split('.');let v=pj;for(const p of parts)v=v?.[p];return v;}return pj;},
    async search(q){try{const r=await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`);const j=await r.json();return j.objects?.map(o=>({name:o.package.name,version:o.package.version,description:o.package.description}))||[];}catch{return[];}},
    async deps(name,version='latest'){try{const pj=await esmMeta(version==='latest'?name:`${name}@${version}`);return{dependencies:pj.dependencies||{},devDependencies:pj.devDependencies||{},peerDependencies:pj.peerDependencies||{}};}catch{return{dependencies:{},devDependencies:{},peerDependencies:{}};}},
    async tarballUrl(name,version){const pj=await esmMeta(`${name}@${version}`);return`https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${pj.version}.tgz`;},
    async fetchTarball(name,version){const url=await this.tarballUrl(name,version);const r=await fetch(url);return new Uint8Array(await r.arrayBuffer());},
    clearCache(){cache.clear();},
  };
}
