const CHANNEL='plugkit-cluster';
const isWorkerUrl=()=>typeof location!=='undefined'&&location.hash==='#cluster-worker';

export function makeCluster(){
  if(typeof BroadcastChannel==='undefined')return null;
  const bc=new BroadcastChannel(CHANNEL);
  const workers=new Map();let nextId=1;
  const isMaster=!isWorkerUrl();
  const handlers={message:[],exit:[],online:[],listening:[],disconnect:[]};
  const onBC=e=>{const{from,to,type,data,id}=e.data||{};if(isMaster){if(to==='master'){const w=workers.get(from);if(!w)return;if(type==='ready'){w.state='online';for(const f of handlers.online)f(w);for(const f of w._h.online||[])f();}if(type==='message'){for(const f of handlers.message)f(w,data);for(const f of w._h.message||[])f(data);}if(type==='exit'){w.state='dead';for(const f of handlers.exit)f(w,data?.code||0);for(const f of w._h.exit||[])f(data?.code||0);workers.delete(from);}}}else{if(to==='worker'||to==='all'){if(type==='message')for(const f of workerHandlers.message)f(data);}}};
  bc.addEventListener('message',onBC);
  const workerHandlers={message:[]};
  const cluster={
    isMaster,
    isPrimary:isMaster,
    isWorker:!isMaster,
    workers:{},
    SCHED_RR:1,SCHED_NONE:0,
    schedulingPolicy:1,
    settings:{},
    setupMaster:opts=>Object.assign(cluster.settings,opts||{}),
    setupPrimary:opts=>Object.assign(cluster.settings,opts||{}),
    fork(env){if(!isMaster)throw new Error('cluster.fork: only master can fork');const id=nextId++;const w={id,state:'starting',_h:{},process:{pid:id,send:(msg)=>{bc.postMessage({from:'master',to:id,type:'message',data:msg});return true;},kill:()=>{bc.postMessage({from:'master',to:id,type:'kill'});}},send(msg){return this.process.send(msg);},on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;},disconnect(){bc.postMessage({from:'master',to:id,type:'disconnect'});},kill(){this.process.kill();}};workers.set(id,w);cluster.workers[id]=w;const url=(cluster.settings.exec||location.href.split('#')[0])+'#cluster-worker';try{window.open(url,'_blank','noopener');}catch{}return w;},
    disconnect(cb){for(const w of workers.values())w.disconnect();cb&&cb();},
    on(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);return cluster;},
    worker:isMaster?null:{id:0,process:{send:msg=>{bc.postMessage({from:0,to:'master',type:'message',data:msg});return true;},on(ev,fn){if(ev==='message')workerHandlers.message.push(fn);}}},
    _bc:bc,
    _workerSend:msg=>bc.postMessage({from:0,to:'master',type:'message',data:msg}),
    _workerReady:()=>bc.postMessage({from:0,to:'master',type:'ready'}),
  };
  if(!isMaster)queueMicrotask(()=>cluster._workerReady());
  return cluster;
}
