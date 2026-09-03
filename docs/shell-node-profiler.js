export function makeV8Profiler(debugReg){
  const samples=[];let observer=null;let running=false;let startT=0;
  const startObserver=()=>{if(observer||typeof PerformanceObserver==='undefined')return;try{observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(running)samples.push({name:e.name,ts:e.startTime,dur:e.duration,entryType:e.entryType});});observer.observe({entryTypes:['measure','longtask']});}catch(e){console.warn('[profiler] snapshot error:',e);}};
  const stopObserver=()=>{if(observer){observer.disconnect();observer=null;}};
  return{
    CPUProfile:class CPUProfile{
      constructor(){this.nodes=[];this.samples=[];this.timeDeltas=[];this.startTime=0;this.endTime=0;this.title='';}
      startProfiling(title){this.title=title||'';samples.length=0;startT=performance.now();running=true;startObserver();}
      stopProfiling(){running=false;stopObserver();const end=performance.now();this.startTime=startT*1000;this.endTime=end*1000;this.nodes=samples.map((s,i)=>({id:i+1,_synthetic:true,callFrame:{functionName:s.name||'(anonymous)',scriptId:'0',url:'',lineNumber:0,columnNumber:0},hitCount:1,children:[]}));this.samples=samples.map((_,i)=>i+1);this.timeDeltas=samples.map(s=>Math.round(s.dur*1000));return this;}
    },
    startProfiling(){const p=new this.CPUProfile();p.startProfiling();return p;},
    stopProfiling(p){return p?p.stopProfiling():null;},
    /* Synthetic v8 heap stats for Node API compatibility only. _synthetic:true is always set.
       Only measurable fields are returned (total_heap_size, total_available_size, used_heap_size,
       heap_size_limit, total_physical_size, total_heap_size_executable) derived from
       performance.memory (real on Chromium) or fixed defaults. Unfalsifiable fields
       (malloced_memory, peak_malloced_memory, does_zap_garbage, number_of_native_contexts,
       number_of_detached_contexts) are omitted entirely. Do not use for profiling, tuning,
       or leak detection. */
    getHeapStatistics(){const m=performance.memory||{usedJSHeapSize:5e6,totalJSHeapSize:10e6,jsHeapSizeLimit:1e9};return{_synthetic:true,total_heap_size:m.totalJSHeapSize,total_heap_size_executable:0,total_physical_size:m.totalJSHeapSize,total_available_size:m.jsHeapSizeLimit-m.usedJSHeapSize,used_heap_size:m.usedJSHeapSize,heap_size_limit:m.jsHeapSizeLimit};},
    getHeapSpaceStatistics(){const m=performance.memory||{usedJSHeapSize:5e6,jsHeapSizeLimit:1e9};const sz=Math.round(m.jsHeapSizeLimit/4);const used=Math.round(m.usedJSHeapSize/2);return[{_synthetic:true,space_name:'new_space',space_size:sz,space_used_size:Math.min(used,sz),space_available_size:Math.max(0,sz-Math.min(used,sz)),physical_space_size:sz}];},
    getHeapCodeStatistics(){return{_synthetic:true,code_and_metadata_size:0,bytecode_and_metadata_size:0,external_script_source_size:0};},
    cachedDataVersionTag:()=>0,
    setFlagsFromString(){},
    startupSnapshot:{isBuildingSnapshot:()=>false,addSerializeCallback(){},addDeserializeCallback(){}},
  };
}

export function makeHeapSnapshot(snapFs){
  // snapFs is the instance-scoped fs-snapshot accessor (shell-node.js's own
  // snapFn, itself backed by ctx.fs when injected into createShell) that
  // writeHeapSnapshot below persists the generated .heapsnapshot JSON into.
  // Falls back to the shared window.__debug global only when no accessor was
  // supplied, same opt-in contract as the rest of this pass.
  if(!snapFs) snapFs=()=>globalThis.window?.__debug?.idbSnapshot;
  const NODE_FIELDS=['type','name','id','self_size','edge_count','trace_node_id','detachedness'];
  const NODE_TYPES=[['hidden','array','string','object','code','closure','regexp','number','native','synthetic','concatenated string','sliced string','symbol','bigint','object shape'],'string','number','number','number','number','number'];
  const EDGE_FIELDS=['type','name_or_index','to_node'];
  const EDGE_TYPES=[['context','element','property','internal','hidden','shortcut','weak'],'string_or_number','node'];
  const META={node_fields:NODE_FIELDS,node_types:NODE_TYPES,edge_fields:EDGE_FIELDS,edge_types:EDGE_TYPES,trace_function_info_fields:[],trace_node_fields:[],sample_fields:[],location_fields:[]};
  const walk=(root,maxNodes=5000)=>{
    const visited=new WeakMap();const strings=[''];const stringIdx=new Map([['',0]]);
    const addStr=s=>{if(stringIdx.has(s))return stringIdx.get(s);const i=strings.length;strings.push(s);stringIdx.set(s,i);return i;};
    const nodes=[];const edges=[];const nodeObjs=[];const queue=[[root,'root']];
    while(queue.length&&nodes.length<maxNodes){
      const [obj,name]=queue.shift();
      const isObj=obj!==null&&(typeof obj==='object'||typeof obj==='function');
      if(isObj&&visited.has(obj))continue;
      const nodeIdx=nodes.length;const id=nodeIdx+1;if(isObj)visited.set(obj,id);
      const t=obj===null?9:typeof obj==='string'?2:typeof obj==='number'?7:typeof obj==='bigint'?13:typeof obj==='symbol'?12:Array.isArray(obj)?1:typeof obj==='function'?5:3;
      let childEdges=0;
      if(isObj){try{const keys=Object.keys(obj);if(keys.length>32)console.warn('[heap-snapshot] object with '+keys.length+' properties truncated to 32');for(const k of keys.slice(0,32)){queue.push([obj[k],k]);childEdges++;}}catch(e){console.warn('[profiler] snapshot error:',e);}}
      nodes.push([t,addStr(name),id,typeof obj==='string'?obj.length:64,childEdges,0,0]);
      nodeObjs.push(isObj?obj:null);
    }
    // Build edges after all nodes collected: to_node is (nodeIndex * NODE_FIELDS.length) in the flattened array.
    // Use the visited map (obj -> 1-based id) to resolve actual target node indices for object children.
    for(let ni=0;ni<nodes.length;ni++){
      const childCount=nodes[ni][4];
      const obj=nodeObjs[ni];
      let actualEdges=0;
      if(obj!=null){try{let ci=0;for(const k of Object.keys(obj).slice(0,32)){if(ci>=childCount)break;const v=obj[k];const isO=v!==null&&(typeof v==='object'||typeof v==='function');const tidx=isO&&visited.has(v)?visited.get(v)-1:-1;if(tidx>=0){edges.push([2,addStr(k),tidx*NODE_FIELDS.length]);actualEdges++;}ci++;}}catch(e){console.warn('[profiler] snapshot error:',e);}}
      // Update the stored edge_count to match edges actually emitted
      nodes[ni][4]=actualEdges;
    }
    return{snapshot:{meta:META,node_count:nodes.length,edge_count:edges.length,trace_function_count:0},nodes:nodes.flat(),edges:edges.flat(),trace_function_infos:[],trace_tree:[],samples:[],locations:[],strings};
  };
  return{
    writeHeapSnapshot(filename){const snap=walk(globalThis);const json=JSON.stringify(snap);const fsSnap=snapFs();if(typeof filename==='string'&&fsSnap){fsSnap[filename.replace(/^\/+/,'')]=json;}return filename;},
    getHeapSnapshot(){const snap=walk(globalThis);return{read(){return JSON.stringify(snap);}};},
  };
}
