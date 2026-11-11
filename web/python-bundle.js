import init, { decompress } from './vendor/brotli/brotli_dec_wasm.js';
import { createHash } from './shims/crypto.js';

export const BUNDLE_URL = 'https://anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br';
const FORMAT = 'pyodide-minimal/1';
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const CORE_PINS = {
  'pyodide.asm.mjs': 'f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635',
  'pyodide.asm.wasm': 'cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6',
  'pyodide.mjs': '6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109',
  'python_stdlib.zip': 'fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a',
};
const REQUIRED = [...Object.keys(CORE_PINS), 'pyodide-lock.json'];

let decoder = null;
let loading = null;
let ready = false;

export function unpack(raw) {
  const headerLength = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + headerLength)));
  if (header.format !== FORMAT) throw new Error(`unknown bundle format ${header.format}`);
  const payload = 4 + headerLength;
  const files = new Map();
  for (const { name, offset, bytes, sha256 } of header.files) {
    if (!FILE_NAME.test(name) || files.has(name)) throw new Error(`bad file name ${JSON.stringify(name)}`);
    const data = raw.slice(payload + offset, payload + offset + bytes);
    if (data.length !== bytes) throw new Error(`${name} is truncated`);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== sha256) throw new Error(`${name} sha256 ${digest} does not match the manifest`);
    if (CORE_PINS[name] && CORE_PINS[name] !== digest) throw new Error(`${name} sha256 ${digest} does not match the Pyodide 314.0.7 pin`);
    files.set(name, data);
  }
  for (const name of REQUIRED) {
    if (!files.has(name)) throw new Error(`${name} is missing from the bundle`);
  }
  return { files, lock: new TextDecoder().decode(files.get('pyodide-lock.json')) };
}

const CACHE_NAME = 'thebird-python-bundle-1';

const openCache = () => globalThis.caches?.open(CACHE_NAME).catch(() => null) ?? Promise.resolve(null);

async function downloadBundle(cache, signal) {
  const response = await fetch(BUNDLE_URL, { signal });
  if (!response.ok) throw new Error(`Python bundle: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  await cache?.put(BUNDLE_URL, new Response(compressed.slice())).catch(() => {});
  return compressed;
}

async function cachedBundle(cache) {
  const hit = await cache?.match(BUNDLE_URL).catch(() => null);
  return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
}

function decodeBundle(compressed) {
  decoder ??= init().catch((err) => {
    decoder = null;
    throw err;
  });
  return decoder.then(() => {
    try {
      return unpack(decompress(compressed));
    } catch (err) {
      throw new Error(`Python bundle: cannot decode (${err.message ?? err})`);
    }
  });
}

async function fetchBundle(signal) {
  const cache = await openCache();
  const cached = await cachedBundle(cache);
  if (cached) {
    try {
      return await decodeBundle(cached);
    } catch {
      await cache?.delete(BUNDLE_URL).catch(() => {});
    }
  }
  return decodeBundle(await downloadBundle(cache, signal));
}

export function pythonBundle({ signal } = {}) {
  loading ??= fetchBundle(signal).then((bundle) => {
    ready = true;
    return bundle;
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

export const pythonBundleReady = () => ready;
