let gitMod=null;let gitPromise=null;

async function loadGit(){
  if(!gitPromise)gitPromise=Promise.all([
    import('./vendor/esm/isomorphic-git.mjs').then(m=>m.default||m),
    import('./vendor/esm/isomorphic-git-http-web.mjs').then(m=>m.default||m).catch(()=>null),
  ]).then(([git,http])=>({git,http}));
  return gitPromise;
}

export async function preloadGit(){gitMod=await loadGit();return gitMod;}

export function makeGit(fs){
  const fsAdapter={
    promises:{
      async readFile(path,opts){try{const enc=typeof opts==='string'?opts:opts?.encoding;const d=fs.readFileSync(path);if(enc==='utf8'||enc==='utf-8')return typeof d==='string'?d:new TextDecoder().decode(d);return typeof d==='string'?new TextEncoder().encode(d):d;}catch(e){e.code='ENOENT';throw e;}},
      async writeFile(path,data){const parts=path.split('/');for(let i=1;i<parts.length;i++){const d=parts.slice(0,i).join('/');if(d&&!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});}fs.writeFileSync(path,data);},
      async unlink(path){fs.unlinkSync(path);},
      async readdir(path){return fs.readdirSync(path);},
      async mkdir(path){fs.mkdirSync(path,{recursive:true});},
      async rmdir(path){fs.rmSync?.(path,{recursive:true})||fs.unlinkSync(path);},
      async stat(path){return fs.statSync(path);},
      async lstat(path){return fs.lstatSync?.(path)||fs.statSync(path);},
      async readlink(path){return fs.readlinkSync?.(path);},
      async symlink(target,path){fs.symlinkSync?.(target,path);},
      async chmod(){},
    },
  };
  const need=()=>{if(!gitMod)throw new Error('git: call await preloadGit() once before git ops');return gitMod;};
  const wrap=method=>async opts=>{const{git,http}=need();return git[method]({fs:fsAdapter,http,...opts});};
  return{
    clone:wrap('clone'),
    init:wrap('init'),
    add:wrap('add'),
    commit:wrap('commit'),
    push:wrap('push'),
    pull:wrap('pull'),
    fetch:wrap('fetch'),
    status:wrap('status'),
    statusMatrix:wrap('statusMatrix'),
    log:wrap('log'),
    listBranches:wrap('listBranches'),
    branch:wrap('branch'),
    checkout:wrap('checkout'),
    resolveRef:wrap('resolveRef'),
    currentBranch:wrap('currentBranch'),
    remove:wrap('remove'),
    listRemotes:wrap('listRemotes'),
    addRemote:wrap('addRemote'),
    deleteRemote:wrap('deleteRemote'),
    merge:wrap('merge'),
    readBlob:wrap('readBlob'),
    readTree:wrap('readTree'),
    readCommit:wrap('readCommit'),
    tag:wrap('tag'),
    listTags:wrap('listTags'),
    diff:async opts=>{const s=await wrap('statusMatrix')(opts);return s.filter(([,,w,s])=>w!==s).map(([path])=>path);},
    preload:preloadGit,
  };
}
