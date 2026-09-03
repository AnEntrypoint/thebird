const relayUrl=()=>{const g=globalThis;return g.__plugkit_tcp_relay||g.window?.__plugkit_tcp_relay||null;};
const udpRelayUrl=()=>{const g=globalThis;return g.__plugkit_udp_relay||g.window?.__plugkit_udp_relay||null;};

export function makeNet(Buf){
  // The browser WebSocket cannot be backpressured (onmessage always fires), so a paused
  // consumer makes _rxQueue grow. Cap the buffered bytes so a flooding relay terminates the
  // socket loudly instead of exhausting memory; 16MB leaves room for legitimate transient buffering.
  const RX_HIGH_WATER=16*1024*1024;
  class Socket{
    constructor(){this._h={};this._ws=null;this.bufferedAmount=0;this.writable=false;this.readable=false;this.remoteAddress=null;this.remotePort=null;this.destroyed=false;this._paused=false;this._rxQueue=[];this._rxBytes=0;this._draining=false;this._overflow=false;this._writeQueue=[];}
    _emit(ev,...a){
      // While paused (or mid-drain) hold 'data' events in a FIFO queue and replay them on resume so
      // pipe() backpressure actually slows the source instead of dropping or reordering bytes.
      if(ev==='data'&&(this._paused||this._draining)){if(this._overflow){const err=new Error('net.Socket: receive buffer overflow ('+RX_HIGH_WATER+' bytes) while paused');for(const f of this._h.error||[])f(err);this.destroy();return;}const chunk=a[0];this._rxBytes+=(chunk&&chunk.length)||0;if(this._rxBytes>RX_HIGH_WATER){this._overflow=true;this._rxQueue.length=0;this._rxBytes=0;const err=new Error('net.Socket: receive buffer overflow ('+RX_HIGH_WATER+' bytes) while paused');for(const f of this._h.error||[])f(err);this.destroy();return;}this._rxQueue.push(a);return;}
      for(const f of this._h[ev]||[])f(...a);
    }
    pause(){this._paused=true;return this;}
    resume(){this._paused=false;if(!this._draining&&this._rxQueue.length)this._drain();return this;}
    _drain(){
      // Replay one queued chunk per microtask so a large _rxQueue cannot block paint/timers/input;
      // _draining keeps newly-arriving data queued behind the backlog so delivery stays FIFO.
      if(this._paused||!this._rxQueue.length){this._draining=false;return;}
      this._draining=true;const a=this._rxQueue.shift();const chunk=a[0];this._rxBytes-=(chunk&&chunk.length)||0;if(this._rxBytes<0)this._rxBytes=0;for(const f of this._h.data||[])f(...a);
      if(!this._paused&&this._rxQueue.length)queueMicrotask(()=>this._drain());else this._draining=false;
    }
    on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a);};return this.on(ev,w);}
    off(ev,fn){this._h[ev]=(this._h[ev]||[]).filter(x=>x!==fn);return this;}
    connect(opts,listener){if(this._ws&&this._ws.readyState<2)throw new Error('net.Socket.connect: already connecting or connected');const{port,host='127.0.0.1',tls=false}=typeof opts==='object'?opts:{port:opts,host:arguments[1]};const relay=relayUrl();if(!relay){const err=new Error('connect ENOTSUP '+host+':'+port+' (net.Socket.connect: set window.__plugkit_tcp_relay to a WSS URL that tunnels TCP - not configured)');Object.assign(err,{code:'ENOTSUP',errno:-86,syscall:'connect',address:host,port});queueMicrotask(()=>this._emit('error',err));return this;}const url=`${relay}${relay.includes('?')?'&':'?'}host=${encodeURIComponent(host)}&port=${port}${tls?'&tls=1':''}`;this._ws=new WebSocket(url);this._ws.binaryType='arraybuffer';
      // remoteAddress/remotePort are only honest once the handshake completes, so set them in onopen (not synchronously); until 'connect' fires they stay null.
      this._ws.onopen=()=>{this.remoteAddress=host;this.remotePort=port;this.readable=true;this.writable=true;const q=this._writeQueue;this._writeQueue=[];for(const[chunk,cb] of q)this._doWrite(chunk,cb);this._emit('connect');listener&&listener();};this._ws.onmessage=e=>{this._emit('data',Buf.from(e.data instanceof ArrayBuffer?new Uint8Array(e.data):new TextEncoder().encode(String(e.data))));};this._ws.onclose=()=>{this.destroyed=true;this._emit('end');this._emit('close');};this._ws.onerror=e=>this._emit('error',e);return this;}
    // write() backpressure: returns false when WebSocket.bufferedAmount exceeds TX_HIGH_WATER
    // (64KB) to signal the caller to pause writes. WebSocket.send() is fire-and-forget; a
    // network partition after send() returns can silently drop data with no error callback.
    // No end-to-end delivery guarantee is available -- the browser API does not expose wire
    // delivery state. Pause/resume are available via pause()/resume() for consumer-side flow.
    _doWrite(chunk,cb){const b=chunk instanceof Uint8Array?chunk:new TextEncoder().encode(String(chunk));try{this._ws.send(b);}catch(e){if(cb)cb(e);else this._emit('error',e);return false;}this.bufferedAmount=this._ws.bufferedAmount;if(cb)cb();return this._ws.bufferedAmount<65536;}
    write(chunk,enc,cb){if(typeof enc==='function'){cb=enc;}if(!this._ws){const err=new Error('Socket is closed');err.code='ERR_SOCKET_CLOSED';if(cb)cb(err);else this._emit('error',err);return false;}if(this._ws.readyState===2||this._ws.readyState===3){const err=new Error('This socket has been ended by the other party');err.code='EPIPE';if(cb)cb(err);else this._emit('error',err);return false;}if(this._ws.readyState===0){this._writeQueue.push([chunk,cb]);return true;}return this._doWrite(chunk,cb);}
    end(chunk){if(chunk)this.write(chunk);if(this._ws)this._ws.close();}
    destroy(err){this.destroyed=true;if(err)this._emit('error',err);if(this._ws)this._ws.close();}
    setEncoding(){return this;}
    setKeepAlive(){return this;}
    setNoDelay(){return this;}
    setTimeout(){return this;}
    pipe(dest){
      // Honor backpressure by pausing the source until the destination drains,
      // NOT by injecting a __BACKPRESSURE__ control string into the data stream
      // (that corrupted the payload the consumer received).
      // NOTE: pipe() supports ONE destination only and is not reentrant. A second
      // pipe() call before unpipe() throws to prevent the drain-event race where the
      // faster destination resumes the source while the slower one is still paused.
      if(this._pipeDest)throw new Error('pipe: destination already set, call unpipe() first');
      if(!dest.write||!dest.once)throw new Error('pipe: destination must implement write(chunk) and once(event,fn)');
      this._pipeDest=dest;
      this.on('data',c=>{try{if(dest.write(c)===false){this.pause();dest.once('drain',()=>this.resume());}}catch(err){this.pause();this._emit('error',err);}});
      this.on('end',()=>dest.end?.());
      return dest;
    }
    unpipe(dest){if(this._pipeDest===dest)this._pipeDest=null;return this;}
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
    constructor(type='udp4'){this.type=type;this._h={};this._ws=null;this._addr=null;this._wsQueue=null;this._wsTimeout=null;}
    on(ev,fn){(this._h[ev]=this._h[ev]||[]).push(fn);return this;}
    _emit(ev,...a){for(const f of this._h[ev]||[])f(...a);}
    // _openWs() ensures exactly one WebSocket is created for this dgram socket (shared for both
    // bind/rx and send/tx). Returns the existing ws if already opening or open.
    _openWs(relay){
      if(this._ws)return this._ws;
      this._ws=new WebSocket(relay);this._ws.binaryType='arraybuffer';
      this._wsQueue=[];
      this._wsTimeout=setTimeout(()=>{
        const q=this._wsQueue||[];this._wsQueue=null;this._wsTimeout=null;
        const err=new Error('dgram: WebSocket connection timeout');
        this._ws.close();
        for(const[,cb] of q){if(cb)cb(err);else this._emit('error',err);}
      },5000);
      this._ws.onopen=()=>{
        clearTimeout(this._wsTimeout);this._wsTimeout=null;
        const q=this._wsQueue||[];this._wsQueue=null;
        for(const[fn] of q)fn();
      };
      this._ws.onerror=()=>{
        clearTimeout(this._wsTimeout);this._wsTimeout=null;
        const q=this._wsQueue||[];this._wsQueue=null;
        const err=new Error('dgram.send: WebSocket connection failed before open');
        for(const[,cb] of q){if(cb)cb(err);else this._emit('error',err);}
      };
      return this._ws;
    }
    bind(port,addr,cb){this._addr={port:port||0,address:addr||'0.0.0.0'};const relay=udpRelayUrl();if(!relay){queueMicrotask(()=>this._emit('error',new Error('dgram bind: set window.__plugkit_udp_relay to a WSS URL that relays UDP — not configured')));return this;}const ws=this._openWs(relay);ws.onmessage=e=>{if(e.data.byteLength<2||(2+new DataView(e.data).getUint16(0))>e.data.byteLength){this._emit('error',new Error('dgram: relay frame too short'));return;}const view=new DataView(e.data);const srcPortLen=view.getUint16(0);const portBytes=new Uint8Array(e.data,2,srcPortLen);const addrStr=new TextDecoder().decode(portBytes);const sep=addrStr.lastIndexOf(':');if(sep<0){this._emit('error',new Error('dgram: malformed relay address "'+addrStr+'" (expected "address:port")'));return;}const ah=addrStr.slice(0,sep);const ap=Number(addrStr.slice(sep+1));if(!Number.isFinite(ap)||ap<0||ap>65535){this._emit('error',new Error('dgram: malformed relay port in "'+addrStr+'"'));return;}const payload=new Uint8Array(e.data,2+srcPortLen);this._emit('message',Buf.from(payload),{address:ah,port:ap,family:'IPv4',size:payload.length});};
      // Emit 'listening' only after WebSocket is confirmed open so callers can send immediately.
      const emitListening=()=>{this._emit('listening');cb&&cb();};
      if(ws.readyState===1){queueMicrotask(emitListening);}else if(this._wsQueue){this._wsQueue.push([emitListening,null]);}
      return this;}
    send(msg,offset,length,port,addr,cb){if(typeof offset==='number'&&typeof length==='number'){msg=msg.slice(offset,offset+length);}else{cb=addr;addr=port;port=length;}const relay=udpRelayUrl();if(!relay){const err=new Error('dgram: set window.__plugkit_udp_relay');if(cb)cb(err);else this._emit('error',err);return;}const ws=this._openWs(relay);const doSend=()=>{const target=`${addr}:${port}`;const tb=new TextEncoder().encode(target);const buf=new Uint8Array(2+tb.length+msg.length);new DataView(buf.buffer).setUint16(0,tb.length);buf.set(tb,2);buf.set(msg instanceof Uint8Array?msg:new TextEncoder().encode(String(msg)),2+tb.length);ws.send(buf);cb&&cb(null);};if(ws.readyState===1){doSend();return;}
      // Socket is mid-open: enqueue in the shared connection-level queue (one timeout for all).
      if(this._wsQueue)this._wsQueue.push([doSend,cb]);}
    address(){return this._addr||{address:'0.0.0.0',port:0,family:'IPv4'};}
    close(cb){clearTimeout(this._wsTimeout);this._wsTimeout=null;if(this._ws)this._ws.close();this._emit('close');cb&&cb();}
    addMembership(){throw new Error('dgram.addMembership: multicast group join not supported in browser UDP relay');}
    dropMembership(){throw new Error('dgram.dropMembership: multicast group leave not supported in browser UDP relay');}
    setBroadcast(){if(!this._addr)throw new Error('dgram.setBroadcast: socket not bound (EBADF)');return this;}
    setTTL(){throw new Error('dgram.setTTL: IP_TTL not supported in browser UDP relay');}
    setMulticastTTL(){throw new Error('dgram.setMulticastTTL: IP_MULTICAST_TTL not supported in browser UDP relay');}
    ref(){return this;}
    unref(){return this;}
  }
  return{
    Socket:Dgram,
    createSocket(type,cb){const s=new Dgram(typeof type==='object'?type.type:type);if(typeof cb==='function')s.on('message',cb);return s;},
  };
}
