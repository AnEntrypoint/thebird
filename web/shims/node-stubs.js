import * as acorn from '../vendor/acorn.mjs';
import { readdirSync } from './fs.js';
import { Buffer } from './buffer.js';

const NO_CHILD = 'child processes are not available in the browser; run this through the relay (?engine=relay) or a host shell';

function unavailable(syscall) {
  const err = new Error(`ENOSYS: ${NO_CHILD} (${syscall})`);
  err.code = 'ENOSYS';
  return err;
}

class Emitter {
  constructor() {
    this.listeners = new Map();
  }
  on(name, fn) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
    return this;
  }
  once(name, fn) {
    return this.on(name, fn);
  }
  emit(name, ...args) {
    for (const fn of this.listeners.get(name) ?? []) fn(...args);
  }
  setEncoding() {
    return this;
  }
  pipe(target) {
    return target;
  }
  resume() {
    return this;
  }
  pause() {
    return this;
  }
  destroy() {
    return this;
  }
  end() {
    return this;
  }
  write() {
    return false;
  }
}

export function spawn(file) {
  const child = new Emitter();
  child.stdout = new Emitter();
  child.stderr = new Emitter();
  child.stdin = new Emitter();
  child.pid = undefined;
  child.kill = () => false;
  queueMicrotask(() => {
    const err = unavailable('spawn ' + file);
    child.emit('error', err);
    child.emit('close', 127, null);
  });
  return child;
}

export function exec(command, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const err = unavailable('exec');
  queueMicrotask(() => done?.(err, '', ''));
  return spawn(command);
}

export function execFile(file, args, options, callback) {
  const done = [args, options, callback].find((arg) => typeof arg === 'function');
  const cwd = typeof options === 'object' ? options?.cwd : undefined;
  if (file === 'git' && Array.isArray(args) && args[0] === 'ls-files') {
    const stdout = listFiles(cwd ?? '/');
    queueMicrotask(() => done?.(null, stdout, ''));
    return spawn(file);
  }
  const err = unavailable('execFile ' + file);
  queueMicrotask(() => done?.(err, '', ''));
  return spawn(file);
}

const SKIPPED = new Set(['.git', '.thebird', 'node_modules']);

function listFiles(root) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(dir.replace(/\/$/, '') + '/' + entry.name, rel);
      else found.push(rel);
    }
  };
  walk(root, '');
  return found.sort().join('\0') + '\0';
}

execFile.custom = (file, args, options) => new Promise((ok, fail) => {
  execFile(file, args, options, (err, stdout, stderr) => (err ? fail(err) : ok({ stdout, stderr })));
});

export function spawnSync(file) {
  return { status: null, signal: null, stdout: '', stderr: '', error: unavailable('spawnSync ' + file) };
}

export function execFileSync(file) {
  throw unavailable('execFileSync ' + file);
}

export function execSync(command) {
  throw unavailable('execSync ' + command);
}

export function promisify(fn) {
  if (fn.custom) return fn.custom;
  return (...args) => new Promise((ok, fail) => {
    fn(...args, (err, ...values) => (err ? fail(err) : ok(values.length > 1 ? values : values[0])));
  });
}

export const tmpdir = () => '/tmp';
export const homedir = () => '/home/browser';
export const platform = () => 'linux';

export function createRequire() {
  return (id) => {
    if (id === 'acorn') return acorn;
    throw new Error(`require('${id}') is not available in the browser`);
  };
}

export class AsyncLocalStorage {
  constructor() {
    this.store = undefined;
  }
  run(store, fn, ...args) {
    const previous = this.store;
    this.store = store;
    try {
      return fn(...args);
    } finally {
      this.store = previous;
    }
  }
  getStore() {
    return this.store;
  }
}

export const performance = globalThis.performance;

