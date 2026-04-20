const CHAN='plugkit-ipc';

export function makeForkIpc(proc){
  if(typeof BroadcastChannel==='undefined')return{enabled:false};
  const bc=new BroadcastChannel(CHAN);
  const childId=globalThis.location?.hash==='#ipc-child'?1:0;
  const isChild=childId>0;
  const handlers={message:[],disconnect:[]};
  bc.addEventListener('message',e=>{const{from,to,msg}=e.data||{};if(isChild&&to==='child'){for(const h of handlers.message)h(msg,{});}else if(!isChild&&to==='parent'){for(const h of handlers.message)h(msg,{});}});
  proc.send=msg=>{bc.postMessage({from:isChild?'child':'parent',to:isChild?'parent':'child',msg});return true;};
  proc.on=(ev,fn)=>{if(ev==='message'||ev==='disconnect')(handlers[ev]=handlers[ev]||[]).push(fn);return proc;};
  proc.disconnect=()=>{bc.postMessage({from:isChild?'child':'parent',to:isChild?'parent':'child',type:'disconnect'});for(const h of handlers.disconnect)h();};
  proc.connected=true;
  return{enabled:true,bc,isChild};
}
