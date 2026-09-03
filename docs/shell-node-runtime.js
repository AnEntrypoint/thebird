export function makeWorkerThreads(snap,Buf){
  class Worker{
    constructor(scriptPath,opts={}){
      const key=scriptPath.replace(/^\.?\//,'');
      const src=snap()[key];
      if(src===undefined)throw new Error('Worker script not found: '+scriptPath);
      const preamble=`const workerData=${JSON.stringify(opts.workerData||null)};const parentPort={postMessage:(m,t)=>self.postMessage(m,t),on:(ev,fn)=>{if(ev==='message')self.addEventListener('message',e=>fn(e.data));if(ev==='close')self.addEventListener('close',fn);},close:()=>self.close()};`;
      const blob=new Blob([preamble+'\n'+src],{type:'application/javascript'});
      this._url=URL.createObjectURL(blob);
      this._worker=new globalThis.Worker(this._url,{type:'module'});
      this._handlers={message:[],error:[],exit:[],online:[]};
      this._worker.addEventListener('message',e=>{for(const f of this._handlers.message)f(e.data);});
      this._worker.addEventListener('error',e=>{for(const f of this._handlers.error)f(e);});
      queueMicrotask(()=>{for(const f of this._handlers.online)f();});
      this.threadId=Math.floor(Math.random()*1e9);
    }
    on(ev,fn){(this._handlers[ev]=this._handlers[ev]||[]).push(fn);return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a);};return this.on(ev,w);}
    off(ev,fn){this._handlers[ev]=(this._handlers[ev]||[]).filter(x=>x!==fn);return this;}
    postMessage(msg,transfer){this._worker.postMessage(msg,transfer);}
    terminate(){this._worker.terminate();URL.revokeObjectURL(this._url);for(const f of this._handlers.exit)f(0);return Promise.resolve(0);}
    ref(){return this;}
    unref(){return this;}
  }
  return{
    Worker,
    isMainThread:true,
    parentPort:null,
    workerData:null,
    threadId:0,
    MessageChannel:globalThis.MessageChannel,
    MessagePort:globalThis.MessagePort,
    BroadcastChannel:globalThis.BroadcastChannel,
    SHARE_ENV:Symbol('SHARE_ENV'),
    setEnvironmentData(){},
    getEnvironmentData(){},
    markAsUntransferable(){},
    moveMessagePortToContext(){throw new Error('moveMessagePortToContext: not supported');},
    resourceLimits:{maxOldGenerationSizeMb:0,maxYoungGenerationSizeMb:0,codeRangeSizeMb:0,stackSizeMb:0},
  };
}

export function makeChildProcessReal(Buf,streamMod){
  const getWc=()=>globalThis.__webcontainer||window.__webcontainer||null;
  const mkProc=async(cmd,args,opts={})=>{const wc=getWc();if(!wc)throw new Error('child_process: WebContainer not available — spawn requires window.__webcontainer');const p=await wc.spawn(cmd,args||[],{cwd:opts.cwd,env:opts.env});const handlers={exit:[],close:[],error:[]};const stdout=new streamMod.Readable();const stderr=new streamMod.Readable();p.output.pipeTo(new WritableStream({write(chunk){stdout.push(Buf.from(chunk));}}));const exitPromise=p.exit.then(code=>{stdout.push(null);stderr.push(null);for(const f of handlers.exit)f(code);for(const f of handlers.close)f(code);return code;});return{pid:Math.floor(Math.random()*1e6),stdout,stderr,stdin:{write:d=>p.input.getWriter().write(d),end:()=>{}},on(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);return this;},kill(){p.kill?.();},exitPromise};};
  return{
    exec(cmd,opts,cb){if(typeof opts==='function'){cb=opts;opts={};}const parts=cmd.split(/\s+/);mkProc(parts[0],parts.slice(1),opts).then(p=>{const chunks=[];p.stdout.on('data',c=>chunks.push(c));p.exitPromise.then(code=>{const out=Buf.concat(chunks).toString();if(cb)code===0?cb(null,out,''):cb(Object.assign(new Error('exit '+code),{code}),out,'');});},e=>cb&&cb(e));},
    spawn(cmd,args,opts){
      // mkProc is async, but callers register listeners SYNCHRONOUSLY right after
      // spawn (proc.on('error'|'exit'|'data', fn)). The old stub on(){return this}
      // dropped every listener registered before mkProc settled — including the
      // 'error' handler that must fire when WebContainer is absent. Buffer pre-settle
      // listeners and replay them onto the real process (or fire 'error' on reject).
      let proc=null;
      const pending=[];                       // [ev,fn] registered before settle
      const pendingStream={stdout:[],stderr:[]};
      const emitter={
        _pending:true,
        on(ev,fn){pending.push([ev,fn]);return this;},
        once(ev,fn){return this.on(ev,fn);},
        stdout:{on(ev,fn){pendingStream.stdout.push([ev,fn]);return this;}},
        stderr:{on(ev,fn){pendingStream.stderr.push([ev,fn]);return this;}},
        stdin:{write(){return true;},end(){}},
        kill(){if(proc)proc.kill();},
      };
      mkProc(cmd,args,opts).then(p=>{
        proc=p;
        for(const [ev,fn] of pending)p.on(ev,fn);
        for(const [ev,fn] of pendingStream.stdout)p.stdout.on(ev,fn);
        for(const [ev,fn] of pendingStream.stderr)p.stderr&&p.stderr.on(ev,fn);
      },e=>{
        // surface the spawn failure only via 'error' — real Node never fires
        // 'exit'/'close' for a process that never launched, so don't fabricate
        // an exit code a caller could mistake for a process that actually ran.
        for(const [ev,fn] of pending){if(ev==='error')fn(e);}
        for(const [ev,fn] of pendingStream.stdout){if(ev==='error')fn(e);}
        for(const [ev,fn] of pendingStream.stderr){if(ev==='error')fn(e);}
      });
      return new Proxy(emitter,{get(t,k){return proc?proc[k]:t[k];}});
    },
    execFile(f,args,opts,cb){if(typeof opts==='function'){cb=opts;opts={};}return this.exec([f,...(args||[])].join(' '),opts,cb);},
    execSync(){throw new Error('child_process.execSync: synchronous subprocess not available in browser');},
    spawnSync(){throw new Error('child_process.spawnSync: synchronous subprocess not available');},
    fork(){throw new Error('child_process.fork: not supported — use Worker');},
  };
}

export function makeRepl(ctx,term,nodeEval){
  const history=[];
  let buffer='';
  let lastResult=undefined;
  // ctx is the same per-shell-instance context object createShell builds
  // (ctx.fs set when an fs was injected) -- .load/.save read/write through it
  // instead of the shared window.__debug global so a multi-terminal page can't
  // have one REPL's .save clobber another instance's filesystem.
  const snap=()=>(ctx.fs?ctx.fs.snapshot:window.__debug?.idbSnapshot)||{};
  const persist=()=>(ctx.fs?ctx.fs.flush?.():window.__debug?.idbPersist?.());
  const commands={
    '.clear':()=>{buffer='';term.write('\r\n');},
    '.exit':()=>{throw Object.assign(new Error('repl exit'),{__nodeExit:true,code:0});},
    '.help':()=>{term.write('Commands: .clear .exit .help .load .save .editor\r\n');},
    '.load':async path=>{const s=snap();const content=s[path.replace(/^\/+/,'')];if(!content)throw new Error('file not found: '+path);return nodeEval(content);},
    '.save':path=>{const s=snap();s[path.replace(/^\/+/,'')]=history.join('\n');persist();term.write('saved\r\n');},
    '.editor':()=>{term.write('(type ^D to execute, ^C to cancel)\r\n');buffer='__editor__';},
  };
  const isIncomplete=code=>{let depth=0,inStr=null,inTmpl=false,prev='';for(let i=0;i<code.length;i++){const c=code[i];if(inStr){if(c==='\\'){i++;continue;}if(c===inStr)inStr=null;continue;}if(inTmpl){if(c==='\\'){i++;continue;}if(c==='`')inTmpl=false;else if(c==='$'&&code[i+1]==='{'){depth++;i++;}continue;}if(c==="'"||c==='"')inStr=c;else if(c==='`')inTmpl=true;else if(c==='('||c==='['||c==='{')depth++;else if(c===')'||c===']'||c==='}')depth--;prev=c;}return depth>0||inStr!==null||inTmpl;};
  return{
    commands,
    isIncomplete,
    async eval(line){
      const trimmed=line.trim();
      if(trimmed.startsWith('.')){const[cmd,...rest]=trimmed.split(/\s+/);if(commands[cmd])return commands[cmd](rest.join(' '));}
      buffer=buffer?buffer+'\n'+line:line;
      if(isIncomplete(buffer))return{continuation:true};
      const code=buffer;buffer='';
      history.unshift(code);if(history.length>1000)history.pop();
      const src='const _=arguments[0];'+(code.startsWith('var ')||code.startsWith('let ')||code.startsWith('const ')||code.includes(';')||code.includes('\n')?code:'return ('+code+');');
      try{const fn=new Function(src);const r=fn(lastResult);if(r!==undefined)lastResult=r;return{result:r};}catch(e){return{error:e};}
    },
    getHistory(){return history;},
    get lastResult(){return lastResult;},
  };
}
