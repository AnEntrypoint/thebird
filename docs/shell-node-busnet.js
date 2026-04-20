const BUS_CHAN='plugkit-busnet';
const bus=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(BUS_CHAN):null;
const listeners=new Map();
const connections=new Map();let connSeq=1;
const serviceRegistry=new Map();
let _origin=null;
function getOrigin(){if(_origin)return _origin;_origin=(globalThis.crypto?.randomUUID?.()||String(Math.random())).slice(0,8);return _origin;}

function handleMsg(m){
  if(!m)return;
  if(m.type==='discover'&&m.origin!==getOrigin()){for(const[port,l] of listeners)post({type:'announce',port,service:l.service,origin:getOrigin()});return;}
  if(m.type==='connect'&&listeners.has(m.port)){const l=listeners.get(m.port);const conn=createConnection(m.id,m.from,true);l.onConnection?.(conn);connections.set(m.id,conn);post({type:'connected',id:m.id,from:getOrigin(),to:m.from});return;}
  if(m.type==='connected'&&connections.has(m.id)){queueMicrotask(()=>connections.get(m.id)?._onOpen());return;}
  if(m.type==='data'&&connections.has(m.id)&&m.from!==null&&m.to===getOrigin()){connections.get(m.id)._onData(m.data);return;}
  if(m.type==='data-local'&&connections.has(m.id)){connections.get(m.id)._onData(m.data);return;}
  if(m.type==='close'&&connections.has(m.id)){connections.get(m.id)._onClose();connections.delete(m.id);return;}
  if(m.type==='announce'&&m.origin!==getOrigin()){serviceRegistry.set(m.port+'@'+m.origin,{port:m.port,service:m.service,origin:m.origin,seen:Date.now()});return;}
}

function post(msg){if(bus)bus.postMessage(msg);}

if(bus)bus.addEventListener('message',e=>{if(e.data?.origin===getOrigin())return;handleMsg(e.data);});

function createConnection(id,remote,fromServer=false){
  const handlers={data:[],end:[],close:[],open:[],error:[]};
  const conn={
    id,remote,fromServer,readable:true,writable:true,
    on(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);return this;},
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a);};return this.on(ev,w);},
    off(ev,fn){handlers[ev]=(handlers[ev]||[]).filter(x=>x!==fn);return this;},
    write(data){const peer=connections.get(conn._peerId);if(peer){queueMicrotask(()=>peer._onData(data));return true;}post({type:'data',id,data,from:getOrigin(),to:remote});return true;},
    end(data){if(data)conn.write(data);for(const h of handlers.close)h();connections.delete(id);},
    destroy(){for(const h of handlers.close)h();connections.delete(id);},
    _onOpen(){for(const h of handlers.open)h();},
    _onData(d){for(const h of handlers.data)h(d);},
    _onClose(){for(const h of handlers.close)h();},
    _onError(e){for(const h of handlers.error)h(e);},
    _peerId:null,
  };
  return conn;
}

export function makeBusnet(){
  return{
    listen(port,service,onConnection){
      if(listeners.has(port))throw Object.assign(new Error('EADDRINUSE'),{code:'EADDRINUSE',port});
      listeners.set(port,{port,service:service||'generic',onConnection,origin:getOrigin()});
      if(bus)bus.postMessage({type:'announce',port,service:service||'generic',origin:getOrigin()});
      return{port,close:()=>{listeners.delete(port);}};
    },
    connect(port,targetOrigin,cb){
      const id=getOrigin()+'-'+(connSeq++);
      const clientConn=createConnection(id,targetOrigin);
      connections.set(id,clientConn);
      if(cb)clientConn.on('open',cb);
      if(listeners.has(port)&&(!targetOrigin||targetOrigin===getOrigin())){
        const srvId=id+'-srv';
        const serverConn=createConnection(srvId,getOrigin(),true);
        connections.set(srvId,serverConn);
        clientConn._peerId=srvId; serverConn._peerId=id;
        const l=listeners.get(port);
        queueMicrotask(()=>{l.onConnection?.(serverConn);serverConn._onOpen();clientConn._onOpen();});
      }else{
        post({type:'connect',id,port,from:getOrigin(),to:targetOrigin});
      }
      return clientConn;
    },
    discover(filter){
      if(bus)bus.postMessage({type:'discover',origin:getOrigin()});
      return new Promise(r=>setTimeout(()=>{const out=[...serviceRegistry.values()];r(filter?.service?out.filter(s=>s.service===filter.service):out);},200));
    },
    getListeners(){return[...listeners.keys()];},
    getServices(){return[...serviceRegistry.values()];},
    origin:getOrigin(),
    _bus:bus,
  };
}

export function makeBusHttp(busnet){
  const respond=(conn,status,headers,body)=>{const res=`HTTP/1.1 ${status} ${status===200?'OK':'ERR'}\r\n`+Object.entries(headers||{}).map(([k,v])=>`${k}: ${v}`).join('\r\n')+`\r\nContent-Length: ${body.length}\r\n\r\n${body}`;conn.write(res);};
  return{
    createServer(handler){
      return{
        listen(port,host,cb){if(typeof host==='function'){cb=host;host=null;}busnet.listen(port,'http',conn=>{conn.on('data',raw=>{const[reqLine,...rest]=String(raw).split('\r\n');const[method,url]=reqLine.split(' ');const bodyIdx=rest.indexOf('');const headers={};for(const line of rest.slice(0,bodyIdx)){const [k,v]=line.split(':');if(k)headers[k.trim().toLowerCase()]=v?.trim();}const req={method,url,headers,body:rest.slice(bodyIdx+1).join('\r\n')};const res={statusCode:200,_headers:{},setHeader(k,v){this._headers[k]=v;},end(body){respond(conn,this.statusCode,this._headers,body||'');conn.end();}};handler(req,res);});});cb?.();return this;},
        close(cb){cb?.();},
      };
    },
    request(opts,cb){const port=opts.port,targetOrigin=opts.origin||null;const conn=busnet.connect(port,targetOrigin,()=>{const path=opts.path||'/';const method=opts.method||'GET';const hdrs=Object.entries(opts.headers||{}).map(([k,v])=>`${k}: ${v}`).join('\r\n');conn.write(`${method} ${path} HTTP/1.1\r\n${hdrs}\r\n\r\n`);});const handlers={response:[]};conn.on('data',raw=>{const[status,...rest]=String(raw).split('\r\n');const s=status.match(/HTTP\/\S+\s+(\d+)/);const bodyIdx=rest.indexOf('');const headers={};for(const line of rest.slice(0,bodyIdx)){const [k,v]=line.split(':');if(k)headers[k.trim().toLowerCase()]=v?.trim();}const body=rest.slice(bodyIdx+1).join('\r\n');const res={statusCode:s?+s[1]:200,headers,body,on(ev,fn){if(ev==='data')queueMicrotask(()=>fn(body));if(ev==='end')queueMicrotask(()=>fn());return res;}};for(const h of handlers.response)h(res);cb?.(res);});const req={on(ev,fn){if(ev==='response')handlers.response.push(fn);return req;},end(){},write(){}};return req;},
  };
}
