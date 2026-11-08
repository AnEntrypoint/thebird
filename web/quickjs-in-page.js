import { createWasi } from './shims/wasi-preview1.js';

const WASM_URL = new URL('./vendor/quickjs/qjs.wasm', import.meta.url).href;
const NOT_BUILT = 'qjs is not available in this site: the quickjs-ng engine is not built here (npm run vendor:quickjs)';
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
  const wasi = createWasi({ stdout: (chunk) => stdout.push(chunk), stderr: (chunk) => stderr.push(chunk) });
  const instance = await WebAssembly.instantiate(module, wasi.imports);
  wasi.bind(instance);
  instance.exports._initialize();
  if (instance.exports.qjs_init() !== 0) throw new Error('quickjs failed to start');
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
  const input = encoder.encode(source);
  const inputPtr = exports.malloc(input.length);
  new Uint8Array(exports.memory.buffer, inputPtr, input.length).set(input);
  const resultPtr = exports.thebird_eval(inputPtr, input.length);
  exports.free(inputPtr);
  if (resultPtr === 0) throw new Error('quickjs ran out of memory');
  const heap = new Uint8Array(exports.memory.buffer);
  let end = resultPtr;
  while (heap[end] !== 0) end += 1;
  const result = decoder.decode(heap.subarray(resultPtr, end));
  const output = joinChunks(stdout.splice(0)) + joinChunks(stderr.splice(0));
  return { output, result };
}

export async function qjsBuiltin(argv) {
  if (argv.length !== 2 || argv[0] !== '-e') throw new Error('usage: qjs -e <code>');
  const { output, result } = await evaluate(argv[1]);
  if (result.startsWith('Uncaught ')) throw new Error([output.trimEnd(), result].filter(Boolean).join('\n'));
  return output;
}
