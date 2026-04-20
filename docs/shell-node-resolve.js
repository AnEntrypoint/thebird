const toKey = p => p.replace(/^\//, '');

const CONDITIONS = ['node', 'import', 'require', 'default', 'browser'];
function pickCondition(cond) {
  if (typeof cond === 'string') return cond;
  if (Array.isArray(cond)) { for (const c of cond) { const r = pickCondition(c); if (r) return r; } return null; }
  if (!cond || typeof cond !== 'object') return null;
  for (const k of CONDITIONS) if (k in cond) { const r = pickCondition(cond[k]); if (r) return r; }
  return null;
}
function matchPattern(patternKey, target) {
  if (!patternKey.includes('*')) return null;
  const [pre, post] = patternKey.split('*');
  if (target.startsWith(pre) && target.endsWith(post)) return target.slice(pre.length, target.length - post.length);
  return null;
}
export function resolveExports(pkgJson, subpath) {
  const exp = pkgJson.exports;
  if (!exp) return null;
  if (typeof exp === 'string') return subpath === '.' ? exp : null;
  const key = subpath === '.' ? '.' : './' + subpath.replace(/^\.\//, '');
  if (exp[key]) return pickCondition(exp[key]);
  if (subpath === '.' && !('.' in exp) && !Object.keys(exp).some(k => k.startsWith('.'))) return pickCondition(exp);
  for (const pk of Object.keys(exp)) { const m = matchPattern(pk, key); if (m !== null) { const t = pickCondition(exp[pk]); return t ? t.replace('*', m) : null; } }
  return null;
}
export function resolveImports(pkgJson, subpath) {
  const imps = pkgJson.imports;
  if (!imps || !subpath.startsWith('#')) return null;
  if (imps[subpath]) return pickCondition(imps[subpath]);
  for (const pk of Object.keys(imps)) { const m = matchPattern(pk, subpath); if (m !== null) { const t = pickCondition(imps[pk]); return t ? t.replace('*', m) : null; } }
  return null;
}

export function walkUpNodeModules(snap, startDir, pkgName) {
  let dir = startDir.replace(/\/$/, '') || '/';
  while (true) {
    const candidate = (dir === '/' ? '' : dir) + '/node_modules/' + pkgName;
    const candKey = toKey(candidate);
    if ((candKey + '/package.json') in snap || (candKey + '/index.js') in snap || (candKey + '.js') in snap) return candidate;
    if (dir === '/' || dir === '') return null;
    const up = dir.slice(0, dir.lastIndexOf('/')) || '/';
    if (up === dir) return null;
    dir = up;
  }
}

export function resolvePackageEntry(snap, pkgDir) {
  const pjKey = toKey(pkgDir) + '/package.json';
  if (!(pjKey in snap)) return null;
  let pj;
  try { pj = JSON.parse(snap[pjKey]); } catch { return null; }
  const resolved = resolveExports(pj, '.');
  if (resolved) return pkgDir + '/' + resolved.replace(/^\.\//, '');
  return pkgDir + '/' + (pj.main || 'index.js').replace(/^\.\//, '');
}

export function makeModuleModule(requireFn, MODULES) {
  return {
    builtinModules: Object.keys(MODULES).filter(k => !k.startsWith('node:')).sort(),
    createRequire: () => requireFn,
    _resolveFilename: (id, parent) => requireFn.resolve(id),
    _cache: requireFn.cache,
    _pathCache: {},
    Module: class Module { constructor(id) { this.id = id; this.exports = {}; this.filename = id; this.loaded = false; this.children = []; this.paths = []; } },
    syncBuiltinESMExports: () => {},
    wrap: s => '(function (exports, require, module, __filename, __dirname) { ' + s + '\n});',
    wrapper: ['(function (exports, require, module, __filename, __dirname) { ', '\n});'],
  };
}

export function makeModuleNotFoundError(id, requireStack) {
  const err = new Error("Cannot find module '" + id + "'" + (requireStack ? '\nRequire stack:\n- ' + requireStack.join('\n- ') : ''));
  err.code = 'MODULE_NOT_FOUND';
  err.requireStack = requireStack || [];
  return err;
}

export function makeFsPromises(fsSync) {
  const wrap = fn => async (...args) => fn(...args);
  return {
    readFile: async (p, enc) => fsSync.readFileSync(p, enc),
    writeFile: async (p, d) => fsSync.writeFileSync(p, d),
    appendFile: async (p, d) => fsSync.appendFileSync(p, d),
    access: async p => fsSync.accessSync(p),
    stat: async p => fsSync.statSync(p),
    readdir: async p => fsSync.readdirSync(p),
    mkdir: async (p, o) => fsSync.mkdirSync(p, o),
    rm: async (p, o) => fsSync.rmSync(p, o),
    rmdir: async (p, o) => fsSync.rmdirSync(p, o),
    unlink: async p => fsSync.unlinkSync(p),
    rename: async (o, n) => fsSync.renameSync(o, n),
    copyFile: async (s, d) => fsSync.copyFileSync(s, d),
    realpath: async p => fsSync.realpathSync(p),
    open: async p => ({ close: async () => {}, readFile: async enc => fsSync.readFileSync(p, enc), writeFile: async d => fsSync.writeFileSync(p, d) }),
  };
}

export function makeFsWatch() {
  return (path, opts, listener) => {
    if (typeof opts === 'function') { listener = opts; opts = {}; }
    const handlers = { change: listener ? [listener] : [], error: [], close: [] };
    const w = {
      on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return w; },
      close: () => { for (const h of handlers.close) h(); },
      ref: () => w, unref: () => w,
    };
    return w;
  };
}

export function makeNetStub() {
  return {
    Socket: class Socket { constructor() { throw new Error('net.Socket: not supported in browser — use fetch() or WebSocket'); } },
    createServer: () => { throw new Error('net.createServer: not supported in browser — use express via http builtin'); },
    connect: () => { throw new Error('net.connect: not supported in browser'); },
    isIP: ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? 4 : ip.includes(':') ? 6 : 0,
    isIPv4: ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip),
    isIPv6: ip => ip.includes(':'),
  };
}

export function makeDgramStub() {
  return {
    createSocket: () => { throw new Error('dgram.createSocket: UDP not available in browser'); },
    Socket: class { constructor() { throw new Error('dgram.Socket: UDP not available in browser'); } },
  };
}

export function makeWorkerThreadsStub() {
  return {
    Worker: class { constructor() { throw new Error('worker_threads.Worker: not supported — use Web Worker via new Worker(url)'); } },
    isMainThread: true,
    parentPort: null,
    workerData: null,
    threadId: 0,
    MessageChannel: globalThis.MessageChannel,
    MessagePort: globalThis.MessagePort,
  };
}
