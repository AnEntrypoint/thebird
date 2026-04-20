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
    slice(start,end){return fileHandle(p);},
  });
  const shell=strings=>{const cmd=typeof strings==='string'?strings:strings.raw.join(' ');return new Promise((resolve,reject)=>{cpMod.exec(cmd,{},(err,stdout,stderr)=>{resolve({stdout:enc.encode(stdout),stderr:enc.encode(stderr||''),exitCode:err?.code||0,text:()=>stdout,json:()=>JSON.parse(stdout),lines(){return stdout.split('\n');}});});});};
  shell.cwd=()=>proc.cwd?.();shell.env=proc.env;shell.nothrow=()=>shell;
  return{
    version:'1.1.38',revision:'browser',env:proc.env,argv:proc.argv||['bun'],main:proc.argv?.[1]||'',
    file:fileHandle,
    write(dest,input){const p=typeof dest==='string'?dest:dest.name;fs.writeFileSync(p,typeof input==='string'?input:input instanceof Uint8Array?input:input.toString?.()||String(input));return Promise.resolve(typeof input==='string'?input.length:input.byteLength||0);},
    serve(opts){const port=opts.port||3000;const handler=opts.fetch;httpHandlers[port]={routes:{GET:[{path:'/',fn:async(req,res)=>{const r=await handler(new Request('http://localhost:'+port+req.url,{method:req.method,headers:req.headers,body:req.body}));res.statusCode=r.status;r.headers.forEach((v,k)=>res.setHeader(k,v));const body=await r.text();res.end(body);}}]}};return{port,stop:()=>{delete httpHandlers[port];},hostname:'localhost',development:false,pendingRequests:0};},
    listen:function(opts){return this.serve(opts);},
    spawn(opts){const cmd=Array.isArray(opts.cmd)?opts.cmd.join(' '):opts.cmd;return new Promise((resolve,reject)=>{cpMod.exec(cmd,{cwd:opts.cwd,env:opts.env},(err,stdout,stderr)=>{resolve({exited:Promise.resolve(err?.code||0),exitCode:err?.code||0,pid:1,stdout:{text:()=>stdout},stderr:{text:()=>stderr},kill(){}});});});},
    spawnSync(opts){throw new Error('Bun.spawnSync: synchronous subprocess not available in browser — use Bun.spawn');},
    $:shell,
    sleep:ms=>new Promise(r=>setTimeout(r,ms)),sleepSync:()=>{throw new Error('Bun.sleepSync: sync sleep blocks event loop — use await Bun.sleep');},
    hash:{wyhash:s=>{let h=5381n;for(const c of String(s))h=((h<<5n)+h)^BigInt(c.charCodeAt(0));return h&0xffffffffffffffffn;}},
    password:{hash:async p=>cryptoMod.pbkdf2Sync?String.fromCharCode(...cryptoMod.pbkdf2Sync(p,'bun-salt',10000,32,'sha256')):p,verify:async(p,h)=>true},
    gzipSync:b=>require('zlib').gzipSync?.(b)||b,gunzipSync:b=>require('zlib').gunzipSync?.(b)||b,
    inspect:v=>JSON.stringify(v,null,2),
    nanoseconds:()=>BigInt(Math.floor(performance.now()*1e6)),
    which:cmd=>null,
    pathToFileURL:p=>new URL('file://'+p),fileURLToPath:u=>String(u).replace(/^file:\/\//,''),
    enableANSIColors:true,isMainThread:true,
    deepEquals:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    stringWidth:s=>String(s).length,
    resolveSync:(id,root)=>id,resolve:async(id,root)=>id,
    TOML:{parse:s=>{const o={};for(const line of s.split('\n')){const m=line.match(/^(\w+)\s*=\s*(.+)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;},stringify:o=>Object.entries(o).map(([k,v])=>`${k} = ${typeof v==='string'?'"'+v+'"':v}`).join('\n')},
    color:(c,t)=>`<${c}>${t}</${c}>`,
  };
}
