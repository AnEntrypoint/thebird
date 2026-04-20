const ANSI_RE=/\x1b\[[0-9;]*[a-zA-Z]/g;
const STYLE_CODES={reset:0,bold:1,dim:2,italic:3,underline:4,inverse:7,hidden:8,strikethrough:9,black:30,red:31,green:32,yellow:33,blue:34,magenta:35,cyan:36,white:37,gray:90,bgBlack:40,bgRed:41,bgGreen:42,bgYellow:43,bgBlue:44,bgMagenta:45,bgCyan:46,bgWhite:47};

export function styleText(styles,text){
  const arr=Array.isArray(styles)?styles:[styles];
  const codes=arr.map(s=>STYLE_CODES[s]).filter(c=>c!=null);
  if(!codes.length)return text;
  return `\x1b[${codes.join(';')}m${text}\x1b[0m`;
}

export function stripVTControlCharacters(s){return String(s).replace(ANSI_RE,'');}

export function getCallSites(frames=10){
  const e=new Error();const lines=(e.stack||'').split('\n').slice(2,2+frames);
  return lines.map(l=>{const m=l.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);return{functionName:m?.[1]||'<anonymous>',scriptName:m?.[2]||'',lineNumber:m?+m[3]:0,column:m?+m[4]:0,scriptId:'0'};});
}

export class MIMEType{
  constructor(input){
    const [essence,...paramParts]=String(input).split(';');
    const [type,subtype]=essence.trim().split('/');
    if(!type||!subtype)throw new TypeError('Invalid MIME: '+input);
    this._type=type.toLowerCase();this._sub=subtype.toLowerCase();
    this._params=new MIMEParams();
    for(const p of paramParts){const [k,v]=p.split('=');if(k&&v)this._params.set(k.trim().toLowerCase(),v.trim().replace(/^["']|["']$/g,''));}
  }
  get type(){return this._type;}set type(v){this._type=String(v).toLowerCase();}
  get subtype(){return this._sub;}set subtype(v){this._sub=String(v).toLowerCase();}
  get essence(){return `${this._type}/${this._sub}`;}
  get params(){return this._params;}
  toString(){const p=[...this._params].map(([k,v])=>`${k}=${v}`).join(';');return this.essence+(p?';'+p:'');}
}

export class MIMEParams{
  constructor(){this._m=new Map();}
  get(k){return this._m.get(k);}
  set(k,v){this._m.set(String(k).toLowerCase(),String(v));return this;}
  delete(k){return this._m.delete(k);}
  has(k){return this._m.has(k);}
  *entries(){yield*this._m.entries();}
  *keys(){yield*this._m.keys();}
  *values(){yield*this._m.values();}
  [Symbol.iterator](){return this._m[Symbol.iterator]();}
}

export function makeConsoleExtras(origConsole,term){
  const write=term?(s=>term.write(s)):(s=>origConsole.log(s));
  const timers=new Map();const counters=new Map();let groupDepth=0;const ind=()=>'  '.repeat(groupDepth);
  return{
    table(data,columns){if(!data||typeof data!=='object')return origConsole.log(data);const rows=Array.isArray(data)?data:Object.entries(data).map(([k,v])=>({'(index)':k,...(typeof v==='object'?v:{Values:v})}));if(!rows.length)return;const cols=columns||[...new Set(rows.flatMap(r=>Object.keys(r)))];const w=cols.map(c=>Math.max(c.length,...rows.map(r=>String(r[c]??'').length)));const line=(cells,pad)=>'│ '+cells.map((c,i)=>String(c??'').padEnd(w[i]))+' │\r\n';const sep=s=>s+cols.map((_,i)=>'─'.repeat(w[i]+2)).join(s==='├'?'┼':'─')+(s==='├'?'┤':'╯')+'\r\n';write('╭'+cols.map((_,i)=>'─'.repeat(w[i]+2)).join('─')+'╮\r\n');write('│ '+cols.map((c,i)=>c.padEnd(w[i])).join(' │ ')+' │\r\n');write('├'+cols.map((_,i)=>'─'.repeat(w[i]+2)).join('┼')+'┤\r\n');for(const r of rows)write('│ '+cols.map((c,i)=>String(r[c]??'').padEnd(w[i])).join(' │ ')+' │\r\n');write('╰'+cols.map((_,i)=>'─'.repeat(w[i]+2)).join('─')+'╯\r\n');},
    group(label){if(label)write(ind()+label+'\r\n');groupDepth++;},
    groupCollapsed(label){this.group(label);},
    groupEnd(){groupDepth=Math.max(0,groupDepth-1);},
    time(label='default'){timers.set(label,performance.now());},
    timeEnd(label='default'){const t=timers.get(label);if(t==null)return;timers.delete(label);write(`${label}: ${(performance.now()-t).toFixed(3)}ms\r\n`);},
    timeLog(label='default',...rest){const t=timers.get(label);if(t==null)return;write(`${label}: ${(performance.now()-t).toFixed(3)}ms ${rest.join(' ')}\r\n`);},
    count(label='default'){const n=(counters.get(label)||0)+1;counters.set(label,n);write(`${label}: ${n}\r\n`);},
    countReset(label='default'){counters.set(label,0);},
    dir(v){write(JSON.stringify(v,null,2)+'\r\n');},
    dirxml(v){this.dir(v);},
    trace(...a){write('Trace: '+a.join(' ')+'\r\n'+new Error().stack+'\r\n');},
    assert(cond,...msg){if(!cond)write('Assertion failed: '+msg.join(' ')+'\r\n');},
    clear(){write('\x1b[2J\x1b[H');},
    profile(){},profileEnd(){},timeStamp(){},
  };
}
