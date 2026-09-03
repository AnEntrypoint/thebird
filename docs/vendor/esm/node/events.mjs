// Browser shim for node:events.
export class EventEmitter {
    constructor() { this._listeners = new Map(); this._max = 10; }
    on(evt, fn) { (this._listeners.get(evt) || this._listeners.set(evt, []).get(evt)).push(fn); return this; }
    once(evt, fn) { const wrap = (...a) => { this.off(evt, wrap); fn(...a); }; return this.on(evt, wrap); }
    off(evt, fn) { const arr = this._listeners.get(evt); if (!arr) return this; const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); return this; }
    removeListener(evt, fn) { return this.off(evt, fn); }
    removeAllListeners(evt) { if (evt == null) this._listeners.clear(); else this._listeners.delete(evt); return this; }
    emit(evt, ...args) { const arr = this._listeners.get(evt); if (!arr || !arr.length) return false; for (const fn of [...arr]) { try { fn(...args); } catch (e) { console.error(e); } } return true; }
    listenerCount(evt) { return (this._listeners.get(evt) || []).length; }
    listeners(evt) { return [...(this._listeners.get(evt) || [])]; }
    addListener(evt, fn) { return this.on(evt, fn); }
    setMaxListeners(n) { this._max = n; return this; }
    getMaxListeners() { return this._max; }
    eventNames() { return [...this._listeners.keys()]; }
}
export default EventEmitter;
