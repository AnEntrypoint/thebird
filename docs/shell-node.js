import { createPath, createFs, createEvents, createUrl, createQuerystring, createBuffer } from './node-builtins.js';
import { createExpress, createHttp, createSqlite, createConsole, createProcess, NODE_VERSION, NODE_VERSIONS, NodeExit } from './shell-node-modules.js';
import { inspect, format, createHash, createZlib } from './shell-node-stdlib.js';
import { createChildProcess, createHttpClient, extendProcess, rewriteStack, isEsmCode, runEsm, parseDotEnv } from './shell-node-io.js';

export function createNodeEnv({ ctx, term }) {
  const pathmod = createPath();
  const fsmod = createFs();
  const Buf = createBuffer();
  const zlibMod = createZlib(Buf);
  const httpClient = createHttpClient(Buf);
  const cpMod = createChildProcess(ctx);
  const MODULES = {
    path: () => pathmod,
    fs: () => fsmod,
    events: () => createEvents(),
    url: () => createUrl(),
    querystring: () => createQuerystring(),
    os: () => ({ platform: () => 'linux', arch: () => 'x64', homedir: () => ctx.env.HOME || '/root', tmpdir: () => '/tmp', cpus: () => [{ model: 'jsh', speed: 0 }], totalmem: () => 1073741824, freemem: () => 536870912, hostname: () => 'thebird', EOL: '\n', release: () => '6.0.0', type: () => 'Linux', uptime: () => performance.now() / 1000, networkInterfaces: () => ({}) }),
    util: () => ({ inspect, format, promisify: fn => (...a) => new Promise((r, j) => fn(...a, (e, v) => e ? j(e) : r(v))), types: { isPromise: p => p instanceof Promise, isDate: v => v instanceof Date, isRegExp: v => v instanceof RegExp }, deprecate: fn => fn, inherits: () => {} }),
    crypto: () => ({ createHash, randomBytes: n => { const b = new Buf(n); for (let i = 0; i < n; i++) b[i] = Math.random() * 256 | 0; return b; }, randomUUID: () => crypto.randomUUID(), randomInt: (a, b) => Math.floor(Math.random() * (b - a) + a), webcrypto: globalThis.crypto }),
    stream: () => ({ Readable: createEvents(), Writable: createEvents(), Transform: createEvents(), Duplex: createEvents(), PassThrough: createEvents(), pipeline: (...a) => { const cb = a.pop(); queueMicrotask(() => cb(null)); } }),
    http: createHttp(term),
    https: createHttp(term),
    buffer: () => ({ Buffer: Buf, constants: { MAX_LENGTH: 4294967295 } }),
    child_process: () => cpMod,
    net: () => ({ Socket: createEvents(), createServer: () => ({ listen: () => {} }), isIP: () => 0 }),
    zlib: () => zlibMod,
    assert: () => { const a = (v, m) => { if (!v) throw new Error(m || 'assertion failed'); }; a.ok = a; a.equal = (x, y, m) => a(x === y, m); a.deepEqual = (x, y, m) => a(JSON.stringify(x) === JSON.stringify(y), m); a.strictEqual = a.equal; a.notEqual = (x, y, m) => a(x !== y, m); a.fail = m => { throw new Error(m || 'failed'); }; return a; },
    express: () => createExpress(term, fsmod),
    'better-sqlite3': createSqlite,
  };
  MODULES['node:fs'] = MODULES.fs; MODULES['node:path'] = MODULES.path; MODULES['node:os'] = MODULES.os; MODULES['node:util'] = MODULES.util; MODULES['node:crypto'] = MODULES.crypto; MODULES['node:http'] = MODULES.http; MODULES['node:child_process'] = MODULES.child_process; MODULES['node:zlib'] = MODULES.zlib; MODULES['node:buffer'] = MODULES.buffer; MODULES['node:assert'] = MODULES.assert; MODULES['node:stream'] = MODULES.stream; MODULES['node:events'] = MODULES.events; MODULES['node:url'] = MODULES.url; MODULES['node:querystring'] = MODULES.querystring;
  MODULES.http = () => httpClient; MODULES.https = () => httpClient; MODULES['node:http'] = () => httpClient; MODULES['node:https'] = () => httpClient;

  const proc = extendProcess(createProcess(term, ctx), ctx);
  const cons = createConsole(term);
  cons.log = (...a) => term.write(format(...a) + '\r\n');
  cons.info = cons.log;
  cons.error = (...a) => term.write('\x1b[31m' + format(...a) + '\x1b[0m\r\n');
  cons.warn = (...a) => term.write('\x1b[33m' + format(...a) + '\x1b[0m\r\n');
  cons.debug = cons.log;
  const snap = () => window.__debug?.idbSnapshot || {};
  const pkgCache = {};
  const reqCache = {};

  function loadDotEnv() {
    const envFile = snap()[ctx.cwd.replace(/^\//, '').replace(/\/$/, '') + '/.env'] || snap()['.env'];
    if (!envFile) return;
    const parsed = parseDotEnv(envFile);
    for (const [k, v] of Object.entries(parsed)) if (!(k in ctx.env)) ctx.env[k] = v;
  }

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

  async function preloadAsyncPkgs(entryCode, entryDir) {
    const s = snap();
    const visited = new Set();
    const queue = [{ code: entryCode, dir: entryDir }];
    const pkgIds = new Set();
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (queue.length) {
      const { code, dir } = queue.shift();
      let m; re.lastIndex = 0;
      while ((m = re.exec(code))) {
        const id = m[1];
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
      try { const mod = await import(url); const exp = { ...mod }; if (mod.default && typeof mod.default === 'object') Object.assign(exp, mod.default); pkgCache[id] = mod.default && Object.keys(mod).length === 1 ? mod.default : exp; }
      catch (e) { term.write('\x1b[31mfailed to load ' + id + ': ' + e.message + '\x1b[0m\r\n'); }
    }
  }

  return async function nodeEval(code, filename, argv, stdinBuf) {
    const dir = filename ? pathmod.dirname(filename) : ctx.cwd;
    const fpath = filename || '[eval]';
    proc.argv = filename ? ['node', fpath, ...(argv || [])] : ['node'];
    proc.exitCode = 0;
    loadDotEnv();
    await preloadAsyncPkgs(code, dir);
    const scope = { process: proc, console: cons, require: makeRequire(dir), Buffer: Buf, __filename: fpath, __dirname: dir, setTimeout, setInterval, clearTimeout, clearInterval, fetch, module: { exports: {} }, exports: {}, global: globalThis, URL, URLSearchParams, TextEncoder, TextDecoder };
    const unhandledH = e => { e.preventDefault?.(); const err = e.reason || e; term.write('\x1b[31m' + (filename ? filename + ':' : '[eval]:') + '\r\n' + (rewriteStack(err, fpath)) + '\x1b[0m\r\n'); ctx.lastExitCode = 1; };
    window.addEventListener('unhandledrejection', unhandledH);
    try {
      if (isEsmCode(code)) { const mod = await runEsm(code, scope); if (mod && !filename) { for (const [k, v] of Object.entries(mod)) if (k !== 'default') cons.log(k + ':', v); } ctx.lastExitCode = proc.exitCode | 0; return; }
      const keys = Object.keys(scope), vals = Object.values(scope);
      const fn = new Function(...keys, 'return (async () => {\n' + code + '\n})()');
      const pending = fn(...vals);
      if (stdinBuf) queueMicrotask(() => proc.stdin._feed(stdinBuf));
      const result = await pending;
      if (result !== undefined && !filename) cons.log(result);
      ctx.lastExitCode = proc.exitCode | 0;
    } catch (e) {
      if (e && e.__nodeExit) { ctx.lastExitCode = e.code | 0; return; }
      term.write('\x1b[31m' + rewriteStack(e, fpath) + '\x1b[0m\r\n');
      ctx.lastExitCode = 1;
    } finally { window.removeEventListener('unhandledrejection', unhandledH); }
  };
}
