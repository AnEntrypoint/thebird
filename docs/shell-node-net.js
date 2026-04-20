const relayUrl=()=>{const g=globalThis;return g.__plugkit_tcp_relay||g.window?.__plugkit_tcp_relay||null;};
const udpRelayUrl=()=>{const g=globalThis;return g.__plugkit_udp_relay||g.window?.__plugkit_udp_relay||null;};

export function makeNet(Buf){
  class Socket{
    constructor(){this._h={};this._ws=null;this.bufferedAmount=0;this.writable=true;this.readable=true;this.remoteAddress=null;this.remotePort=null;this.destroyed=false;}
    _emit(ev,...a){for(const f of this._h[ev]||[])f(...a);}
    on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a);};return this.on(ev,w);}
    off(ev,fn){this._h[ev]=(this._h[ev]||[]).filter(x=>x!==fn);return this;}
    connect(opts,listener){const{port,host='127.0.0.1',tls=false}=typeof opts==='object'?opts:{port:opts,host:arguments[1]};const relay=relayUrl();if(!relay)throw new Error('net.Socket.connect: set window.__plugkit_tcp_relay to a WSS URL that tunnels TCP — not configured');this.remoteAddress=host;this.remotePort=port;const url=`${relay}${relay.includes('?')?'&':'?'}host=${encodeURIComponent(host)}&port=${port}${tls?'&tls=1':''}`;this._ws=new WebSocket(url);this._ws.binaryType='arraybuffer';this._ws.onopen=()=>{this._emit('connect');listener&&listener();};this._ws.onmessage=e=>{this._emit('data',Buf.from(e.data instanceof ArrayBuffer?new Uint8Array(e.data):new TextEncoder().encode(String(e.data))));};this._ws.onclose=()=>{this.destroyed=true;this._emit('end');this._emit('close');};this._ws.onerror=e=>this._emit('error',e);return this;}
    write(chunk,enc,cb){if(!this._ws||this._ws.readyState!==1){if(cb)cb(new Error('not connected'));return false;}const b=chunk instanceof Uint8Array?chunk:new TextEncoder().encode(String(chunk));this._ws.send(b);this.bufferedAmount=this._ws.bufferedAmount;if(cb)cb();return this.bufferedAmount<65536;}
    end(chunk){if(chunk)this.write(chunk);if(this._ws)this._ws.close();}
    destroy(err){this.destroyed=true;if(err)this._emit('error',err);if(this._ws)this._ws.close();}
    setEncoding(){return this;}
    setKeepAlive(){return this;}
    setNoDelay(){return this;}
    setTimeout(){return this;}
    pipe(dest){this.on('data',c=>{if(dest.write(c)===false)this._ws.send('__BACKPRESSURE__');});this.on('end',()=>dest.end?.());return dest;}
  }
  return{
    Socket,
    createConnection(...args){const s=new Socket();s.connect(...args);return s;},
    connect(...args){return this.createConnection(...args);},
    createServer(onConn){const bn=globalThis.__busnet;if(!bn)throw new Error('net.createServer: busnet not initialized');const handlers={connection:onConn?[onConn]:[]};let bnHandle=null;return{listen(port,host,cb){if(typeof host==='function'){cb=host;host=null;}bnHandle=bn.listen(port,'tcp',c=>{for(const h of handlers.connection)h(c);});cb?.();return this;},close(cb){bnHandle?.close();cb?.();},on(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);return this;},address(){return bnHandle?{address:'127.0.0.1',family:'IPv4',port:bnHandle.port}:null;},unref(){return this;},ref(){return this;}};},
    isIP:ip=>/^\d+\.\d+\.\d+\.\d+$/.test(ip)?4:ip.includes(':')?6:0,
    isIPv4:ip=>/^\d+\.\d+\.\d+\.\d+$/.test(ip),
    isIPv6:ip=>ip.includes(':'),
  };
}

export function makeTls(netMod,Buf){
  class TLSSocket extends netMod.Socket{
    constructor(){super();this.authorized=true;this.encrypted=true;}
  }
  return{
    TLSSocket,
    connect(opts,listener){const s=new TLSSocket();const port=typeof opts==='object'?opts.port:opts;const host=typeof opts==='object'?opts.host:arguments[1];s.connect({port,host,tls:true},listener);return s;},
    createServer(){throw new Error('tls.createServer: server sockets not supported');},
    DEFAULT_ECDH_CURVE:'auto',
    DEFAULT_MAX_VERSION:'TLSv1.3',
    DEFAULT_MIN_VERSION:'TLSv1.2',
    CLIENT_RENEG_LIMIT:3,
    rootCertificates:[],
    checkServerIdentity:()=>undefined,
    createSecureContext:()=>({}),
  };
}

export function makeDgram(Buf){
  class Dgram{
    constructor(type='udp4'){this.type=type;this._h={};this._ws=null;this._addr=null;}
    on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;}
    _emit(ev,...a){for(const f of this._h[ev]||[])f(...a);}
    bind(port,addr,cb){this._addr={port:port||0,address:addr||'0.0.0.0'};queueMicrotask(()=>{this._emit('listening');cb&&cb();});const relay=udpRelayUrl();if(!relay)return;this._ws=new WebSocket(relay);this._ws.binaryType='arraybuffer';this._ws.onmessage=e=>{const view=new DataView(e.data);const srcPortLen=view.getUint16(0);const portBytes=new Uint8Array(e.data,2,srcPortLen);const addrStr=new TextDecoder().decode(portBytes);const[ah,ap]=addrStr.split(':');const payload=new Uint8Array(e.data,2+srcPortLen);this._emit('message',Buf.from(payload),{address:ah,port:+ap,family:'IPv4',size:payload.length});};return this;}
    send(msg,offset,length,port,addr,cb){if(typeof offset==='number'&&typeof length==='number'){msg=msg.slice(offset,offset+length);}else{cb=addr;addr=port;port=length;}const relay=udpRelayUrl();if(!relay){if(cb)cb(new Error('dgram: set window.__plugkit_udp_relay'));return;}if(!this._ws){this._ws=new WebSocket(relay);this._ws.binaryType='arraybuffer';}const send=()=>{const target=`${addr}:${port}`;const tb=new TextEncoder().encode(target);const buf=new Uint8Array(2+tb.length+msg.length);new DataView(buf.buffer).setUint16(0,tb.length);buf.set(tb,2);buf.set(msg instanceof Uint8Array?msg:new TextEncoder().encode(String(msg)),2+tb.length);this._ws.send(buf);cb&&cb(null);};if(this._ws.readyState===1)send();else this._ws.addEventListener('open',send,{once:true});}
    address(){return this._addr||{address:'0.0.0.0',port:0,family:'IPv4'};}
    close(cb){if(this._ws)this._ws.close();this._emit('close');cb&&cb();}
    addMembership(){}
    dropMembership(){}
    setBroadcast(){}
    setTTL(){}
    setMulticastTTL(){}
    ref(){return this;}
    unref(){return this;}
  }
  return{
    Socket:Dgram,
    createSocket(type,cb){const s=new Dgram(typeof type==='object'?type.type:type);if(typeof cb==='function')s.on('message',cb);return s;},
  };
}
