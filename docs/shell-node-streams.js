function makeEmitter(){
  const h={};
  return {
    on(e,f){(h[e]=h[e]||[]).push(f);return this;},
    once(e,f){const w=(...a)=>{this.off(e,w);f(...a);};return this.on(e,w);},
    off(e,f){h[e]=(h[e]||[]).filter(x=>x!==f);return this;},
    removeListener(e,f){return this.off(e,f);},
    removeAllListeners(e){if(e)delete h[e];else for(const k of Object.keys(h))delete h[k];return this;},
    emit(e,...a){for(const f of(h[e]||[]).slice())f(...a);return(h[e]||[]).length>0;},
    listenerCount(e){return(h[e]||[]).length;},
    _h:h,
  };
}

class Readable{
  constructor(opts={}){
    Object.assign(this,makeEmitter());
    this._q=[];this._ended=false;this._flowing=null;this._paused=false;this._destroyed=false;
    this.readable=true;this.readableHighWaterMark=opts.highWaterMark??16384;this.readableEnded=false;this.readableObjectMode=!!opts.objectMode;
    this._read=opts.read||(()=>{});this._encoding=null;
  }
  push(chunk){if(chunk===null){this._ended=true;queueMicrotask(()=>this._drain());return false;}this._q.push(chunk);queueMicrotask(()=>this._drain());return this._q.length<this.readableHighWaterMark;}
  read(n){if(!this._q.length)return null;return n?this._q.shift():this._q.shift();}
  _drain(){if(this._paused||this._destroyed)return;while(this._q.length){const c=this._q.shift();const data=this._encoding&&c instanceof Uint8Array?new TextDecoder(this._encoding).decode(c):c;this.emit('data',data);}if(this._ended&&!this.readableEnded){this.readableEnded=true;this.emit('end');}}
  pause(){this._paused=true;return this;}
  resume(){this._paused=false;queueMicrotask(()=>this._drain());return this;}
  pipe(dest){this.on('data',c=>{if(dest.write(c)===false)this.pause();});this.on('end',()=>dest.end?.());dest.on?.('drain',()=>this.resume());return dest;}
  unpipe(){return this;}
  setEncoding(enc){this._encoding=enc;return this;}
  destroy(e){this._destroyed=true;if(e)this.emit('error',e);this.emit('close');return this;}
  [Symbol.asyncIterator](){const self=this;return{async next(){if(self._q.length)return{value:self._q.shift(),done:false};if(self._ended)return{value:undefined,done:true};return new Promise(r=>{const onData=c=>{self.off('data',onData);self.off('end',onEnd);r({value:c,done:false});};const onEnd=()=>{self.off('data',onData);r({value:undefined,done:true});};self.on('data',onData);self.once('end',onEnd);});}};}
}

class Writable{
  constructor(opts={}){
    Object.assign(this,makeEmitter());
    this._write=opts.write||((c,e,cb)=>cb());this.writable=true;this.writableEnded=false;this.writableFinished=false;this.writableHighWaterMark=opts.highWaterMark??16384;this._pending=0;
  }
  write(chunk,enc,cb){if(typeof enc==='function'){cb=enc;enc=null;}if(this.writableEnded){const e=Object.assign(new Error('write after end'),{code:'ERR_STREAM_WRITE_AFTER_END'});queueMicrotask(()=>cb?.(e));return false;}this._pending++;this._write(chunk,enc,err=>{this._pending--;cb?.(err);if(this._pending===0)this.emit('drain');});return this._pending<this.writableHighWaterMark;}
  end(chunk,enc,cb){if(chunk!=null)this.write(chunk,enc);this.writableEnded=true;queueMicrotask(()=>{this.writableFinished=true;this.emit('finish');this.emit('close');cb?.();});return this;}
  destroy(e){if(e)this.emit('error',e);this.emit('close');return this;}
}

class Duplex extends Readable{constructor(opts={}){super(opts);Object.assign(this,new Writable(opts));this._write=opts.write||((c,e,cb)=>cb());}write(...a){return Writable.prototype.write.call(this,...a);}end(...a){return Writable.prototype.end.call(this,...a);}}

class Transform extends Duplex{
  constructor(opts={}){super(opts);this._transform=opts.transform||((c,e,cb)=>cb(null,c));this._flush=opts.flush||(cb=>cb());this._write=(c,e,cb)=>{this._transform(c,e,(err,out)=>{if(err)return cb(err);if(out!=null)this.push(out);cb();});};const origEnd=this.end.bind(this);this.end=(...a)=>{this._flush((err,out)=>{if(out!=null)this.push(out);this.push(null);});return origEnd(...a);};}
}

class PassThrough extends Transform{constructor(opts){super({...opts,transform:(c,e,cb)=>cb(null,c)});}}

function pipeline(...args){const cb=typeof args[args.length-1]==='function'?args.pop():null;const streams=args;let done=false;const fin=e=>{if(done)return;done=true;cb?.(e);};for(let i=0;i<streams.length-1;i++){const src=streams[i],dst=streams[i+1];src.on('error',fin);src.pipe(dst);}streams[streams.length-1].on('finish',()=>fin(null));streams[streams.length-1].on('error',fin);return streams[streams.length-1];}

function finished(stream,cb){const onFin=()=>cb();const onErr=e=>cb(e);stream.on?.('finish',onFin);stream.on?.('end',onFin);stream.on?.('error',onErr);return()=>{stream.off?.('finish',onFin);stream.off?.('end',onFin);stream.off?.('error',onErr);};}

export function makeStream(){
  const mod={Readable,Writable,Duplex,Transform,PassThrough,pipeline,finished,promises:{pipeline:(...a)=>new Promise((res,rej)=>pipeline(...a,e=>e?rej(e):res())),finished:s=>new Promise((res,rej)=>finished(s,e=>e?rej(e):res()))}};
  Readable.from=iter=>{const r=new Readable();(async()=>{try{for await(const c of iter)r.push(c);r.push(null);}catch(e){r.destroy(e);}})();return r;};
  return mod;
}

export function extendFsStreams(fs,Buf){
  fs.createReadStream=(path,opts={})=>{const r=new Readable();queueMicrotask(()=>{try{const data=fs.readFileSync(path);const buf=typeof data==='string'?Buf.from(data):data;const start=opts.start||0;const end=opts.end??buf.length;r.push(buf.slice(start,end));r.push(null);}catch(e){r.destroy(e);}});return r;};
  fs.createWriteStream=(path,opts={})=>{const chunks=[];const w=new Writable({write:(c,e,cb)=>{chunks.push(typeof c==='string'?Buf.from(c):c);cb();}});w.on('finish',()=>{try{fs.writeFileSync(path,Buf.concat(chunks));}catch(e){w.emit('error',e);}});return w;};
  return fs;
}
