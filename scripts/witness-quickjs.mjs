import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WASI } from 'node:wasi';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUICKJS_WASM_SHA256 } from './vendor-quickjs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = join(root, 'web', 'vendor', 'quickjs', 'qjs.wasm');
const CASES = [
  ['1 + 2', '3', 'exact'],
  ['[1, 2, 3].map((x) => x * x).join(",")', '1,4,9', 'exact'],
  ['JSON.stringify({ name: "ñ", list: [true, null] })', '{"name":"ñ","list":[true,null]}', 'exact'],
  ['(() => { let sum = 0; for (let i = 0; i < 1000; i += 1) sum += i; return sum; })()', '499500', 'exact'],
  ['(2n ** 64n).toString()', '18446744073709551616', 'exact'],
  ['Math.PI.toFixed(4)', '3.1416', 'exact'],
  ['/(\\d+)-(\\d+)/.exec("10-20")[2]', '20', 'exact'],
  ['"straße".toUpperCase()', 'STRASSE', 'exact'],
  ['throw new TypeError("boom")', 'Uncaught TypeError: boom', 'exact'],
  ['1 +', 'Uncaught SyntaxError', 'prefix'],
];

const bytes = readFileSync(wasmPath);
const module = new WebAssembly.Module(bytes);
const wasi = new WASI({ version: 'preview1', args: ['qjs'], env: {}, preopens: {} });
const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.wasiImport });
const exported = WebAssembly.Module.exports(module).map((entry) => entry.name);
if (!exported.includes('_initialize') || exported.includes('_start')) throw new Error('quickjs wasm is not a WASI reactor');
wasi.initialize(instance);
const { memory, malloc, free, qjs_init, thebird_eval } = instance.exports;
if (qjs_init() !== 0) throw new Error('qjs_init failed');

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const evaluate = (source) => {
  const input = encoder.encode(source);
  const inputPtr = malloc(input.length);
  new Uint8Array(memory.buffer, inputPtr, input.length).set(input);
  const resultPtr = thebird_eval(inputPtr, input.length);
  free(inputPtr);
  const heap = new Uint8Array(memory.buffer);
  let end = resultPtr;
  while (heap[end] !== 0) end += 1;
  return decoder.decode(heap.subarray(resultPtr, end));
};

const digest = createHash('sha256').update(bytes).digest('hex');
const pinned = digest === QUICKJS_WASM_SHA256;
console.log(`${pinned ? 'PASS' : 'FAIL'} wasm sha256 ${digest} (pinned ${QUICKJS_WASM_SHA256})`);
let passed = 0;
for (const [source, expected, mode] of CASES) {
  const got = evaluate(source);
  const ok = mode === 'prefix' ? got.startsWith(expected) : got === expected;
  if (ok) passed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${source} => ${JSON.stringify(got)}`);
}
console.log(`${passed}/${CASES.length} JS evaluations matched in the quickjs-ng wasm build`);
if (!pinned || passed !== CASES.length) {
  console.log('WITNESS-EXIT 1');
  process.exit(1);
}
console.log('WITNESS-EXIT 0');
