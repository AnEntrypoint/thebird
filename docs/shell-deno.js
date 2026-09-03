import { shortUid } from './vendor/uid.js';
function dirEntry(fs,p,name){
  // Resolve the real entry type. On stat failure, preserve the error so callers
  // can distinguish "stat succeeded and type is known" from "stat failed and type is unknown".
  // Callers MUST check isFile===true or isDirectory===true; a null value means stat failed.
  try{const st=fs.lstatSync?.(p.replace(/\/+$/,'')+'/'+name)||fs.statSync(p.replace(/\/+$/,'')+'/'+name);return{name,isFile:st.isFile(),isDirectory:st.isDirectory(),isSymlink:st.isSymbolicLink?.()||false};}
  catch(e){return{name,isFile:null,isDirectory:null,isSymlink:null,error:{code:e.code,message:e.message}};}
}
export function makeDenoGlobal(fs,proc,cpMod,httpHandlers,Buf){
  const enc=new TextEncoder(),dec=new TextDecoder();
  const readFile=async p=>fs.existsSync(p)?(typeof fs.readFileSync(p)==='string'?enc.encode(fs.readFileSync(p)):fs.readFileSync(p)):(()=>{const e=new Error('NotFound: '+p);e.code='ENOENT';throw e;})();
  return{
    // deno is the emulated Deno API level (consumed by shell-runtime detection); v8/typescript
    // are reported as 'browser' rather than fake specific versions -- there is no real V8 or tsc here.
    version:{deno:'browser-shim',v8:'browser',typescript:'browser'},
    build:{target:'wasm-unknown-browser',arch:'wasm32',os:'browser',vendor:'browser'},
    pid:proc.pid||1,ppid:0,hostname:()=>'[browser]',
    cwd:()=>proc.cwd?.()||'/',
    chdir:p=>proc.chdir?.(p),
    exit:code=>proc.exit(code||0),
    env:{get:k=>proc.env[k],set:(k,v)=>{proc.env[k]=v;},delete:k=>{delete proc.env[k];},has:k=>k in proc.env,toObject:()=>({...proc.env})},
    args:(proc.argv||[]).slice(2),
    execPath:()=>'[unavailable in browser]',
    readTextFile:async p=>{const d=await readFile(p);return typeof d==='string'?d:dec.decode(d);},
    readTextFileSync:p=>fs.readFileSync(p,'utf8'),
    readFile,
    readFileSync:p=>{const d=fs.readFileSync(p);return typeof d==='string'?enc.encode(d):d;},
    writeTextFile:async(p,d)=>fs.writeFileSync(p,d),
    writeTextFileSync:(p,d)=>fs.writeFileSync(p,d),
    writeFile:async(p,d)=>fs.writeFileSync(p,d),
    writeFileSync:(p,d)=>fs.writeFileSync(p,d),
    mkdir:async(p,opts)=>fs.mkdirSync(p,opts),
    mkdirSync:(p,opts)=>fs.mkdirSync(p,opts),
    remove:async(p,opts)=>{if(opts?.recursive)fs.rmSync(p,{recursive:true});else fs.unlinkSync(p);},
    removeSync:(p,opts)=>{if(opts?.recursive)fs.rmSync(p,{recursive:true});else fs.unlinkSync(p);},
    rename:async(o,n)=>fs.renameSync(o,n),
    renameSync:(o,n)=>fs.renameSync(o,n),
    stat:async p=>fs.statSync(p),
    statSync:p=>fs.statSync(p),
    lstat:async p=>fs.lstatSync?.(p)||fs.statSync(p),
    lstatSync:p=>fs.lstatSync?.(p)||fs.statSync(p),
    symlink:async(t,l)=>fs.symlinkSync?.(t,l),
    symlinkSync:(t,l)=>fs.symlinkSync?.(t,l),
    realPath:async p=>fs.realpathSync?.(p)||p,
    realPathSync:p=>fs.realpathSync?.(p)||p,
    readDir:async function*(p){for(const name of fs.readdirSync(p))yield dirEntry(fs,p,name);},
    readDirSync:function*(p){for(const name of fs.readdirSync(p))yield dirEntry(fs,p,name);},
    makeTempDir:async opts=>fs.mkdtempSync?.((opts?.prefix||'/tmp/deno-'))||'/tmp/deno-'+shortUid(6),
    makeTempFile:async opts=>{const p=(opts?.prefix||'/tmp/')+'deno-'+shortUid(6);fs.writeFileSync(p,'');return p;},
    serve(opts,handler){const h=typeof opts==='function'?opts:handler||opts.fetch;const port=opts.port||8000;httpHandlers[port]={routes:{GET:[{path:'/',fn:async(req,res)=>{const r=await h(new Request('http://localhost:'+port+req.url,{method:req.method,headers:req.headers}));res.statusCode=r.status;r.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await r.text());}}]}};return{shutdown:async()=>{delete httpHandlers[port];},finished:Promise.resolve()};},
    Command:class{constructor(cmd,opts={}){this.cmd=cmd;this.opts=opts;}async output(){return new Promise((resolve,reject)=>{cpMod.exec([this.cmd,...(this.opts.args||[])].join(' '),{cwd:this.opts.cwd,env:this.opts.env},(err,stdout,stderr)=>{
      // Report the real exit code. cpMod.exec calls back with err.code set to the numeric
      // exit code on non-zero exit; Deno's output() resolves with {code,success} rather
      // than throwing, so only reject when exec failed without an exit code (e.g. spawn error).
      if(err&&typeof err.code!=='number')return reject(err);
      const code=err?err.code:0;resolve({code,success:code===0,stdout:enc.encode(stdout||''),stderr:enc.encode(stderr||'')});
    });});}spawn(){return{pid:0,stdout:null,stderr:null,stdin:null,status:Promise.reject(new Error('Deno.Command.spawn(): streaming subprocess not available in browser -- use output() for one-shot command execution')),kill:()=>{}};} },
    // Simulated permissions: the browser sandbox is the real boundary; this shim cannot enforce
    // denials. All operations return 'granted' because the browser sandbox always allows sandboxed
    // operations and never prompts the user -- 'prompt' would falsely imply user interaction occurs.
    permissions:{query:async d=>({state:'granted',onchange:null,partial:false}),request:async d=>({state:'granted'}),revoke:async d=>({state:'granted'})},
    errors:{NotFound:class extends Error{constructor(m){super(m);this.name='NotFound';}},PermissionDenied:class extends Error{constructor(m){super(m);this.name='PermissionDenied';}},AlreadyExists:class extends Error{constructor(m){super(m);this.name='AlreadyExists';}}},
    inspect:v=>JSON.stringify(v,null,2),
    noColor:false,isatty:()=>!!proc.stdout?.isTTY,
    addSignalListener(sig,fn){proc.on(sig,fn);},removeSignalListener(sig,fn){proc.off?.(sig,fn);},
    stdin:{readable:new ReadableStream({start(c){proc.stdin?.on?.('data',d=>c.enqueue(typeof d==='string'?new TextEncoder().encode(d):d));proc.stdin?.on?.('end',()=>c.close());}}),readSync(){return 0;},read:async buf=>0,rid:0,isTerminal:()=>!!proc.stdin?.isTTY},
    stdout:{writable:new WritableStream({write(c){proc.stdout.write(typeof c==='string'?c:new TextDecoder().decode(c));}}),writeSync:d=>{proc.stdout.write(typeof d==='string'?d:new TextDecoder().decode(d));return d.length;},write:async d=>d.length,rid:1,isTerminal:()=>!!proc.stdout?.isTTY},
    stderr:{writable:new WritableStream({write(c){proc.stderr.write(typeof c==='string'?c:new TextDecoder().decode(c));}}),writeSync:d=>{proc.stderr.write(typeof d==='string'?d:new TextDecoder().decode(d));return d.length;},write:async d=>d.length,rid:2,isTerminal:()=>!!proc.stderr?.isTTY},
    memoryUsage:()=>proc.memoryUsage(),
    resources:()=>({}),close:rid=>{},
    refTimer:t=>t?.ref?.(),unrefTimer:t=>t?.unref?.(),
  };
}
