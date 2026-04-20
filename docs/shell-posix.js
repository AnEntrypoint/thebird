const SYMLOOP_MAX=40;
const S_IFREG=0o100000,S_IFDIR=0o040000,S_IFLNK=0o120000,S_IFIFO=0o010000,S_IFMT=0o170000;
const isMeta=v=>v!==null&&typeof v==='object'&&!ArrayBuffer.isView(v)&&(v.__symlink||v.__fifo||('data' in v&&'mode' in v));
const unwrapData=v=>isMeta(v)?v.data:v;
const toKey=p=>p.replace(/^\//,'');
let nextIno=1;const inodes=new Map();

export function installPosixFs(fs,Buf,ctx){
  const snap=()=>globalThis.window?.__debug?.idbSnapshot||{};
  const persist=()=>globalThis.window?.__debug?.idbPersist?.();
  const newIno=()=>++nextIno;
  const ensureInode=(key,s)=>{let e=s[key];if(!isMeta(e)){s[key]={data:e==null?'':e,mode:0o100644,ino:newIno(),nlink:1,uid:0,gid:0,atime:Date.now(),mtime:Date.now(),ctime:Date.now(),birthtime:Date.now()};e=s[key];}return e;};

  const resolveLink=(p,depth=0)=>{
    if(depth>SYMLOOP_MAX){const e=new Error('ELOOP: '+p);e.code='ELOOP';throw e;}
    const key=toKey(p);const entry=snap()[key];
    if(isMeta(entry)&&entry.__symlink){const tgt=entry.__symlink.startsWith('/')?entry.__symlink:p.replace(/[^/]+$/,'')+entry.__symlink;return resolveLink(tgt,depth+1);}
    return p;
  };

  const origRead=fs.readFileSync,origWrite=fs.writeFileSync,origStat=fs.statSync,origExists=fs.existsSync,origRm=fs.unlinkSync;
  fs.readFileSync=(p,enc)=>{const real=resolveLink(p);const entry=snap()[toKey(real)];if(entry==null){const e=new Error('ENOENT: '+p);e.code='ENOENT';throw e;}const data=unwrapData(entry);return enc?(typeof data==='string'?data:new TextDecoder(enc==='utf-8'?'utf-8':enc).decode(data)):(typeof data==='string'?data:Buf.from(data));};
  fs.writeFileSync=(p,data,opts)=>{const real=resolveLink(p);const s=snap();const key=toKey(real);const mode=S_IFREG|((typeof opts?.mode==='number'?opts.mode:0o666)&~(ctx.umask||0o022));const existing=s[key];if(isMeta(existing)&&!existing.__symlink){existing.data=data;existing.mtime=Date.now();existing.ctime=Date.now();}else if(isMeta(existing)){existing.data=data;}else{s[key]={data,mode,ino:newIno(),nlink:1,uid:0,gid:0,atime:Date.now(),mtime:Date.now(),ctime:Date.now(),birthtime:Date.now()};}persist();};
  fs.existsSync=p=>{try{const real=resolveLink(p);const key=toKey(real);const s=snap();return key in s||Object.keys(s).some(k=>k.startsWith(key+'/'));}catch{return false;}};
  fs.statSync=p=>{const real=resolveLink(p);const s=snap();const key=toKey(real);const entry=s[key];const hasDirChildren=Object.keys(s).some(k=>k.startsWith(key+'/'));if(entry==null){if(hasDirChildren)return makeStats({mode:S_IFDIR|0o755,ino:newIno(),size:0});const e=new Error('ENOENT: '+p);e.code='ENOENT';throw e;}if(isMeta(entry)){const m=entry.mode||S_IFREG|0o644;return makeStats({...entry,mode:m,size:typeof entry.data==='string'?entry.data.length:entry.data?.byteLength||0});}return makeStats({mode:S_IFREG|0o644,ino:newIno(),size:typeof entry==='string'?entry.length:entry?.byteLength||0});};
  fs.lstatSync=p=>{const s=snap();const entry=s[toKey(p)];if(entry==null){if(!origExists(p)){const e=new Error('ENOENT: '+p);e.code='ENOENT';throw e;}return makeStats({mode:S_IFDIR|0o755,ino:newIno(),size:0});}if(isMeta(entry)&&entry.__symlink)return makeStats({mode:S_IFLNK|0o777,ino:newIno(),size:entry.__symlink.length});return fs.statSync(p);};
  fs.readlinkSync=p=>{const entry=snap()[toKey(p)];if(!isMeta(entry)||!entry.__symlink){const e=new Error('EINVAL: '+p);e.code='EINVAL';throw e;}return entry.__symlink;};
  fs.symlinkSync=(target,path)=>{snap()[toKey(path)]={__symlink:target,mode:S_IFLNK|0o777,ino:newIno()};persist();};
  fs.linkSync=(src,dst)=>{const s=snap();const entry=ensureInode(toKey(resolveLink(src)),s);s[toKey(dst)]={...entry,nlink:(entry.nlink||1)+1};entry.nlink=(entry.nlink||1)+1;persist();};
  fs.unlinkSync=p=>{const key=toKey(p);const s=snap();const entry=s[key];if(entry==null){const e=new Error('ENOENT: '+p);e.code='ENOENT';throw e;}delete s[key];persist();};
  fs.chmodSync=(p,mode)=>{const real=resolveLink(p);const entry=ensureInode(toKey(real),snap());entry.mode=(entry.mode&S_IFMT)|(mode&0o7777);entry.ctime=Date.now();persist();};
  fs.realpathSync=p=>resolveLink(p);
  fs.realpathSync.native=fs.realpathSync;
  fs.cpSync=(src,dst,opts={})=>{const sKey=toKey(src),dKey=toKey(dst);const s=snap();const entry=s[sKey];if(entry!=null){s[dKey]=isMeta(entry)?{...entry,ino:newIno(),nlink:1}:entry;}if(opts.recursive){for(const k of Object.keys(s))if(k.startsWith(sKey+'/')){const rel=k.slice(sKey.length);const sub=s[k];s[dKey+rel]=isMeta(sub)?{...sub,ino:newIno(),nlink:1}:sub;}}persist();};
  fs.constants=fs.constants||{};Object.assign(fs.constants,{S_IFREG,S_IFDIR,S_IFLNK,S_IFIFO,S_IFMT,S_IXUSR:0o100,S_IWUSR:0o200,S_IRUSR:0o400,O_RDONLY:0,O_WRONLY:1,O_RDWR:2,O_CREAT:64,O_EXCL:128,O_TRUNC:512,O_APPEND:1024});
  return fs;
}

function makeStats(o){
  const mode=o.mode||0o100644;
  return{
    dev:1,ino:o.ino||0,mode,nlink:o.nlink||1,uid:o.uid||0,gid:o.gid||0,rdev:0,size:o.size||0,blksize:4096,blocks:Math.ceil((o.size||0)/512),
    atimeMs:o.atime||Date.now(),mtimeMs:o.mtime||Date.now(),ctimeMs:o.ctime||Date.now(),birthtimeMs:o.birthtime||Date.now(),
    atime:new Date(o.atime||Date.now()),mtime:new Date(o.mtime||Date.now()),ctime:new Date(o.ctime||Date.now()),birthtime:new Date(o.birthtime||Date.now()),
    isFile(){return(mode&S_IFMT)===S_IFREG;},
    isDirectory(){return(mode&S_IFMT)===S_IFDIR;},
    isSymbolicLink(){return(mode&S_IFMT)===S_IFLNK;},
    isFIFO(){return(mode&S_IFMT)===S_IFIFO;},
    isBlockDevice(){return false;},isCharacterDevice(){return false;},isSocket(){return false;},
  };
}

export function installFds(fs,Buf){
  const fdTable=new Map();let nextFd=3;
  fs.openSync=(p,flags='r',mode=0o644)=>{const f=nextFd++;const exists=fs.existsSync(p);if(flags.includes('x')&&exists){const e=new Error('EEXIST: '+p);e.code='EEXIST';throw e;}if((flags.includes('w')||flags.includes('a'))&&!exists)fs.writeFileSync(p,'');if(flags.includes('w')&&exists)fs.writeFileSync(p,'');fdTable.set(f,{path:p,flags,position:flags.includes('a')?(fs.statSync(p).size):0,mode});return f;};
  fs.closeSync=fd=>{fdTable.delete(fd);};
  fs.readSync=(fd,buf,offset,length,position)=>{const e=fdTable.get(fd);if(!e)throw Object.assign(new Error('EBADF'),{code:'EBADF'});const data=fs.readFileSync(e.path);const bytes=typeof data==='string'?new TextEncoder().encode(data):data;const pos=position==null?e.position:position;const n=Math.min(length,bytes.length-pos);for(let i=0;i<n;i++)buf[offset+i]=bytes[pos+i];if(position==null)e.position+=n;return n;};
  fs.writeSync=(fd,buf,offset,length,position)=>{const e=fdTable.get(fd);if(!e)throw Object.assign(new Error('EBADF'),{code:'EBADF'});const existing=fs.existsSync(e.path)?fs.readFileSync(e.path):'';const existingBytes=typeof existing==='string'?new TextEncoder().encode(existing):existing;const pos=position==null?e.position:position;const slice=buf.slice(offset||0,(offset||0)+(length||buf.length));const out=new Uint8Array(Math.max(existingBytes.length,pos+slice.length));out.set(existingBytes);out.set(slice,pos);fs.writeFileSync(e.path,Buf.from(out));if(position==null)e.position=pos+slice.length;return slice.length;};
  fs.fstatSync=fd=>{const e=fdTable.get(fd);return fs.statSync(e.path);};
  fs.fsyncSync=()=>{};fs.ftruncateSync=(fd,len=0)=>{const e=fdTable.get(fd);const cur=fs.readFileSync(e.path);const bytes=typeof cur==='string'?new TextEncoder().encode(cur):cur;fs.writeFileSync(e.path,Buf.from(bytes.slice(0,len)));};
  return fs;
}

export function installTmpAndMisc(fs,Buf,ctx){
  const snap=()=>globalThis.window?.__debug?.idbSnapshot||{};
  fs.mkdtempSync=prefix=>{const suffix=Math.random().toString(36).slice(2,8);const p=prefix+suffix;fs.mkdirSync(p);return p;};
  fs.mkfifoSync=p=>{snap()[p.replace(/^\//,'')]={__fifo:{buf:[],readers:[],writers:[]},mode:0o010644,ino:0};};
  ctx.umask=ctx.umask||0o022;
  return fs;
}
