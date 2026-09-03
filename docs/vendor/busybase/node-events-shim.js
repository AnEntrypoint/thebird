// Minimal node:events EventEmitter shim — enough for busybase's bus.on/off/emit usage.
export class EventEmitter {
    constructor() { this._listeners = new Map(); this._max = 10; }
    setMaxListeners(n) { this._max = n; return this; }
    getMaxListeners() { return this._max; }
    eventNames() { return [...this._listeners.keys()]; }
    listenerCount(ev) { return (this._listeners.get(ev) || []).length; }
    on(ev, cb) {
        if (!this._listeners.has(ev)) this._listeners.set(ev, []);
        this._listeners.get(ev).push(cb);
        return this;
    }
    addListener(ev, cb) { return this.on(ev, cb); }
    once(ev, cb) {
        const wrap = (...args) => { this.off(ev, wrap); cb(...args); };
        return this.on(ev, wrap);
    }
    off(ev, cb) {
        const arr = this._listeners.get(ev);
        if (!arr) return this;
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
        if (!arr.length) this._listeners.delete(ev);
        return this;
    }
    removeListener(ev, cb) { return this.off(ev, cb); }
    removeAllListeners(ev) {
        if (ev) this._listeners.delete(ev);
        else this._listeners.clear();
        return this;
    }
    emit(ev, ...args) {
        const arr = this._listeners.get(ev);
        if (!arr || !arr.length) return false;
        for (const cb of arr.slice()) { try { cb(...args); } catch (e) { console.error('EventEmitter listener:', e); } }
        return true;
    }
}
export default { EventEmitter };
