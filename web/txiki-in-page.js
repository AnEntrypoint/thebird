import { createWasi } from './shims/wasi-preview1.js';

const WASM_URL = new URL('./vendor/txiki/tjs.wasm', import.meta.url).href;
const NOT_BUILT = 'tjs is not available in this site: the txiki.js wasm is not built here (node scripts/vendor-txiki.mjs)';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let engine = null;

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
  const host = {
    tjs_host_write(fd, ptr, len) {
      const bytes = new Uint8Array(memory.buffer, ptr, len).slice();
      (fd === 2 ? stderr : stdout).push(bytes);
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

export async function evaluate(source) {
  const { instance, stdout, stderr } = await loaded();
  const { exports } = instance;
  const input = encoder.encode(`${source}\0`);
  const inputPtr = exports.malloc(input.length);
  new Uint8Array(exports.memory.buffer, inputPtr, input.length).set(input);
  const status = exports.tjs_browser_eval(inputPtr);
  exports.free(inputPtr);
  const output = joinChunks(stdout.splice(0)) + joinChunks(stderr.splice(0));
  return { output, status };
}

export async function tjsBuiltin(argv) {
  if (argv.length !== 2 || argv[0] !== '-e') throw new Error('usage: tjs -e <code>');
  const { output, status } = await evaluate(argv[1]);
  if (status !== 0) throw new Error([output.trimEnd(), `tjs exited with status ${status}`].filter(Boolean).join('\n'));
  return output.trimEnd();
}
