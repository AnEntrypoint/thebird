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

export async function runTjs(source, dir = '/workspace') {
  const { instance, stdout, stderr } = await loaded();
  cwd = dir;
  const { exports } = instance;
  const input = encoder.encode(`${source}\0`);
  const inputPtr = exports.malloc(input.length);
  new Uint8Array(exports.memory.buffer, inputPtr, input.length).set(input);
  const status = exports.tjs_browser_eval(inputPtr);
  exports.free(inputPtr);
  const output = joinChunks(stdout.splice(0)) + joinChunks(stderr.splice(0));
  return { output, status };
}

export async function tjsBuiltin(argv, dir) {
  if (argv.length !== 2 || argv[0] !== '-e') throw new Error('usage: tjs -e <code>');
  const { output, status } = await runTjs(argv[1], dir);
  if (status !== 0) throw new Error([output.trimEnd(), `tjs exited with status ${status}`].filter(Boolean).join('\n'));
  return output.trimEnd();
}
