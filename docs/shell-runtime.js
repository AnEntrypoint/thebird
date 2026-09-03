export function detectRuntime(){
  const g=globalThis;
  let runtime='browser',version='0';
  if(g.Deno?.version){runtime='deno';version=g.Deno.version.deno;}
  else if(g.Bun?.version){runtime='bun';version=g.Bun.version;}
  else if(g.process?.versions?.bun){runtime='bun';version=g.process.versions.bun;}
  else if(g.process?.versions?.node){runtime='node';version=g.process.versions.node;}
  const features={
    jsr:runtime==='deno'||runtime==='bun'||runtime==='browser',
    npmSpecifier:runtime==='deno'||runtime==='bun'||runtime==='browser',
    bunServe:typeof g.Bun?.serve==='function'||runtime==='browser',
    denoPermissions:runtime==='deno',
    typeStrip:runtime==='bun'||runtime==='deno'||runtime==='browser',
    workspaceRoot:true,
    shebangDispatch:true,
  };
  return{runtime,version,features};
}

export function registerRuntime(reg,rt){
  reg.runtime={active:rt.runtime,version:rt.version,features:rt.features,available:['node','deno','bun','browser'],history:[]};
  return reg;
}

export function logRuntimeSwitch(reg,from,to,reason){
  if(!reg?.runtime)return;
  reg.runtime.history.push({ts:Date.now(),from,to,reason});
  if(reg.runtime.history.length>50)reg.runtime.history.shift();
  reg.runtime.active=to;
}

export function switchRuntime(shebang){
  if(!shebang)return'node';
  if(shebang.includes('deno'))return'deno';
  if(shebang.includes('bun'))return'bun';
  return'node';
}
