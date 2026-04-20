export function makeV8Profiler(debugReg){
  const samples=[];let observer=null;let running=false;let startT=0;
  const startObserver=()=>{if(observer||typeof PerformanceObserver==='undefined')return;try{observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(running)samples.push({name:e.name,ts:e.startTime,dur:e.duration,entryType:e.entryType});});observer.observe({entryTypes:['measure','longtask','function']});}catch{}};
  const stopObserver=()=>{if(observer){observer.disconnect();observer=null;}};
  return{
    CPUProfile:class CPUProfile{
      constructor(){this.nodes=[];this.samples=[];this.timeDeltas=[];this.startTime=0;this.endTime=0;this.title='';}
      startProfiling(title){this.title=title||'';samples.length=0;startT=performance.now();running=true;startObserver();}
      stopProfiling(){running=false;stopObserver();const end=performance.now();this.startTime=startT*1000;this.endTime=end*1000;this.nodes=samples.map((s,i)=>({id:i+1,callFrame:{functionName:s.name||'(anonymous)',scriptId:'0',url:'',lineNumber:0,columnNumber:0},hitCount:1,children:[]}));this.samples=samples.map((_,i)=>i+1);this.timeDeltas=samples.map(s=>Math.round(s.dur*1000));return this;}
    },
    startProfiling(){const p=new this.CPUProfile();p.startProfiling();return p;},
    stopProfiling(p){return p?p.stopProfiling():null;},
    getHeapStatistics(){const m=performance.memory||{usedJSHeapSize:5e6,totalJSHeapSize:10e6,jsHeapSizeLimit:1e9};return{total_heap_size:m.totalJSHeapSize,total_heap_size_executable:0,total_physical_size:m.totalJSHeapSize,total_available_size:m.jsHeapSizeLimit-m.usedJSHeapSize,used_heap_size:m.usedJSHeapSize,heap_size_limit:m.jsHeapSizeLimit,malloced_memory:0,peak_malloced_memory:0,does_zap_garbage:0,number_of_native_contexts:1,number_of_detached_contexts:0};},
    getHeapSpaceStatistics(){return[{space_name:'new_space',space_size:1e6,space_used_size:5e5,space_available_size:5e5,physical_space_size:1e6}];},
    getHeapCodeStatistics(){return{code_and_metadata_size:0,bytecode_and_metadata_size:0,external_script_source_size:0};},
    cachedDataVersionTag:()=>0,
    setFlagsFromString(){},
    startupSnapshot:{isBuildingSnapshot:()=>false,addSerializeCallback(){},addDeserializeCallback(){}},
  };
}

export function makeHeapSnapshot(){
  const NODE_FIELDS=['type','name','id','self_size','edge_count','trace_node_id','detachedness'];
  const NODE_TYPES=[['hidden','array','string','object','code','closure','regexp','number','native','synthetic','concatenated string','sliced string','symbol','bigint','object shape'],'string','number','number','number','number','number'];
  const EDGE_FIELDS=['type','name_or_index','to_node'];
  const EDGE_TYPES=[['context','element','property','internal','hidden','shortcut','weak'],'string_or_number','node'];
  const META={node_fields:NODE_FIELDS,node_types:NODE_TYPES,edge_fields:EDGE_FIELDS,edge_types:EDGE_TYPES,trace_function_info_fields:[],trace_node_fields:[],sample_fields:[],location_fields:[]};
  const walk=(root,maxNodes=5000)=>{
    const visited=new WeakMap();const strings=[''];const stringIdx=new Map([['',0]]);
    const addStr=s=>{if(stringIdx.has(s))return stringIdx.get(s);const i=strings.length;strings.push(s);stringIdx.set(s,i);return i;};
    const nodes=[];const edges=[];const queue=[[root,'root']];
    while(queue.length&&nodes.length<maxNodes){
      const [obj,name]=queue.shift();
      const isObj=obj!==null&&(typeof obj==='object'||typeof obj==='function');
      if(isObj&&visited.has(obj))continue;
      const id=nodes.length+1;if(isObj)visited.set(obj,id);
      const t=obj===null?9:typeof obj==='string'?2:typeof obj==='number'?7:typeof obj==='bigint'?13:typeof obj==='symbol'?12:Array.isArray(obj)?1:typeof obj==='function'?5:3;
      let childEdges=0;
      if(isObj){try{for(const k of Object.keys(obj).slice(0,32)){queue.push([obj[k],k]);childEdges++;}}catch{}}
      nodes.push([t,addStr(name),id,typeof obj==='string'?obj.length:64,childEdges,0,0]);
    }
    let cursor=0;
    for(const n of nodes){const childCount=n[4];for(let i=0;i<childCount;i++){edges.push([2,cursor+i+1,(cursor+i+1)*NODE_FIELDS.length]);}cursor+=childCount;}
    return{snapshot:{meta:META,node_count:nodes.length,edge_count:edges.length,trace_function_count:0},nodes:nodes.flat(),edges:edges.flat(),trace_function_infos:[],trace_tree:[],samples:[],locations:[],strings};
  };
  return{
    writeHeapSnapshot(filename){const snap=walk(globalThis);const json=JSON.stringify(snap);if(typeof filename==='string'&&globalThis.window?.__debug?.idbSnapshot){globalThis.window.__debug.idbSnapshot[filename.replace(/^\/+/,'')]=json;}return filename;},
    getHeapSnapshot(){const snap=walk(globalThis);return{read(){return JSON.stringify(snap);}};},
  };
}
