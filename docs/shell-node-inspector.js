export function makeInspector(debugReg){
  let opened=false;let url=null;let port=null;const sessions=new Set();
  const targets=()=>[{description:'thebird browser runtime',devtoolsFrontendUrl:'',id:'thebird-1',title:'thebird',type:'node',url:'file://thebird',webSocketDebuggerUrl:url}];
  const handlers={};
  const post=(sess,msg)=>{try{sess.send(JSON.stringify(msg));}catch(e){console.error('[inspector] failed to send CDP response:',e);}};
  const installServer=u=>{
    if(typeof globalThis.addEventListener!=='function')return;
    globalThis.addEventListener('message',e=>{if(e.data?.type!=='cdp:connect')return;const chan=e.data.channel;const sess={send:m=>globalThis.postMessage({type:'cdp:msg',channel:chan,msg:m},'*')};sessions.add(sess);});
  };
  const dispatch=(sess,raw)=>{
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    const {id,method,params}=msg;
    const send=result=>post(sess,{id,result});
    // -32601 is the JSON-RPC "Method not found" code: every method outside the
    // implemented set below fails closed with it, so a client is never told a
    // method exists and then handed a generic not-implemented.
    const err=code=>post(sess,{id,error:{code,message:'method not found: '+method}});
    const map={
      'Runtime.enable':()=>send({}),
      // Indirect eval in the page global — the same evaluation entry point the
      // node-shim's vm.runInThisContext uses (shell-node-advanced.js).
      'Runtime.evaluate':()=>{try{const r=(0,eval)(params.expression);send({result:{type:typeof r,value:r,description:String(r)}});}catch(e){send({exceptionDetails:{exception:{type:'object',className:'Error',description:e.stack}}});}},
      // Real no-op success: actual breakpoint debugging is not supported, but
      // enabling must not choke a client that only wants Runtime.evaluate.
      'Debugger.enable':()=>send({debuggerId:'thebird-dbg-1'}),
    };
    const h=map[method];h?h():err(-32601);
  };
  return{
    open(p=9229,host='127.0.0.1',wait=false){if(opened)return;opened=true;port=p;url=`ws://${host}:${p}/${crypto.randomUUID()}`;installServer(url);debugReg.polyfills=debugReg.polyfills||{};debugReg.polyfills.inspector={active:true,backing:'postMessage-CDP',reason:'Limited CDP polyfill: implements Runtime.enable/Runtime.evaluate + Debugger.enable (no-op) only; every other method fails closed with JSON-RPC -32601 method-not-found (no Profiler/HeapProfiler/Debugger script surface in browser sandbox)'};debugReg.inspector={url,port,targets:targets(),sessions};if(wait)throw new Error('inspector.waitForDebugger: sync block not supported — use openAsync()');return{url};},
    async openAsync(p=9229,host='127.0.0.1'){return this.open(p,host,false);},
    close(){opened=false;url=null;sessions.clear();},
    url:()=>url,
    Session:class Session{constructor(){this._h={};}connect(){return this;}post(method,params,cb){queueMicrotask(()=>dispatch({send:m=>{const p=JSON.parse(m);cb&&cb(p.error||null,p.result);}},JSON.stringify({id:1,method,params})));}on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;}disconnect(){return this;}},
    console:{context:{}},
    _dispatch:dispatch,
    _targets:targets,
  };
}
