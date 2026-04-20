export function makeTestRunner(term){
  const suites=[];let current=null;const results={pass:0,fail:0,skip:0,failures:[]};
  const write=term?(s=>term.write(s)):(s=>console.log(s.replace(/\r\n/g,'')));
  const color=(c,s)=>`\x1b[${c}m${s}\x1b[0m`;
  async function runOne(name,fn,parentPath=''){
    const path=(parentPath?parentPath+' > ':'')+name;
    if(!fn){results.skip++;write(color(33,'  - '+path+' (skip)')+'\r\n');return;}
    const t0=performance.now();
    try{await fn(tctx(name,path));results.pass++;write(color(32,'  ✓ '+path)+` ${(performance.now()-t0).toFixed(1)}ms\r\n`);}
    catch(e){results.fail++;results.failures.push({path,error:e});write(color(31,'  ✗ '+path+' — '+e.message)+'\r\n');}
  }
  function tctx(name,path){return{name,fullName:path,diagnostic(m){write(color(90,'    # '+m)+'\r\n');},skip(){throw Object.assign(new Error('skip'),{__skip:true});},todo(){throw Object.assign(new Error('todo'),{__todo:true});},signal:new AbortController().signal,plan(n){}};}
  function test(name,optsOrFn,maybeFn){const fn=typeof optsOrFn==='function'?optsOrFn:maybeFn;const opts=typeof optsOrFn==='object'?optsOrFn:{};if(opts.skip)return runOne(name,null);if(opts.only){}if(current){current.tests.push({name,fn});return Promise.resolve();}return runOne(name,fn);}
  function describe(name,fn){const prev=current;current={name,tests:[],parentPath:prev?prev.fullPath:'',fullPath:(prev?prev.fullPath+' > ':'')+name};try{fn(current);}finally{const c=current;current=prev;return(async()=>{for(const t of c.tests)await runOne(t.name,t.fn,c.fullPath);})();}}
  const mock={
    fn(impl){const calls=[];const mk=function(...a){calls.push({arguments:a,result:undefined,error:undefined,target:this});try{const r=impl?impl.apply(this,a):undefined;calls[calls.length-1].result=r;return r;}catch(e){calls[calls.length-1].error=e;throw e;}};mk.mock={calls,callCount(){return calls.length;},resetCalls(){calls.length=0;},restore(){}};return mk;},
    method(obj,key,impl){const orig=obj[key];const m=mock.fn(impl||orig);obj[key]=m;m.mock.restore=()=>{obj[key]=orig;};return m;},
    timers:{enable(){},reset(){},runAll(){},tick(){},restore(){}},
  };
  const api={test,describe,it:test,before:fn=>fn?.(),after:fn=>fn?.(),beforeEach:()=>{},afterEach:()=>{},mock,run(){},results,
    async summarize(){write('\r\n'+color(1,`# tests ${results.pass+results.fail+results.skip}`)+'\r\n');write(color(32,`# pass ${results.pass}`)+'\r\n');write(color(31,`# fail ${results.fail}`)+'\r\n');write(color(33,`# skip ${results.skip}`)+'\r\n');return results.fail===0;},
  };
  return api;
}

export function makeTapReporter(term){
  const w=term?(s=>term.write(s)):(s=>console.log(s));
  let n=0;
  return{
    ok(name){w(`ok ${++n} - ${name}\r\n`);},
    notOk(name,msg){w(`not ok ${++n} - ${name}\r\n  ---\r\n  error: ${msg}\r\n  ...\r\n`);},
    plan(total){w(`1..${total}\r\n`);},
    comment(m){w(`# ${m}\r\n`);},
  };
}
