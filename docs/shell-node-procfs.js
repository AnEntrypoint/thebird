export function makeProcFs(proc){
  const g=globalThis;
  const gen={
    'proc/self/cmdline':()=>(proc.argv||[]).join('\0')+'\0',
    'proc/self/environ':()=>Object.entries(proc.env||{}).map(([k,v])=>`${k}=${v}`).join('\0')+'\0',
    'proc/self/cwd':()=>proc.cwd?.()||'/',
    'proc/self/exe':()=>proc.execPath||'/usr/local/bin/node',
    'proc/self/status':()=>{const m=performance.memory||{usedJSHeapSize:0,totalJSHeapSize:0};return`Name:\tnode\nState:\tR (running)\nPid:\t${proc.pid||1}\nPPid:\t${proc.ppid||0}\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\nVmRSS:\t${(m.totalJSHeapSize/1024)|0} kB\nVmPeak:\t${(m.totalJSHeapSize/1024)|0} kB\n`;},
    'proc/self/stat':()=>`${proc.pid||1} (node) R ${proc.ppid||0} ${proc.pid||1} ${proc.pid||1} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${performance.now()|0} ${(performance.memory?.totalJSHeapSize||0)} 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`,
    'proc/self/maps':()=>'00400000-00500000 r-xp 00000000 00:00 0 [text]\n',
    'proc/self/limits':()=>'Limit                     Soft Limit Hard Limit\nMax open files            1024 4096\n',
    'proc/cpuinfo':()=>{const n=navigator?.hardwareConcurrency||4;let out='';for(let i=0;i<n;i++)out+=`processor\t: ${i}\nvendor_id\t: BrowserCPU\nmodel name\t: Browser JS Engine\ncpu MHz\t\t: 3000.000\ncache size\t: 8192 KB\ncores\t\t: ${n}\n\n`;return out;},
    'proc/meminfo':()=>{const m=performance.memory||{totalJSHeapSize:1e9,jsHeapSizeLimit:2e9,usedJSHeapSize:5e8};return`MemTotal:       ${(m.jsHeapSizeLimit/1024)|0} kB\nMemFree:        ${((m.jsHeapSizeLimit-m.usedJSHeapSize)/1024)|0} kB\nMemAvailable:   ${((m.jsHeapSizeLimit-m.usedJSHeapSize)/1024)|0} kB\nBuffers:               0 kB\nCached:                0 kB\n`;},
    'proc/uptime':()=>`${(performance.now()/1000).toFixed(2)} ${(performance.now()/1000).toFixed(2)}\n`,
    'proc/loadavg':()=>'0.00 0.00 0.00 1/1 '+(proc.pid||1)+'\n',
    'proc/version':()=>`Linux version 6.0.0-browser (node@thebird) #1 SMP ${new Date().toUTCString()}\n`,
    'proc/stat':()=>'cpu  0 0 0 0 0 0 0 0 0 0\nbtime '+Math.floor(Date.now()/1000)+'\n',
    'proc/mounts':()=>'idbfs / idbfs rw,relatime 0 0\n',
    'proc/filesystems':()=>'nodev\tidbfs\nnodev\topfs\n',
    'etc/hosts':()=>'127.0.0.1 localhost\n::1 localhost\n',
    'etc/resolv.conf':()=>'nameserver 1.1.1.1\nnameserver 8.8.8.8\n',
    'etc/passwd':()=>'root:x:0:0:root:/root:/bin/sh\n',
    'etc/group':()=>'root:x:0:\n',
    'etc/os-release':()=>'NAME="thebird"\nPRETTY_NAME="thebird browser runtime"\nID=thebird\nID_LIKE=linux\nVERSION_ID="1.0"\n',
    'etc/hostname':()=>'thebird\n',
    'etc/machine-id':()=>'00000000000000000000000000000000\n',
    'etc/shells':()=>'/bin/sh\n/bin/bash\n',
  };
  return{
    handles(path){const k=path.replace(/^\//,'').replace(/\/$/,'');return k in gen;},
    read(path){const k=path.replace(/^\//,'').replace(/\/$/,'');const fn=gen[k];if(!fn)return null;try{return fn();}catch{return'';}},
    list(){return Object.keys(gen).map(k=>'/'+k);},
  };
}

export function wireProcFs(fs,procFs){
  const origRead=fs.readFileSync, origExists=fs.existsSync, origStat=fs.statSync;
  fs.readFileSync=(p,enc)=>{if(procFs.handles(p)){const s=procFs.read(p);return enc?s:new TextEncoder().encode(s);}return origRead(p,enc);};
  fs.existsSync=p=>procFs.handles(p)||origExists(p);
  fs.statSync=p=>{if(procFs.handles(p)){const s=procFs.read(p);return{size:s.length,mode:0o100444,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,isFIFO:()=>false,isBlockDevice:()=>false,isCharacterDevice:()=>false,isSocket:()=>false,mtimeMs:Date.now(),mtime:new Date(),atimeMs:Date.now(),ctimeMs:Date.now(),birthtimeMs:Date.now(),uid:0,gid:0,nlink:1,dev:0,ino:0,rdev:0,blksize:4096,blocks:1};}return origStat(p);};
  return fs;
}
