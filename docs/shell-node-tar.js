const BLOCK=512;
const readStr=(buf,o,len)=>{let e=o;while(e<o+len&&buf[e]!==0)e++;return new TextDecoder().decode(buf.slice(o,e));};
const readOctal=(buf,o,len)=>{const s=readStr(buf,o,len).trim();return s?parseInt(s,8):0;};

export function untar(data){
  const buf=data instanceof Uint8Array?data:new Uint8Array(data);
  const entries=[];let off=0;let longName=null;let zeroRun=0;
  while(off+BLOCK<=buf.length){
    const isZeroBlock=buf.subarray(off,off+BLOCK).every(b=>b===0);
    if(isZeroBlock){
      zeroRun++;
      off+=BLOCK;
      if(zeroRun>=2)break; // POSIX EOF: two consecutive all-zero blocks
      continue;
    }
    zeroRun=0;
    const name=readStr(buf,off,100);
    if(!name)break;
    const mode=readOctal(buf,off+100,8);
    const size=readOctal(buf,off+124,12);
    const mtime=readOctal(buf,off+136,12);
    const type=String.fromCharCode(buf[off+156]||0x30);
    const prefix=readStr(buf,off+345,155);
    const fullName=longName||(prefix?prefix+'/'+name:name);
    const dataStart=off+BLOCK;
    const dataEnd=dataStart+size;
    const padded=Math.ceil(size/BLOCK)*BLOCK;
    if(dataEnd>buf.length){
      // malformed/truncated header: claimed size exceeds the buffer, so the
      // body cannot be read. Record a null-data entry instead of silently
      // returning a slice() that truncates to the buffer end.
      entries.push({name:fullName,mode,size:0,mtime,type,data:null,truncated:true});
      off=dataStart+padded;
      longName=null;
      continue;
    }
    if(type==='L'){
      // GNU longname header: body is the real (null-terminated) path that
      // applies to the immediately following entry. Do not emit this as a
      // real entry -- carry the resolved name forward instead.
      longName=readStr(buf,dataStart,size);
      off=dataStart+padded;
      continue;
    }
    const body=type==='0'||type==='\0'?buf.slice(dataStart,dataEnd):null;
    entries.push({name:fullName,mode,size,mtime,type,data:body});
    off=dataStart+padded;
    longName=null;
  }
  return entries;
}

export function makeTar(fs,fflate,Buf){
  return{
    async extract(data,dest='/'){
      let bytes=data instanceof Uint8Array?data:new Uint8Array(data);
      if(bytes[0]===0x1f&&bytes[1]===0x8b){bytes=fflate?.gunzipSync?fflate.gunzipSync(bytes):bytes;}
      const entries=untar(bytes);
      const out=[];
      for(const e of entries){
        if(e.truncated){const err=new Error('Truncated tar entry: '+e.name);err.partial=out;throw err;}
        if(e.type==='1'||e.type==='2'){const err=new Error('Unsupported tar entry type: '+(e.type==='1'?'hardlink':'symlink')+' for '+e.name+' -- IDB fs has no symlink primitive');err.partial=out;throw err;}
        if(!e.data&&e.type!=='5')continue;
        // reject path traversal: absolute names or any '..' path segment would
        // escape dest (e.name already includes the tar prefix field).
        const segs=e.name.split(/[\\/]/);
        if(e.name.startsWith('/')||segs.some(s=>s==='..'))throw new Error('Path traversal rejected: '+e.name);
        const target=(dest.replace(/\/$/,'')+'/'+e.name).replace(/^\/+/,'/');
        if(e.type==='5'){try{fs.mkdirSync(target,{recursive:true});}catch{/* swallow: directory entry already exists (recursive mkdir is idempotent) */}}
        else{const parts=target.split('/');for(let i=1;i<parts.length;i++){const d=parts.slice(0,i).join('/');if(d&&!fs.existsSync(d)){try{fs.mkdirSync(d,{recursive:true});}catch{/* swallow: parent dir already created by a prior entry (race on recursive mkdir) */}}}fs.writeFileSync(target,Buf.from(e.data));}
        out.push(target);
      }
      return out;
    },
    async list(data){let bytes=data instanceof Uint8Array?data:new Uint8Array(data);if(bytes[0]===0x1f&&bytes[1]===0x8b)bytes=fflate?.gunzipSync?fflate.gunzipSync(bytes):bytes;return untar(bytes).filter(e=>!e.truncated).map(e=>e.name);},
    untar,
  };
}
