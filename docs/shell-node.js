import { createPath, createFs, createEvents, createUrl, createQuerystring, createBuffer } from './node-builtins.js';
import { createExpress, createHttp, createSqlite, createConsole, createProcess, NODE_VERSION, NODE_VERSIONS, NodeExit } from './shell-node-modules.js';

export function createNodeEnv({ ctx, term }) {
  const pathmod = createPath();
  const fsmod = createFs();
  const Buf = createBuffer();
  const MODULES = {
    path: () => pathmod,
    fs: () => fsmod,
    events: () => createEvents(),
    url: () => createUrl(),
    querystring: () => createQuerystring(),
    os: () => ({ platform: () => 'linux', arch: () => 'x64', homedir: () => '/', tmpdir: () => '/tmp', cpus: () => [{}], totalmem: () => 1073741824, freemem: () => 536870912, hostname: () => 'thebird', EOL: '\n', release: () => '6.0.0' }),
    util: () => ({ format: (...a) => a.join(' '), inspect: o => JSON.stringify(o, null, 2), promisify: fn => (...a) => new Promise((r, j) => fn(...a, (e, v) => e ? j(e) : r(v))), types: { isPromise: p => p instanceof Promise } }),
    crypto: () => ({ randomBytes: n => Buf.from(Array.from({ length: n }, () => Math.random() * 256 | 0)), randomUUID: () => crypto.randomUUID(), createHash: () => ({ update: () => ({ digest: () => 'stub' }) }) }),
    stream: () => ({ Readable: createEvents(), Writable: createEvents(), Transform: createEvents(), pipeline: (...a) => a.pop()(null) }),
    http: createHttp(term),
    https: createHttp(term),
    buffer: () => ({ Buffer: Buf }),
    child_process: () => ({ spawn: () => { throw new Error('child_process.spawn: not supported in browser'); }, exec: (c, cb) => cb?.(new Error('child_process.exec: not supported')) }),
    net: () => ({ Socket: createEvents(), createServer: () => ({ listen: () => {} }) }),
    zlib: () => ({ gzipSync: b => b, gunzipSync: b => b, createGzip: () => ({ pipe: () => {} }), createGunzip: () => ({ pipe: () => {} }) }),
    assert: () => { const a = (v, m) => { if (!v) throw new Error(m || 'assertion failed'); }; a.ok = a; a.equal = (x, y, m) => a(x === y, m); a.deepEqual = (x, y, m) => a(JSON.stringify(x) === JSON.stringify(y), m); a.strictEqual = a.equal; return a; },
    express: () => createExpress(term, fsmod),
    'better-sqlite3': createSqlite,
  };

  const cons = createConsole(term);
  const proc = createProcess(term, ctx);
  const snap = () => window.__debug?.idbSnapshot || {};
  const pkgCache = {};
  const reqCache = {};

  function resolveCandidates(dir, id) {
    return [pathmod.resolve(dir, id) + '.js', pathmod.resolve(dir, id), pathmod.resolve(dir, id) + '/index.js', pathmod.resolve(dir, id, 'index.js')];
  }

  function makeRequire(dir) {
    const req = function require(id) {
      if (MODULES[id]) return MODULES[id]();
      if (!id.startsWith('.')) {
        if (pkgCache[id]) return pkgCache[id];
        throw new Error("Cannot find module '" + id + "' (run: npm install " + id + ")");
      }
      const s = snap();
      for (const c of resolveCandidates(dir, id)) {
        const key = c.replace(/^\//, '');
        if (key in s) {
          if (key.endsWith('.json')) return JSON.parse(s[key]);
          if (reqCache[key]) return reqCache[key].exports;
          const mod = { exports: {} };
          reqCache[key] = mod;
          const modDir = pathmod.dirname('/' + key);
          new Function('module', 'exports', 'require', '__filename', '__dirname', 'process', 'console', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', s[key])(mod, mod.exports, makeRequire(modDir), '/' + key, modDir, proc, cons, Buf, setTimeout, setInterval, clearTimeout, clearInterval, fetch);
          return mod.exports;
        }
      }
      throw new Error("Cannot find module '" + id + "'");
    };
    req.resolve = id => {
      if (MODULES[id]) return id;
      if (!id.startsWith('.')) { if (pkgCache[id]) return 'node_modules/' + id; throw new Error("Cannot find module '" + id + "'"); }
      const s = snap();
      for (const c of resolveCandidates(dir, id)) { const key = c.replace(/^\//, ''); if (key in s) return '/' + key; }
      throw new Error("Cannot find module '" + id + "'");
    };
    req.cache = reqCache;
    return req;
  }

  async function loadSql() {
    if (window.__sqlJs) return window.__sqlJs;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = './vendor/sql-wasm.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    window.__sqlJs = await initSqlJs({ locateFile: f => './vendor/' + f });
    return window.__sqlJs;
  }

  function collectRequires(code) {
    const ids = new Set();
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(code))) ids.add(m[1]);
    return ids;
  }

  async function preloadAsyncPkgs(entryCode, entryDir) {
    const s = snap();
    const visited = new Set();
    const queue = [{ code: entryCode, dir: entryDir }];
    const pkgIds = new Set();
    while (queue.length) {
      const { code, dir } = queue.shift();
      for (const id of collectRequires(code)) {
        if (MODULES[id]) continue;
        if (!id.startsWith('.')) { pkgIds.add(id); continue; }
        for (const c of resolveCandidates(dir, id)) {
          const key = c.replace(/^\//, '');
          if (visited.has(key) || !(key in s)) continue;
          visited.add(key);
          queue.push({ code: s[key], dir: pathmod.dirname('/' + key) });
          break;
        }
      }
    }
    for (const id of pkgIds) {
      if (pkgCache[id]) continue;
      const key = 'node_modules/' + id + '/index.js';
      if (!(key in s)) continue;
      const urlMatch = s[key].match(/import\((".+?")\)/);
      if (!urlMatch) continue;
      const url = JSON.parse(urlMatch[1]);
      try {
        const mod = await import(url);
        const exports = { ...mod };
        if (mod.default && typeof mod.default === 'object') Object.assign(exports, mod.default);
        pkgCache[id] = mod.default && Object.keys(mod).length === 1 ? mod.default : exports;
      } catch (e) { term.write('\x1b[31mfailed to load ' + id + ': ' + e.message + '\x1b[0m\r\n'); }
    }
  }

  return async function nodeEval(code, filename, argv, stdinBuf) {
    const dir = filename ? pathmod.dirname(filename) : ctx.cwd;
    const fpath = filename || ctx.cwd + '/repl';
    proc.argv = filename ? ['node', fpath, ...(argv || [])] : ['node'];
    proc.exitCode = 0;
    await preloadAsyncPkgs(code, dir);
    const scope = { process: proc, console: cons, require: makeRequire(dir), Buffer: Buf, __filename: fpath, __dirname: dir, setTimeout, setInterval, clearTimeout, clearInterval, fetch, loadSql, module: { exports: {} }, exports: {}, global: globalThis };
    try {
      const keys = Object.keys(scope);
      const vals = Object.values(scope);
      const fn = new Function(...keys, 'return (async () => {\n' + code + '\n})()');
      const pending = fn(...vals);
      if (stdinBuf) queueMicrotask(() => proc.stdin._feed(stdinBuf));
      const result = await pending;
      if (result !== undefined && !filename) cons.log(result);
      ctx.lastExitCode = proc.exitCode | 0;
    } catch (e) {
      if (e && e.__nodeExit) { ctx.lastExitCode = e.code | 0; return; }
      term.write('\x1b[31m' + (filename ? filename + ':' : '') + e.message + '\x1b[0m\r\n');
      if (e.stack) term.write('\x1b[90m' + e.stack.split('\n').slice(1, 4).join('\r\n') + '\x1b[0m\r\n');
      ctx.lastExitCode = 1;
    }
  };
}
