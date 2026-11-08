import { createWasi } from './shims/wasi-preview1.js';
import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';

const WASM_URL = new URL('./vendor/txiki/tjs.wasm', import.meta.url).href;
const NOT_BUILT = 'tjs is not available in this site: the txiki.js wasm is not built here (node scripts/vendor-txiki.mjs)';
const TEMP_DIR = '/.thebird';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const handles = new Map();
let engine = null;
let cwd = '/workspace';
let session = null;

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
  if (current !== session) return;
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

async function load() {
  const response = await fetch(WASM_URL).catch(() => null);
  if (!response?.ok) throw new Error(NOT_BUILT);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const stdout = [];
  const stderr = [];
  const wasi = createWasi({ args: ['tjs'], stdout: (chunk) => stdout.push(chunk), stderr: (chunk) => stderr.push(chunk) });
  let memory = null;
  const bytesAt = (ptr, len) => new Uint8Array(memory.buffer, ptr, len);
  const textAt = (ptr, len) => decoder.decode(bytesAt(ptr, len));
  const absolute = (name) => posix.resolve(cwd, name);
  const host = {
    tjs_host_write(fd, ptr, len) {
      (fd === 2 ? stderr : stdout).push(bytesAt(ptr, len).slice());
    },
    tjs_bridge_send(ptr, len) {
      const message = JSON.parse(textAt(ptr, len));
      if (!session) return;
      if (message.op === 'open') startRequest(session, message);
      else if (message.op === 'abort') session.controllers.get(message.id)?.abort();
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
      const slots = new Float64Array(memory.buffer, out, 4);
      slots[0] = info.isDirectory() ? 2 : 1;
      slots[1] = info.size;
      slots[2] = info.mtimeMs;
      slots[3] = info.isDirectory() ? 0o40755 : 0o100644;
      return 0;
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
    tjs_fs_resolve(ptr, len, out, cap) {
      const bytes = encoder.encode(absolute(textAt(ptr, len)));
      if (bytes.length >= cap) return -1;
      bytesAt(out, cap).set(bytes);
      return bytes.length;
    },
    tjs_random(ptr, len) {
      globalThis.crypto.getRandomValues(bytesAt(ptr, len));
    },
    tjs_now_ms() {
      return Date.now();
    },
  };
  const instance = await WebAssembly.instantiate(module, { ...wasi.imports, env: host });
  memory = instance.exports.memory;
  wasi.bind(instance);
  instance.exports._initialize();
  return { instance, stdout, stderr };
}

function loaded() {
  engine ??= load().catch((err) => {
    engine = null;
    throw err;
  });
  return engine;
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

function callInput(exports, call, text) {
  const input = encoder.encode(`${text}\0`);
  const ptr = exports.malloc(input.length);
  new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
  const status = call(ptr);
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

export async function runTjs(source, dir = '/workspace', { signal } = {}) {
  const { instance, stdout, stderr } = await loaded();
  cwd = dir;
  stdout.splice(0);
  stderr.splice(0);
  const current = { events: [], wake: null, controllers: new Map() };
  session = current;
  const { exports } = instance;
  let status;
  try {
    status = callInput(exports, exports.tjs_browser_eval, source);
    while (status === 0 && (current.controllers.size > 0 || current.events.length > 0)) {
      const event = await nextEvent(current, signal);
      status = resumeWith(exports, event);
    }
  } finally {
    session = null;
    for (const controller of current.controllers.values()) controller.abort();
    exports.tjs_browser_end();
  }
  const output = joinChunks(stdout.splice(0)) + joinChunks(stderr.splice(0));
  return { output, status };
}

export async function tjsBuiltin(argv, dir, options) {
  if (argv.length !== 2 || argv[0] !== '-e') throw new Error('usage: tjs -e <code>');
  const { output, status } = await runTjs(argv[1], dir, options);
  if (status !== 0) throw new Error([output.trimEnd(), `tjs exited with status ${status}`].filter(Boolean).join('\n'));
  return output.trimEnd();
}
