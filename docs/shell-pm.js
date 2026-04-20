const LOCKFILES={bun:['bun.lock','bun.lockb'],pnpm:['pnpm-lock.yaml'],yarn:['yarn.lock'],npm:['package-lock.json']};

function stripJsonc(s){return s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');}

export function detectPm(snap,cwd=''){
  const base=cwd.replace(/^\//,'').replace(/\/$/,'');
  const pj=snap[(base?base+'/':'')+'package.json'];
  if(pj){try{const p=JSON.parse(pj);if(p.packageManager){const m=p.packageManager.match(/^(\w+)@([\d.]+)/);if(m)return{pm:m[1],version:m[2],source:'packageManager'};}}catch{}}
  for(const[pm,files] of Object.entries(LOCKFILES))for(const f of files)if(((base?base+'/':'')+f) in snap)return{pm,version:'latest',source:'lockfile:'+f};
  return{pm:'npm',version:'latest',source:'default'};
}

export function parseBunfig(src){const o={};for(const line of src.split('\n')){const m=line.match(/^\s*(\w+)\s*=\s*(.+)$/);if(m)o[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}return o;}

export function parseDenoJson(src){try{return JSON.parse(stripJsonc(src));}catch{return{};}}

export function makePmDispatcher(term,fs,persist,ctx){
  const snap=()=>globalThis.window?.__debug?.idbSnapshot||{};
  const pkgPath=()=>{const d=ctx.cwd.replace(/^\//,'').replace(/\/$/,'');return(d?d+'/':'')+'package.json';};
  const readPj=()=>{const p=snap()[pkgPath()];return p?JSON.parse(p):{name:'pkg',version:'0.0.0',dependencies:{}};};
  const writePj=o=>{snap()[pkgPath()]=JSON.stringify(o,null,2);persist();};
  const writeLock=(pm,deps)=>{const base=ctx.cwd.replace(/^\//,'').replace(/\/$/,'');const key=(base?base+'/':'')+(LOCKFILES[pm]?.[0]||'package-lock.json');snap()[key]=JSON.stringify({name:pm,version:1,dependencies:deps},null,2);persist();};
  const cmds={
    async add(pm,args){const pj=readPj();pj.dependencies=pj.dependencies||{};const dev=args.includes('-D')||args.includes('--save-dev')||args.includes('--dev');const pkgs=args.filter(a=>!a.startsWith('-'));for(const spec of pkgs){const m=spec.match(/^(@?[^@]+)(?:@(.+))?$/);const name=m?.[1]||spec;const ver=m?.[2]||'latest';if(dev){pj.devDependencies=pj.devDependencies||{};pj.devDependencies[name]=ver;}else pj.dependencies[name]=ver;term.write(`${pm} added ${name}@${ver}\r\n`);}writePj(pj);writeLock(pm,pj.dependencies);return 0;},
    async remove(pm,args){const pj=readPj();const pkgs=args.filter(a=>!a.startsWith('-'));for(const name of pkgs){delete pj.dependencies?.[name];delete pj.devDependencies?.[name];term.write(`${pm} removed ${name}\r\n`);}writePj(pj);writeLock(pm,pj.dependencies||{});return 0;},
    async install(pm,args){const pj=readPj();const deps={...(pj.dependencies||{}),...(pj.devDependencies||{})};term.write(`${pm} install — ${Object.keys(deps).length} packages resolved via esm.sh\r\n`);writeLock(pm,pj.dependencies||{});return 0;},
    async run(pm,args){const script=args[0];const pj=readPj();const s=pj.scripts?.[script];if(!s){term.write(`${pm} run: no script '${script}'\r\n`);return 1;}return ctx.exec?.(s)||0;},
    async task(pm,args){const script=args[0];const base=ctx.cwd.replace(/^\//,'').replace(/\/$/,'');const dj=snap()[(base?base+'/':'')+'deno.json']||snap()[(base?base+'/':'')+'deno.jsonc'];if(!dj)return 1;const cfg=parseDenoJson(dj);const s=cfg.tasks?.[script];if(!s){term.write(`deno task: no task '${script}'\r\n`);return 1;}return ctx.exec?.(s)||0;},
    async ls(pm,args){const pj=readPj();const deps={...(pj.dependencies||{}),...(pj.devDependencies||{})};for(const[n,v] of Object.entries(deps))term.write(`  ${n}@${v}\r\n`);return 0;},
    async init(pm,args){writePj({name:'pkg',version:'0.1.0',type:'module',scripts:{test:'echo test'}});term.write(`${pm} init — package.json created\r\n`);return 0;},
  };
  cmds.i=cmds.install;cmds.uninstall=cmds.remove;cmds.rm=cmds.remove;
  return async(pm,subcmd,args=[])=>{const fn=cmds[subcmd];if(!fn){term.write(`${pm}: unknown subcommand '${subcmd}'\r\n`);return 1;}return fn(pm,args);};
}

export function makeCorepackStub(term){
  return async(args)=>{term.write(`corepack: ${args.join(' ')} — no-op in browser (all PMs built-in)\r\n`);return 0;};
}
