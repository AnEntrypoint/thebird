import { createWasi } from '../../shims/wasi-preview1.js';

const page = import.meta.url;
const WASM_URL = globalThis.THEBIRD_GM_WASM_URL ?? new URL('./gm-core.wasm', page).href;
const MANIFEST_URL = globalThis.THEBIRD_GM_MANIFEST_URL ?? new URL('./manifest.json', page).href;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let corePromise = null;

const loadManifest = async () => {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error('gm vendor manifest is missing: run node scripts/vendor-gm.mjs');
  return response.json();
};

const instantiate = async () => {
  const [module, manifest] = await Promise.all([
    WebAssembly.compileStreaming(fetch(WASM_URL)).catch(() => fetch(WASM_URL).then((response) => {
      if (!response.ok) throw new Error('gm-core.wasm is missing: run node scripts/vendor-gm.mjs');
      return WebAssembly.compile(response.arrayBuffer());
    })),
    loadManifest(),
  ]);
  const wasi = createWasi({ args: ['gm-core'] });
  const instance = await WebAssembly.instantiate(module, wasi.imports);
  wasi.bind(instance);
  return { instance, manifest };
};

const core = () => {
  corePromise ??= instantiate().catch((error) => {
    corePromise = null;
    throw error;
  });
  return corePromise;
};

const call = (instance, name, text, ...extra) => {
  const input = encoder.encode(text);
  const ptr = instance.exports.gm_alloc(input.length);
  if (!ptr) throw new Error('gm wasm core could not allocate input');
  try {
    new Uint8Array(instance.exports.memory.buffer).set(input, ptr);
    const rc = instance.exports[name](ptr, input.length, ...extra);
    const length = instance.exports.gm_json_len();
    const out = decoder.decode(new Uint8Array(instance.exports.memory.buffer, instance.exports.gm_json_out(), length));
    return { rc, out };
  } finally {
    instance.exports.gm_free(ptr);
  }
};

export async function gmVersion() {
  const { instance, manifest } = await core();
  const version = instance.exports.gm_core_version();
  return `gm-core.wasm ${manifest.wasm.sha256.slice(0, 12)} C++ core ABI ${version}`;
}

export async function gmCheck() {
  const { instance, manifest } = await core();
  const result = await Promise.resolve().then(() => call(instance, 'gm_sha256_hex', 'abc'));
  if (result.rc !== 0 || result.out !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
    throw new Error(`gm wasm core failed its sha256 probe: ${result.out}`);
  }
  return `gm ready: core ${manifest.wasm.sha256.slice(0, 12)}; JSON and sha256 answered`;
}

export async function gmJsonNormalize(text) {
  const { instance } = await core();
  const { rc, out } = call(instance, 'gm_json_normalize', text);
  if (rc !== 0) throw new Error(out);
  return out;
}

export async function gmClip(text, cap = 400) {
  const { instance } = await core();
  const { rc, out } = call(instance, 'gm_clip', text, cap);
  if (rc !== 0) throw new Error(out);
  return out;
}

export async function gmOutputDigest(text, failed = false) {
  const { instance } = await core();
  const { rc, out } = call(instance, 'gm_output_digest', text, failed ? 1 : 0);
  if (rc !== 0) throw new Error(out);
  return JSON.parse(out);
}

export async function gmSha256Hex(text) {
  const { instance } = await core();
  const { rc, out } = call(instance, 'gm_sha256_hex', text);
  if (rc !== 0) throw new Error(out);
  return out;
}
