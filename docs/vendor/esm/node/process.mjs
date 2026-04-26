const env = (typeof globalThis !== 'undefined' && globalThis.__node_env) || {};
const _process = {
  env,
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
