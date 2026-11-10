import { createWasi, WasiExit } from './shims/wasi-preview1.js';
import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';

const WASM_URL = new URL('./vendor/txiki/tjs.wasm', import.meta.url).href;
const NOT_BUILT = 'tjs is not available in this site: the txiki.js wasm is not built here (node scripts/vendor-txiki.mjs)';
const TEMP_DIR = '/.thebird';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const handles = new Map();
const idle = [];
let modulePromise = null;
let cancelWord = null;
const TJS_WAITING = 2;
export const TJS_TIMED_OUT = 124;
export const TJS_CANCELLED = 130;
const TICK_MS = 5;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setCancelWord(word) {
  cancelWord = word;
}

export function clearCancel() {
  if (cancelWord) Atomics.store(cancelWord, 0, 0);
}

const joinChunks = (chunks) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(out);
};

export function bytesFromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const bytesToBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

function emit(current, event) {
  if (!current.live) return;
  current.events.push(JSON.stringify(event));
  const wake = current.wake;
  current.wake = null;
  wake?.();
}

const failureOf = (err, state) => {
  if (state.timedOut) return 'TIMED_OUT';
  if (err?.name === 'AbortError') return 'ABORTED';
  return 'FAILED';
};

function startBuiltin(current, message) {
  const { id } = message;
  const controller = new AbortController();
  current.calls.set(id, controller);
  const settle = (result) => {
    if (current.calls.delete(id)) emit(current, { id, kind: 'bridge', ...result });
  };
  Promise.resolve()
    .then(() => {
      if (!current.builtin) throw new Error('no builtin bridge is open for this run');
      return current.builtin(message.name, message.argv, message.cwd, controller.signal);
    })
    .then(
      (out) => settle({ code: 0, out, err: '' }),
      (err) => settle(err?.message === 'cancelled'
        ? { code: 130, out: '', err: 'cancelled\n' }
        : { code: err?.exitCode ?? 1, out: '', err: `${message.name}: ${err?.message ?? err}\n` }),
    );
}

function startRequest(current, message) {
  const { id } = message;
  const controller = new AbortController();
  const state = { timedOut: false };
  current.controllers.set(id, controller);
  const timer = message.timeout > 0 ? setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, message.timeout) : null;
  const init = { method: message.method, headers: message.headers, signal: controller.signal, credentials: message.credentials, redirect: 'follow' };
  if (message.body !== null) init.body = bytesFromBase64(message.body);
  const complete = (error, reason) => {
    clearTimeout(timer);
    current.controllers.delete(id);
    emit(current, { id, kind: 'complete', error, reason });
  };
  (async () => {
    const response = await fetch(message.url, init);
    emit(current, { id, kind: 'status', status: response.status });
    emit(current, { id, kind: 'url', url: response.url });
    response.headers.forEach((value, name) => emit(current, { id, kind: 'header', name, value }));
    emit(current, { id, kind: 'headersend' });
    const reader = response.body?.getReader();
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      emit(current, { id, kind: 'data', data: bytesToBase64(value) });
    }
  })().then(() => complete(null, null), (err) => complete(failureOf(err, state), err?.message ?? null));
}

function compiled() {
  modulePromise ??= (async () => {
    const response = await fetch(WASM_URL).catch(() => null);
    if (!response?.ok) throw new Error(NOT_BUILT);
    return WebAssembly.compile(await response.arrayBuffer());
  })().catch((err) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}

async function instantiate() {
  const module = await compiled();
  const slot = { stdout: [], stderr: [], cwd: '/workspace', session: null, memory: null, exports: null };
  const wasi = createWasi({ args: ['tjs'], stdout: (chunk) => slot.stdout.push(chunk), stderr: (chunk) => slot.stderr.push(chunk) });
  const bytesAt = (ptr, len) => new Uint8Array(slot.memory.buffer, ptr, len);
let storage = null;
const refreshStorage = () => {
  navigator.storage?.estimate?.().then((estimate) => {
    storage = estimate;
  }, () => {});
};
refreshStorage();
  const textAt = (ptr, len) => decoder.decode(bytesAt(ptr, len));
  const absolute = (name) => posix.resolve(slot.cwd, name);
  const host = {
    tjs_host_write(fd, ptr, len) {
      (fd === 2 ? slot.stderr : slot.stdout).push(bytesAt(ptr, len).slice());
    },
    tjs_bridge_send(ptr, len) {
      const message = JSON.parse(textAt(ptr, len));
      const current = slot.session;
      if (!current) return;
      if (message.op === 'open') startRequest(current, message);
      else if (message.op === 'abort') current.controllers.get(message.id)?.abort();
      else if (message.op === 'builtin') startBuiltin(current, message);
    },
    tjs_cancel_requested() {
      return cancelWord ? Atomics.load(cancelWord, 0) : 0;
    },
    tjs_fs_open(ptr, len, create) {
      const path = absolute(textAt(ptr, len));
      try {
        const info = fs.statSync(path, { throwIfNoEntry: false });
        if (info?.isDirectory()) return -1;
        if (!info) {
          if (!create) return -1;
          if (path.startsWith(`${TEMP_DIR}/`)) fs.mkdirSync(TEMP_DIR, { recursive: true });
          fs.writeFileSync(path, new Uint8Array(0));
        }
        const fd = fs.openSync(path, 'r+');
        handles.set(fd, path);
        return fd;
      } catch {
        return -1;
      }
    },
    tjs_fs_close(fd) {
      handles.delete(fd);
      fs.closeSync(fd);
    },
    tjs_fs_size(fd) {
      const path = handles.get(fd);
      if (path === undefined) return -1;
      try {
        return fs.statSync(path).size;
      } catch {
        return -1;
      }
    },
    tjs_fs_read(fd, ptr, len, offset) {
      if (!handles.has(fd)) return -1;
      try {
        return fs.readSync(fd, bytesAt(ptr, len), 0, len, offset);
      } catch {
        return -1;
      }
    },
    tjs_fs_write(fd, ptr, len, offset) {
      if (!handles.has(fd)) return -1;
      try {
        return fs.writeAtSync(fd, bytesAt(ptr, len), offset);
      } catch {
        return -1;
      }
    },
    tjs_fs_truncate(fd, size) {
      if (!handles.has(fd)) return -1;
      try {
        fs.truncateSync(fd, size);
        return 0;
      } catch {
        return -1;
      }
    },
    tjs_fs_access(ptr, len) {
      try {
        return fs.existsSync(absolute(textAt(ptr, len))) ? 1 : 0;
      } catch {
        return 0;
      }
    },
    tjs_fs_delete(ptr, len) {
      try {
        fs.unlinkSync(absolute(textAt(ptr, len)));
        return 0;
      } catch {
        return -1;
      }
    },
    tjs_fs_stat(ptr, len, out) {
      const info = fs.statSync(absolute(textAt(ptr, len)), { throwIfNoEntry: false });
      if (!info) return -1;
      const slots = new Float64Array(slot.memory.buffer, out, 8);
      slots[0] = info.isDirectory() ? 2 : 1;
      slots[1] = info.size;
      slots[2] = info.mtimeMs;
      slots[3] = info.mode;
      slots[4] = info.uid;
      slots[5] = info.gid;
      slots[6] = info.atimeMs;
      slots[7] = info.nlink;
      return 0;
    },
    tjs_fs_link(tptr, tlen, pptr, plen) {
      try {
        fs.linkSync(absolute(textAt(tptr, tlen)), absolute(textAt(pptr, plen)));
        return 0;
      } catch (err) {
        return { ENOENT: -2, EEXIST: -17, EPERM: -1 }[err.code] ?? -5;
      }
    },
    tjs_fs_quota(out) {
      if (!storage || storage.quota === undefined) return -1;
      const slots = new Float64Array(slot.memory.buffer, out, 2);
      slots[0] = storage.quota;
      slots[1] = storage.usage ?? 0;
      return 0;
    },
    tjs_fs_flush(id) {
      fs.flushFs().then(
        () => {
          refreshStorage();
          slot.exports.tjs_fs_flush_done(id, 0);
        },
        () => slot.exports.tjs_fs_flush_done(id, 1),
      );
      return 0;
    },
    tjs_fs_setattr(ptr, len, follow, attr, value) {
      const name = ['mode', 'uid', 'gid', 'atime', 'mtime'][attr];
      if (!name) return -1;
      return fs.setAttrSync(absolute(textAt(ptr, len)), follow !== 0, name, value);
    },
    tjs_fs_readdir(ptr, len, out, cap) {
      let names;
      try {
        names = fs.readdirSync(absolute(textAt(ptr, len)));
      } catch {
        return -1;
      }
      const bytes = encoder.encode(names.map((name) => `${name}\0`).join(''));
      if (bytes.length <= cap) bytesAt(out, bytes.length).set(bytes);
      return bytes.length;
    },
    tjs_fs_mkdir(ptr, len) {
      try {
        fs.mkdirSync(absolute(textAt(ptr, len)));
        return 0;
      } catch {
        return -1;
      }
    },
    tjs_fs_rmdir(ptr, len) {
      try {
        fs.rmdirSync(absolute(textAt(ptr, len)));
        return 0;
      } catch {
        return -1;
      }
    },
    tjs_fs_lstat(ptr, len, out) {
      const info = fs.lstatSync(absolute(textAt(ptr, len)), { throwIfNoEntry: false });
      if (!info) return -1;
      const link = info.isSymbolicLink();
      const dir = !link && info.isDirectory();
      const slots = new Float64Array(slot.memory.buffer, out, 8);
      slots[0] = link ? 3 : dir ? 2 : 1;
      slots[1] = info.size;
      slots[2] = info.mtimeMs;
      slots[3] = info.mode;
      slots[4] = info.uid;
      slots[5] = info.gid;
      slots[6] = info.atimeMs;
      slots[7] = info.nlink;
      return 0;
    },
    tjs_fs_symlink(tptr, tlen, pptr, plen) {
      try {
        fs.symlinkSync(textAt(tptr, tlen), absolute(textAt(pptr, plen)));
        return 0;
      } catch {
        return -1;
      }
    },
    tjs_fs_readlink(ptr, len, out, cap) {
      let target;
      try {
        target = fs.readlinkSync(absolute(textAt(ptr, len)));
      } catch {
        return -1;
      }
      const bytes = encoder.encode(target);
      if (bytes.length <= cap) bytesAt(out, bytes.length).set(bytes);
      return bytes.length;
    },
    tjs_fs_resolve(ptr, len, out, cap) {
      const bytes = encoder.encode(absolute(textAt(ptr, len)));
      if (bytes.length >= cap) return -1;
      bytesAt(out, cap).set(bytes);
      return bytes.length;
    },
    tjs_fs_realpath(ptr, len, out, cap) {
      let target;
      try {
        target = fs.realpathSync(absolute(textAt(ptr, len)));
      } catch {
        return -1;
      }
      const bytes = encoder.encode(target);
      if (bytes.length <= cap) bytesAt(out, bytes.length).set(bytes);
      return bytes.length;
    },
    tjs_fs_rename(fromPtr, fromLen, toPtr, toLen) {
      try {
        fs.renameSync(absolute(textAt(fromPtr, fromLen)), absolute(textAt(toPtr, toLen)));
        return 0;
      } catch {
        return -1;
      }
    },
    tjs_os_info(out, cap) {
      const record = {
        hostname: location.hostname,
        pid: 1,
        ppid: 0,
        passwd_name: 'thebird',
        passwd_home: '/.thebird',
        passwd_shell: '',
        passwd_uid: 0,
        passwd_gid: 0,
        cpu_count: navigator.hardwareConcurrency ?? 1,
        cpu_model: 'browser',
        interfaces: 0,
        uptime_s: performance.now() / 1000,
        exepath: '/.thebird/tjs',
      };
      const bytes = encoder.encode(JSON.stringify(record));
      if (bytes.length >= cap) return -1;
      bytesAt(out, cap).set(bytes);
      return bytes.length;
    },
    tjs_os_chdir(ptr, len) {
      const target = absolute(textAt(ptr, len));
      const info = fs.statSync(target, { throwIfNoEntry: false });
      if (!info || !info.isDirectory()) return -1;
      slot.cwd = target;
      return 0;
    },
    tjs_random(ptr, len) {
      globalThis.crypto.getRandomValues(bytesAt(ptr, len));
    },
    tjs_now_ms() {
      return Date.now();
    },
  };
  const instance = await WebAssembly.instantiate(module, { ...wasi.imports, env: host });
  slot.memory = instance.exports.memory;
  slot.exports = instance.exports;
  wasi.bind(instance);
  instance.exports._initialize();
  return slot;
}

const acquire = () => idle.pop() ?? instantiate();

function release(slot) {
  idle.push(slot);
}

function nextEvent(current, signal) {
  if (current.events.length) return Promise.resolve(current.events.shift());
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      current.wake = null;
      reject(new Error('cancelled'));
    };
    if (signal?.aborted) return cancelled();
    signal?.addEventListener('abort', cancelled, { once: true });
    current.wake = () => {
      signal?.removeEventListener('abort', cancelled);
      resolve(current.events.shift());
    };
  });
}

function callEval(exports, code, name) {
  const input = encoder.encode(`${code}\0`);
  const label = encoder.encode(`${name}\0`);
  const ptr = exports.malloc(input.length);
  const labelPtr = exports.malloc(label.length);
  new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
  new Uint8Array(exports.memory.buffer, labelPtr, label.length).set(label);
  const status = exports.tjs_browser_eval(ptr, labelPtr);
  exports.free(labelPtr);
  exports.free(ptr);
  return status;
}

function resumeWith(exports, event) {
  const bytes = encoder.encode(event);
  const ptr = exports.malloc(bytes.length);
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  const status = exports.tjs_browser_resume(ptr, bytes.length);
  exports.free(ptr);
  return status;
}

export async function runTjs(source, dir = '/workspace', { signal, timeoutMs, builtin, name = '<tjs -e>' } = {}) {
  if (signal?.aborted) return { output: '', status: TJS_CANCELLED };
  await fs.hydrate();
  const slot = await acquire();
  const { exports } = slot;
  slot.cwd = dir;
  slot.stdout.splice(0);
  slot.stderr.splice(0);
  const current = { live: true, events: [], wake: null, controllers: new Map(), calls: new Map(), builtin };
  slot.session = current;
  const cancel = () => exports.tjs_browser_cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  let status;
  try {
    exports.tjs_browser_set_deadline(timeoutMs ? Date.now() + timeoutMs : 0);
    status = callEval(exports, source, name);
    while (status === TJS_WAITING || (status === 0 && (current.controllers.size > 0 || current.calls.size > 0 || current.events.length > 0))) {
      if (current.events.length) status = resumeWith(exports, current.events.shift());
      else if (status === TJS_WAITING) {
        await pause(TICK_MS);
        status = exports.tjs_browser_tick();
      } else status = resumeWith(exports, await nextEvent(current, signal));
    }
  } catch (err) {
    if (!(err instanceof WasiExit)) throw err;
    status = err.code;
  } finally {
    signal?.removeEventListener('abort', cancel);
    exports.tjs_browser_set_deadline(0);
    current.live = false;
    slot.session = null;
    for (const controller of current.controllers.values()) controller.abort();
    for (const call of current.calls.values()) call.abort();
    exports.tjs_browser_end();
    release(slot);
  }
  const output = joinChunks(slot.stdout.splice(0)) + joinChunks(slot.stderr.splice(0));
  return { output, status };
}

export async function tjsBuiltin(argv, dir, options) {
  if (argv.length !== 2 || argv[0] !== '-e') throw new Error('usage: tjs -e <code>');
  const { output, status } = await runTjs(argv[1], dir, options);
  if (status === TJS_CANCELLED) throw new Error('cancelled');
  if (status === TJS_TIMED_OUT) throw new Error('timeout: command timed out');
  if (status !== 0) throw Object.assign(new Error(`tjs exited with status ${status}`), { exitCode: status, stdout: output.trimEnd() });
  return output.trimEnd();
}
