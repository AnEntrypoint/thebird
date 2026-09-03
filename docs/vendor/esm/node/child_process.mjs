// Browser shim for node:child_process. The bundle imports `spawn` but
// doesn't call it on the agent-machine path. We export a stub that throws
// only if invoked, so module evaluation succeeds.
import { EventEmitter } from './events.mjs';
export function spawn(_cmd, _args, _opts) {
    const ee = new EventEmitter();
    queueMicrotask(() => ee.emit('error', new Error('child_process.spawn: not available in browser')));
    return Object.assign(ee, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: { write() {}, end() {} },
        kill() {},
        pid: -1,
    });
}
export function exec(_cmd, _opts, cb) {
    const err = new Error('child_process.exec: not available in browser');
    if (typeof cb === 'function') queueMicrotask(() => cb(err, '', ''));
    return spawn();
}
export function execSync() { throw new Error('child_process.execSync: not available in browser'); }
export function fork() { throw new Error('child_process.fork: not available in browser'); }
const _cp = { spawn, exec, execSync, fork };
export default _cp;
