export function makeBunGlobal(fs,proc,cpMod,httpHandlers,Buf,streamMod,cryptoMod){
  const enc=new TextEncoder(),dec=new TextDecoder();
  const fileHandle=p=>({
    async text(){return fs.readFileSync(p,'utf8');},
    async arrayBuffer(){const d=fs.readFileSync(p);const u=typeof d==='string'?enc.encode(d):d;return u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength);},
    async json(){return JSON.parse(fs.readFileSync(p,'utf8'));},
    async bytes(){const d=fs.readFileSync(p);return typeof d==='string'?enc.encode(d):d;},
    stream(){const s=new streamMod.Readable();s.push(fs.readFileSync(p));s.push(null);return s;},
    get size(){return fs.statSync(p).size;},
    get type(){return 'application/octet-stream';},
    get name(){return p.split('/').pop();},
    exists:()=>fs.existsSync(p),
    writer(){return{write:d=>fs.writeFileSync(p,d),end(){}};},
    slice(start,end){const h=fileHandle(p);return{...h,async bytes(){const d=await h.bytes();return d.slice(start,end);},async text(){const d=await h.bytes();return dec.decode(d.slice(start,end));},async arrayBuffer(){const d=await h.bytes();const sl=d.slice(start,end);return sl.buffer.slice(sl.byteOffset,sl.byteOffset+sl.byteLength);}};},
  });
  const shell=strings=>{const cmd=typeof strings==='string'?strings:strings.raw.join(' ');return new Promise((resolve,reject)=>{cpMod.exec(cmd,{},(err,stdout,stderr)=>{resolve({stdout:enc.encode(stdout),stderr:enc.encode(stderr||''),exitCode:err?.code||0,text:()=>stdout,json:()=>JSON.parse(stdout),lines(){return stdout.split('\n');}});});});};
  shell.cwd=()=>proc.cwd?.();shell.env=proc.env;shell.nothrow=()=>shell;
  return{
    version:'1.2.0',revision:null,env:proc.env,argv:proc.argv||['bun'],main:proc.argv?.[1]||'',
    file:fileHandle,
    write(dest,input){const p=typeof dest==='string'?dest:dest.name;fs.writeFileSync(p,typeof input==='string'?input:input instanceof Uint8Array?input:input.toString?.()||String(input));return Promise.resolve(typeof input==='string'?input.length:input.byteLength||0);},
    serve(opts){const port=opts.port||3000;const handler=opts.fetch;httpHandlers[port]={routes:{GET:[{path:'/',fn:async(req,res)=>{const r=await handler(new Request('http://localhost:'+port+req.url,{method:req.method,headers:req.headers,body:req.body}));res.statusCode=r.status;r.headers.forEach((v,k)=>res.setHeader(k,v));const body=await r.text();res.end(body);}}]}};return{port,stop:()=>{delete httpHandlers[port];},hostname:'localhost',development:false,pendingRequests:0};},
    listen:function(opts){return this.serve(opts);},
    spawn(opts){const cmd=Array.isArray(opts.cmd)?opts.cmd.join(' '):opts.cmd;return new Promise((resolve,reject)=>{cpMod.exec(cmd,{cwd:opts.cwd,env:opts.env},(err,stdout,stderr)=>{resolve({exited:Promise.resolve(err?.code||0),exitCode:err?.code||0,pid:1,stdout:{text:()=>stdout},stderr:{text:()=>stderr},kill(){throw new Error('Bun.spawn shim: kill() unsupported, process already completed by the time this Promise resolved');}});});});},
    spawnSync(opts){throw new Error('Bun.spawnSync: synchronous subprocess not available in browser — use Bun.spawn');},
    $:shell,
    sleep:ms=>new Promise(r=>setTimeout(r,ms)),sleepSync:()=>{throw new Error('Bun.sleepSync: sync sleep blocks event loop — use await Bun.sleep');},
    hash:{wyhash:s=>{let h=5381n;for(const c of String(s))h=((h<<5n)+h)^BigInt(c.charCodeAt(0));return h&0xffffffffffffffffn;}},
    password:{hash:async p=>{if(!cryptoMod.pbkdf2Sync)throw new Error('Bun.password.hash: crypto.pbkdf2Sync unavailable');return String.fromCharCode(...cryptoMod.pbkdf2Sync(p,'bun-salt',10000,32,'sha256'));},verify:async(p,h)=>{if(!cryptoMod.pbkdf2Sync)throw new Error('Bun.password.verify: crypto.pbkdf2Sync unavailable');const computed=String.fromCharCode(...cryptoMod.pbkdf2Sync(p,'bun-salt',10000,32,'sha256'));const a=String(computed),b=String(h),maxLen=Math.max(a.length,b.length);let diff=0;for(let i=0;i<maxLen;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}},
    gzipSync:b=>{throw new Error('Bun.gzipSync: not available in browser — use vendored fflate or Node.js Bun runtime');},gunzipSync:b=>{throw new Error('Bun.gunzipSync: not available in browser — use vendored fflate or Node.js Bun runtime');},
    inspect:v=>JSON.stringify(v,null,2),
    nanoseconds:()=>BigInt(Math.floor(performance.now()*1e6)),
    which:cmd=>{throw new Error('Bun.which: executable lookup not available in browser — no PATH environment');},
    pathToFileURL:p=>new URL('file://'+p),fileURLToPath:u=>String(u).replace(/^file:\/\//,''),
    enableANSIColors:true,isMainThread:true,
    deepEquals:(a,b)=>{const eq=(x,y)=>{if(x===y)return true;if(Number.isNaN(x)&&Number.isNaN(y))return true;if(x==null||y==null||typeof x!=='object'||typeof y!=='object')return false;const ka=Object.keys(x),kb=Object.keys(y);if(ka.length!==kb.length)return false;for(const k of ka)if(!Object.prototype.hasOwnProperty.call(y,k)||!eq(x[k],y[k]))return false;return true;};return eq(a,b);},
    stringWidth:s=>String(s).length,
    resolveSync:(id,root)=>{throw new Error('Bun.resolveSync: module resolution not available in browser');},resolve:async(id,root)=>{throw new Error('Bun.resolve: module resolution not available in browser');},
    TOML:{parse:s=>{const o={};for(const line of s.split('\n')){const m=line.match(/^(\w+)\s*=\s*(.+)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;},stringify:o=>Object.entries(o).map(([k,v])=>`${k} = ${typeof v==='string'?'"'+v+'"':v}`).join('\n')},
    color:(c,t)=>`<${c}>${t}</${c}>`,
    stdin:{stream(){const s=new streamMod.Readable();proc.stdin?.on?.('data',d=>s.push(d));proc.stdin?.on?.('end',()=>s.push(null));return s;},async text(){return new Promise(r=>{let b='';proc.stdin?.on?.('data',d=>b+=d);proc.stdin?.on?.('end',()=>r(b));});}},
    stdout:{writer(){return{write:d=>proc.stdout.write(d),end(){}};}},
    stderr:{writer(){return{write:d=>proc.stderr.write(d),end(){}};}},
  };
}
