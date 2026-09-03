const env = (typeof globalThis !== 'undefined' && globalThis.__node_env) || {};
const _process = {
  env,
  // `browser: true` is the long-standing browserify/webpack convention a
  // polyfilled `process` sets to say "I look like Node but I'm not the real
  // thing" -- vendored bundles that sniff their own runtime (e.g. pyodide.mjs's
  // `typeof process==='object' && typeof process.versions.node==='string' &&
  // !process.browser`) rely on exactly this flag to tell a browser-shimmed
  // `process` apart from a real Node.js process, so THIS global boot-time
  // polyfill (installed unconditionally by docs/index.html/os.html for the
  // vendored freddie bundle) doesn't fool pyodide into thinking it's under
  // real Node and trying `import("node:fs/promises")`. `versions.node` itself
  // must stay a real dotted-version string -- docs/vendor/freddie/freddie.js
  // (`process.versions.node.split(".", 2)`) and docs/shell-runtime.js's
  // `detectRuntime()` both read it and would break if it were removed.
  browser: true,
  platform: 'browser',
  arch: 'wasm',
  version: 'v20.0.0',
  versions: { node: '20.0.0' },
  pid: 0,
  argv: ['/usr/bin/node'],
  cwd: () => (globalThis.__debug?.shell?.cwd || '/home'),
  nextTick: (cb, ...a) => queueMicrotask(() => cb(...a)),
  hrtime: (() => { const fn = () => { const ms = performance.now(); const s = Math.floor(ms / 1000); const ns = Math.floor((ms - s * 1000) * 1e6); return [s, ns]; }; fn.bigint = () => BigInt(Math.floor(performance.now() * 1e6)); return fn; })(),
  on: () => {}, off: () => {}, emit: () => false,
  stdout: { write: s => { try { globalThis.__debug?.shell?.term?.write?.(String(s)); } catch {} return true; } },
  stderr: { write: s => { try { globalThis.__debug?.shell?.term?.write?.(String(s)); } catch {} return true; } },
};
export default _process;
export const env_ = env;
export { env };
