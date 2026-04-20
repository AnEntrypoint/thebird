export function makeInspector(debugReg){
  let opened=false;let url=null;let port=null;const sessions=new Set();
  const targets=()=>[{description:'thebird browser runtime',devtoolsFrontendUrl:'',id:'thebird-1',title:'thebird',type:'node',url:'file://thebird',webSocketDebuggerUrl:url}];
  const handlers={};
  const post=(sess,msg)=>{try{sess.send(JSON.stringify(msg));}catch{}};
  const installServer=u=>{
    if(typeof globalThis.addEventListener!=='function')return;
    globalThis.addEventListener('message',e=>{if(e.data?.type!=='cdp:connect')return;const chan=e.data.channel;const sess={send:m=>globalThis.postMessage({type:'cdp:msg',channel:chan,msg:m},'*')};sessions.add(sess);});
  };
  const dispatch=(sess,raw)=>{
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    const {id,method,params}=msg;
    const send=result=>post(sess,{id,result});
    const err=code=>post(sess,{id,error:{code,message:'not implemented'}});
    const map={
      'Runtime.enable':()=>send({}),
      'Runtime.evaluate':()=>{try{const r=(0,eval)(params.expression);send({result:{type:typeof r,value:r,description:String(r)}});}catch(e){send({exceptionDetails:{exception:{type:'object',className:'Error',description:e.stack}}});}},
      'Debugger.enable':()=>send({debuggerId:'thebird-dbg-1'}),
      'Debugger.getScriptSource':()=>send({scriptSource:''}),
      'Profiler.enable':()=>send({}),
      'Profiler.start':()=>send({}),
      'Profiler.stop':()=>send({profile:{nodes:[],startTime:0,endTime:0,samples:[],timeDeltas:[]}}),
      'HeapProfiler.enable':()=>send({}),
      'HeapProfiler.takeHeapSnapshot':()=>send({}),
    };
    const h=map[method];h?h():err(-32601);
  };
  return{
    open(p=9229,host='127.0.0.1',wait=false){if(opened)return;opened=true;port=p;url=`ws://${host}:${p}/${crypto.randomUUID()}`;installServer(url);debugReg.polyfills=debugReg.polyfills||{};debugReg.polyfills.inspector={active:true,backing:'postMessage-CDP',reason:'real WS debugger unavailable in sandbox'};debugReg.inspector={url,port,targets:targets(),sessions};if(wait)throw new Error('inspector.waitForDebugger: sync block not supported — use openAsync()');return{url};},
    async openAsync(p=9229,host='127.0.0.1'){return this.open(p,host,false);},
    close(){opened=false;url=null;sessions.clear();},
    url:()=>url,
    waitForDebugger(){throw new Error('inspector.waitForDebugger: synchronous block not supported in browser — attach before starting work');},
    Session:class Session{constructor(){this._h={};}connect(){return this;}post(method,params,cb){queueMicrotask(()=>dispatch({send:m=>{const p=JSON.parse(m);cb&&cb(p.error||null,p.result);}},JSON.stringify({id:1,method,params})));}on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;}disconnect(){return this;}},
    console:{context:{}},
    _dispatch:dispatch,
    _targets:targets,
  };
}
