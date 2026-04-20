const DOH='https://cloudflare-dns.com/dns-query';
const DOH_FALLBACK='https://dns.google/resolve';

async function query(name,type='A'){
  const TYPES={A:1,AAAA:28,MX:15,TXT:16,NS:2,CNAME:5,SOA:6,PTR:12,SRV:33};
  const t=TYPES[type]||1;
  try{
    const r=await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${t}`,{headers:{accept:'application/dns-json'}});
    const j=await r.json();
    return j.Answer||[];
  }catch{
    const r=await fetch(`${DOH_FALLBACK}?name=${encodeURIComponent(name)}&type=${t}`);
    const j=await r.json();
    return j.Answer||[];
  }
}

export function makeDns(){
  const extract=(answers,want)=>answers.filter(a=>a.type===want).map(a=>a.data.replace(/^"|"$/g,''));
  return{
    promises:{
      async resolve(name,type='A'){const a=await query(name,type);return extract(a,{A:1,AAAA:28,CNAME:5,NS:2,TXT:16,MX:15,PTR:12,SRV:33,SOA:6}[type]);},
      async resolve4(name){return this.resolve(name,'A');},
      async resolve6(name){return this.resolve(name,'AAAA');},
      async resolveMx(name){const a=await query(name,'MX');return extract(a,15).map(s=>{const[priority,exchange]=s.split(' ');return{priority:+priority,exchange};});},
      async resolveTxt(name){const a=await query(name,'TXT');return extract(a,16).map(s=>[s]);},
      async resolveCname(name){return this.resolve(name,'CNAME');},
      async resolveNs(name){return this.resolve(name,'NS');},
      async resolveSrv(name){const a=await query(name,'SRV');return extract(a,33).map(s=>{const[priority,weight,port,name]=s.split(' ');return{priority:+priority,weight:+weight,port:+port,name};});},
      async reverse(ip){const rev=ip.includes(':')?ip:ip.split('.').reverse().join('.')+'.in-addr.arpa';const a=await query(rev,'PTR');return extract(a,12);},
      async lookup(hostname,opts={}){if(hostname==='localhost')return{address:'127.0.0.1',family:4};const t=opts.family===6?'AAAA':'A';const results=await query(hostname,t);if(!results.length)throw Object.assign(new Error('getaddrinfo ENOTFOUND '+hostname),{code:'ENOTFOUND',hostname});return{address:results[0].data,family:opts.family===6?6:4};},
      async lookupService(ip,port){return{hostname:ip,service:String(port)};},
      getServers(){return['1.1.1.1','8.8.8.8'];},
      setServers(){},
    },
    get resolve(){const p=this.promises;return(name,type,cb)=>{if(typeof type==='function'){cb=type;type='A';}p.resolve(name,type).then(r=>cb(null,r),cb);};},
    lookup:(h,o,cb)=>{if(typeof o==='function'){cb=o;o={};}query(h,o.family===6?'AAAA':'A').then(a=>a.length?cb(null,a[0].data,o.family===6?6:4):cb(Object.assign(new Error('ENOTFOUND'),{code:'ENOTFOUND'})),cb);},
    ADDRCONFIG:0x20,V4MAPPED:0x8,ALL:0x10,
    NODATA:'ENODATA',FORMERR:'EFORMERR',SERVFAIL:'ESERVFAIL',NOTFOUND:'ENOTFOUND',
  };
}
