const WORKER_SRC=`
self.addEventListener('message',async e=>{
  const {id,op,path,data,flags}=e.data;
  try{
    const root=await navigator.storage.getDirectory();
    const parts=path.replace(/^\\/+/,'').split('/');
    const fname=parts.pop();
    let dir=root;
    for(const p of parts){if(!p)continue;try{dir=await dir.getDirectoryHandle(p,{create:op==='write'||op==='mkdir'});}catch(err){if(op==='read'||op==='stat'||op==='delete'){self.postMessage({id,error:'ENOENT: '+path});return;}throw err;}}
    if(op==='mkdir'){await dir.getDirectoryHandle(fname,{create:true});self.postMessage({id,ok:true});return;}
    if(op==='read'){const h=await dir.getFileHandle(fname);const f=await h.getFile();const buf=new Uint8Array(await f.arrayBuffer());self.postMessage({id,data:buf},[buf.buffer]);return;}
    if(op==='write'){const h=await dir.getFileHandle(fname,{create:true});const sync=await h.createSyncAccessHandle();const bytes=data instanceof Uint8Array?data:new TextEncoder().encode(String(data));sync.truncate(0);sync.write(bytes,{at:0});sync.flush();sync.close();self.postMessage({id,ok:true});return;}
    if(op==='stat'){const h=await dir.getFileHandle(fname).catch(()=>dir.getDirectoryHandle(fname));const f=await h.getFile?.();self.postMessage({id,size:f?.size||0,mtime:f?.lastModified||0,isFile:!!f,isDirectory:!f});return;}
    if(op==='delete'){await dir.removeEntry(fname,{recursive:flags?.recursive||false});self.postMessage({id,ok:true});return;}
    if(op==='list'){const out=[];for await(const [name,h] of dir.entries())out.push({name,kind:h.kind});self.postMessage({id,entries:out});return;}
    self.postMessage({id,error:'unknown op: '+op});
  }catch(err){self.postMessage({id,error:err.message});}
});
`;

export function makeOpfsBackend(Buf){
  if(typeof navigator==='undefined'||!navigator.storage?.getDirectory)return null;
  const blob=new Blob([WORKER_SRC],{type:'application/javascript'});
  const url=URL.createObjectURL(blob);
  const worker=new Worker(url);
  const pending=new Map();let nextId=1;
  worker.addEventListener('message',e=>{const {id,...rest}=e.data;const p=pending.get(id);if(!p)return;pending.delete(id);if(rest.error)p.reject(new Error(rest.error));else p.resolve(rest);});
  const call=(op,path,data,flags)=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});worker.postMessage({id,op,path,data,flags});});
  return{
    readFile:async(path,enc)=>{const r=await call('read',path);return enc?new TextDecoder(enc==='utf-8'?'utf-8':enc).decode(r.data):Buf.from(r.data);},
    writeFile:async(path,data)=>{await call('write',path,data);},
    mkdir:async path=>{await call('mkdir',path);},
    rm:async(path,opts)=>{await call('delete',path,null,opts);},
    stat:async path=>call('stat',path),
    list:async path=>{const r=await call('list',path);return r.entries;},
    _worker:worker,
    _url:url,
  };
}

export function wireOpfsIntoFs(fs,opfs,reg){
  if(!opfs)return fs;
  const orig={readFileSync:fs.readFileSync,writeFileSync:fs.writeFileSync,existsSync:fs.existsSync,statSync:fs.statSync,mkdirSync:fs.mkdirSync,rmSync:fs.rmSync,unlinkSync:fs.unlinkSync};
  fs.promises=fs.promises||{};
  fs.promises.readFile=async(p,enc)=>opfs.readFile(p,enc).catch(()=>orig.readFileSync(p,enc));
  fs.promises.writeFile=async(p,d)=>{await opfs.writeFile(p,d).catch(()=>orig.writeFileSync(p,d));};
  fs.promises.mkdir=async(p,o)=>{await opfs.mkdir(p).catch(()=>orig.mkdirSync(p,o));};
  fs.promises.rm=async(p,o)=>{await opfs.rm(p,o).catch(()=>orig.rmSync(p,o));};
  fs.promises.stat=async p=>opfs.stat(p).catch(()=>orig.statSync(p));
  fs.promises.readdir=async p=>opfs.list(p).then(es=>es.map(e=>e.name)).catch(()=>fs.readdirSync(p));
  reg.polyfills=reg.polyfills||{};
  reg.polyfills.opfs={active:true,backing:'native',reason:'OPFS available'};
  return fs;
}
