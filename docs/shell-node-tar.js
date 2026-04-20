const BLOCK=512;
const readStr=(buf,o,len)=>{let e=o;while(e<o+len&&buf[e]!==0)e++;return new TextDecoder().decode(buf.slice(o,e));};
const readOctal=(buf,o,len)=>{const s=readStr(buf,o,len).trim();return s?parseInt(s,8):0;};

export function untar(data){
  const buf=data instanceof Uint8Array?data:new Uint8Array(data);
  const entries=[];let off=0;
  while(off+BLOCK<=buf.length){
    if(buf[off]===0&&buf[off+BLOCK-1]===0){off+=BLOCK;continue;}
    const name=readStr(buf,off,100);
    if(!name)break;
    const mode=readOctal(buf,off+100,8);
    const size=readOctal(buf,off+124,12);
    const mtime=readOctal(buf,off+136,12);
    const type=String.fromCharCode(buf[off+156]||0x30);
    const prefix=readStr(buf,off+345,155);
    const fullName=prefix?prefix+'/'+name:name;
    const dataStart=off+BLOCK;
    const dataEnd=dataStart+size;
    const body=type==='0'||type==='\0'?buf.slice(dataStart,dataEnd):null;
    entries.push({name:fullName,mode,size,mtime,type,data:body});
    const padded=Math.ceil(size/BLOCK)*BLOCK;
    off=dataStart+padded;
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
        if(!e.data&&e.type!=='5')continue;
        const target=(dest.replace(/\/$/,'')+'/'+e.name).replace(/^\/+/,'/');
        if(e.type==='5'){try{fs.mkdirSync(target,{recursive:true});}catch{}}
        else{const parts=target.split('/');for(let i=1;i<parts.length;i++){const d=parts.slice(0,i).join('/');if(d&&!fs.existsSync(d)){try{fs.mkdirSync(d,{recursive:true});}catch{}}}fs.writeFileSync(target,Buf.from(e.data));}
        out.push(target);
      }
      return out;
    },
    async list(data){let bytes=data instanceof Uint8Array?data:new Uint8Array(data);if(bytes[0]===0x1f&&bytes[1]===0x8b)bytes=fflate?.gunzipSync?fflate.gunzipSync(bytes):bytes;return untar(bytes).map(e=>e.name);},
    untar,
  };
}
