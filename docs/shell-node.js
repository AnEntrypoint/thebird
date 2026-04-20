import { createPath, createFs, createEvents, createUrl, createQuerystring, createBuffer } from './node-builtins.js';
import { createExpress, createHttp, createSqlite, createConsole, createProcess, NODE_VERSION, NODE_VERSIONS, NodeExit } from './shell-node-modules.js';
import { inspect, format, createZlib, preloadFflate } from './shell-node-stdlib.js';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from './shell-node-crypto.js';
import { createChildProcess, createHttpClient, extendProcess, rewriteStack, isEsmCode, runEsm, parseDotEnv } from './shell-node-io.js';
import { resolveExports, resolveImports, walkUpNodeModules, resolvePackageEntry, makeModuleModule, makeModuleNotFoundError, makeFsPromises, makeFsWatch, makeNetStub, makeDgramStub, makeWorkerThreadsStub } from './shell-node-resolve.js';
import { extendBuffer, extendPath, createUrlExt, makeStringDecoder, makeReadline, makeTimersMod, makePerfHooks, makeV8Mod, makeAsyncHooks, makeStubs, makeErrorCodes, extendProcessExtras, makeStreamConsumers } from './shell-node-extras.js';
import { makeStream, extendFsStreams } from './shell-node-streams.js';
import { extendCrypto } from './shell-node-cipher.js';
import { extendKeys } from './shell-node-keyobject.js';
import { makeStreamingZlib, makeVmModule, makeModuleRegister, makeHttp2, makeWasi } from './shell-node-advanced.js';
import { makeDebugRegistry, makeDiagnosticsChannel, makeTraceEvents, makeBufferPool, makeProcessBindings, makePerfMemory, makeFetchPool, makeFsWatchReal, installPrepareStackTraceHook, installCaptureStackTrace } from './shell-node-observe.js';
import { makeWorkerThreads, makeChildProcessReal, makeRepl } from './shell-node-runtime.js';
import { detectBrowser, registerPolyfill, makeCompressionStreamZlib, makeWebCodecs, makeWebPush, makeStorageHelpers } from './shell-node-firefox.js';
import { makeOpfsBackend, wireOpfsIntoFs } from './shell-node-opfs.js';
import { preloadBrotli, makeBrotli } from './shell-node-brotli.js';
import { preloadSourceMap, installSourceMapStacks } from './shell-node-srcmap.js';
import { makeNet, makeTls, makeDgram } from './shell-node-net.js';
import { makeInspector } from './shell-node-inspector.js';
import { makeV8Profiler, makeHeapSnapshot } from './shell-node-profiler.js';
import { makeCluster } from './shell-node-cluster.js';
import { preloadX509 } from './shell-node-keyobject.js';

export function createNodeEnv({ ctx, term }) {
  const pathmod = extendPath(createPath());
  const Buf = makeBufferPool(extendBuffer(createBuffer()));
  const debugReg = makeDebugRegistry();
  const browserInfo = detectBrowser(); debugReg.browser = browserInfo;
  const snapFn = () => window.__debug?.idbSnapshot || {};
  const fsmod = extendFsStreams(createFs(), Buf);
  const opfs = makeOpfsBackend(Buf); if (opfs) wireOpfsIntoFs(fsmod, opfs, debugReg);
  fsmod.promises = makeFsPromises(fsmod); fsmod.watch = makeFsWatchReal(snapFn);
  fsmod.glob = (pat, opts, cb) => { if (typeof opts === 'function') { cb = opts; opts = {}; } const matches = Object.keys(window.__debug?.idbSnapshot || {}).filter(k => new RegExp('^' + pat.replace(/\*\*/g, '.+').replace(/\*/g, '[^/]*') + '$').test(k)); queueMicrotask(() => cb?.(null, matches)); };
  fsmod.globSync = pat => Object.keys(window.__debug?.idbSnapshot || {}).filter(k => new RegExp('^' + pat.replace(/\*\*/g, '.+').replace(/\*/g, '[^/]*') + '$').test(k));
  const zlibMod = createZlib(Buf);
  const httpClient = createHttpClient(Buf);
  const cpMod = createChildProcess(ctx);
  const streamMod = makeStream();
  const cpReal = makeChildProcessReal(Buf, streamMod);
  Object.assign(cpMod, { exec: cpReal.exec.bind(cpReal), spawn: cpReal.spawn.bind(cpReal), execFile: cpReal.execFile.bind(cpReal), execSync: cpReal.execSync, spawnSync: cpReal.spawnSync, fork: cpReal.fork });
  let cryptoMod = { createHash, createHmac, pbkdf2Sync, pbkdf2: (pw, salt, iter, len, dig, cb) => queueMicrotask(() => { try { cb(null, Buf.from(pbkdf2Sync(pw, salt, iter, len, dig))); } catch (e) { cb(e); } }), randomBytes: n => Buf.from(randomBytes(n)), randomUUID: () => crypto.randomUUID(), randomInt: (a, b) => Math.floor(Math.random() * (b - a) + a), webcrypto: globalThis.crypto, constants: {} };
  cryptoMod = extendKeys(extendCrypto(cryptoMod, Buf));
  cryptoMod._ops = () => ++debugReg.cryptoOps;
  const errorCodes = makeErrorCodes(); const stubs = makeStubs(ctx); const diagCh = makeDiagnosticsChannel(); const traceEv = makeTraceEvents(debugReg);
  const vmMod = makeVmModule(); const http2Mod = makeHttp2(); const wasiMod = makeWasi(); const moduleRegister = makeModuleRegister(); const workerThreads = makeWorkerThreads(snapFn, Buf);
  const getMem = makePerfMemory(performance); const FetchAgent = makeFetchPool(); const netMod = makeNet(Buf); const tlsMod = makeTls(netMod, Buf); const dgramMod = makeDgram(Buf);
  const v8Real = makeV8Profiler(debugReg); const heapSnap = makeHeapSnapshot(); const clusterReal = makeCluster(); const inspector = makeInspector(debugReg);
  const nativeCS = makeCompressionStreamZlib(streamMod, Buf); const webCodecs = makeWebCodecs(); const webPush = makeWebPush(); const storage = makeStorageHelpers();
  if (nativeCS) registerPolyfill(debugReg, 'compressionStream', 'native', 'CompressionStream available');
  if (browserInfo.capabilities.webCodecs) registerPolyfill(debugReg, 'webCodecs', 'native', 'WebCodecs available');
  const proc = extendProcessExtras(extendProcess(createProcess(term, ctx), ctx), ctx);
  proc.stdin.setRawMode = () => proc.stdin; proc.stdin.isRaw = false; proc.binding = makeProcessBindings(); proc.memoryUsage = getMem; proc.storage = storage; proc.storageBuckets = storage.buckets;
  const MODULES = {
    path: () => pathmod, fs: () => fsmod, events: () => createEvents(), url: () => createUrlExt(), querystring: () => createQuerystring(),
    os: () => ({ platform: () => 'linux', arch: () => 'x64', homedir: () => ctx.env.HOME || '/root', tmpdir: () => '/tmp', cpus: () => [{ model: 'jsh', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }], totalmem: () => 1073741824, freemem: () => 536870912, hostname: () => 'thebird', EOL: '\n', release: () => '6.0.0', type: () => 'Linux', uptime: () => performance.now() / 1000, networkInterfaces: () => ({}), loadavg: () => [0, 0, 0], userInfo: () => ({ username: ctx.env.USER || 'root', uid: 0, gid: 0, shell: ctx.env.SHELL, homedir: ctx.env.HOME }), endianness: () => 'LE', version: () => '#1 SMP', machine: () => 'x86_64', devNull: '/dev/null', availableParallelism: () => 1, constants: { signals: {}, errno: {} } }),
    util: () => ({ inspect, format, promisify: fn => (...a) => new Promise((r, j) => fn(...a, (e, v) => e ? j(e) : r(v))), callbackify: fn => (...a) => { const cb = a.pop(); fn(...a).then(v => cb(null, v), e => cb(e)); }, types: { isPromise: p => p instanceof Promise, isDate: v => v instanceof Date, isRegExp: v => v instanceof RegExp, isBuffer: v => v instanceof Uint8Array, isTypedArray: v => ArrayBuffer.isView(v) && !(v instanceof DataView), isAsyncFunction: f => f?.constructor?.name === 'AsyncFunction', isNativeError: e => e instanceof Error }, deprecate: fn => fn, inherits: (a, b) => { Object.setPrototypeOf(a.prototype, b.prototype); }, debuglog: () => () => {}, isDeepStrictEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b), styleText: (s, t) => t, parseArgs: ({ args = [], options = {} }) => { const values = {}, positionals = []; for (let i = 0; i < args.length; i++) { const a = args[i]; if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); if (v !== undefined) values[k] = v; else if (options[k]?.type === 'string') values[k] = args[++i]; else values[k] = true; } else positionals.push(a); } return { values, positionals }; } }),
    crypto: () => cryptoMod,
    stream: () => streamMod, 'stream/promises': () => streamMod.promises, 'stream/consumers': () => makeStreamConsumers(), 'stream/web': () => ({ ReadableStream, WritableStream, TransformStream }),
    http: () => ({ ...httpClient, Agent: FetchAgent, globalAgent: new FetchAgent() }), https: () => ({ ...httpClient, Agent: FetchAgent, globalAgent: new FetchAgent() }),
    http2: () => http2Mod, 'node:http2': () => http2Mod,
    vm: () => vmMod, 'node:vm': () => vmMod,
    buffer: () => ({ Buffer: Buf, constants: { MAX_LENGTH: 4294967295, MAX_STRING_LENGTH: 536870888 }, kMaxLength: 4294967295, Blob, File }),
    child_process: () => cpMod,
    net: () => netMod, dgram: () => dgramMod, tls: () => tlsMod, worker_threads: () => workerThreads,
    zlib: () => ({ ...zlibMod, ...makeStreamingZlib(streamMod, Buf, globalThis.__fflate || {}), ...(nativeCS || {}), ...makeBrotli(streamMod, Buf) }),
    assert: () => { const a = (v, m) => { if (!v) throw new Error(m || 'assertion failed'); }; a.ok = a; a.equal = (x, y, m) => a(x === y, m); a.deepEqual = (x, y, m) => a(JSON.stringify(x) === JSON.stringify(y), m); a.deepStrictEqual = a.deepEqual; a.strictEqual = a.equal; a.notEqual = (x, y, m) => a(x !== y, m); a.notDeepEqual = (x, y, m) => a(JSON.stringify(x) !== JSON.stringify(y), m); a.notStrictEqual = a.notEqual; a.throws = (fn, m) => { try { fn(); throw new Error('did not throw'); } catch (e) {} }; a.doesNotThrow = fn => fn(); a.rejects = async fn => { try { await (typeof fn === 'function' ? fn() : fn); throw new Error('did not reject'); } catch {} }; a.fail = m => { throw new Error(m || 'failed'); }; a.match = (s, re) => a(re.test(s)); return a; },
    string_decoder: () => stubs.string_decoder, readline: () => makeReadline(term, proc), 'readline/promises': () => stubs.readline_promises,
    timers: () => makeTimersMod(), 'timers/promises': () => makeTimersMod().promises, perf_hooks: () => makePerfHooks(),
    v8: () => ({ ...makeV8Mod(), ...v8Real, ...heapSnap }), async_hooks: () => makeAsyncHooks(),
    inspector: () => inspector, cluster: () => clusterReal || stubs.cluster,
    codecs: () => { if (!webCodecs) throw makeModuleNotFoundError('codecs', []); return webCodecs; }, 'web-push': () => webPush,
    sea: () => stubs.sea, 'node:sea': () => stubs.sea, test: () => stubs.test_runner, 'node:test': () => stubs.test_runner,
    'node:test/reporters': () => ({ spec: class {}, tap: class {}, dot: class {} }), tty: () => stubs.tty, domain: () => stubs.domain,
    diagnostics_channel: () => diagCh, punycode: () => stubs.punycode, errors: () => errorCodes, trace_events: () => traceEv,
    wasi: () => wasiMod,
    module: () => ({ ...makeModuleModule(() => {}, MODULES), register: moduleRegister.register, _registerHooks: moduleRegister._hooks }),
    express: () => createExpress(term, fsmod),
    'better-sqlite3': createSqlite,
  };
  for (const k of Object.keys(MODULES)) if (!k.startsWith('node:')) MODULES['node:' + k] = MODULES[k];
  const cons = createConsole(term);
  cons.log = (...a) => term.write(format(...a) + '\r\n'); cons.info = cons.log;
  cons.error = (...a) => term.write('\x1b[31m' + format(...a) + '\x1b[0m\r\n');
  cons.warn = (...a) => term.write('\x1b[33m' + format(...a) + '\x1b[0m\r\n'); cons.debug = cons.log;
  const pkgCache = {}; const reqCache = {}; let requireStack = [];
  function loadDotEnv() { const envFile = snapFn()[ctx.cwd.replace(/^\//, '').replace(/\/$/, '') + '/.env'] || snapFn()['.env']; if (!envFile) return; for (const [k, v] of Object.entries(parseDotEnv(envFile))) if (!(k in ctx.env)) ctx.env[k] = v; }

  const resolveCandidates = (dir, id) => [pathmod.resolve(dir, id) + '.js', pathmod.resolve(dir, id), pathmod.resolve(dir, id) + '/index.js', pathmod.resolve(dir, id, 'index.js')];
  function findPkgJsonDir(s, dir) { let d = dir.replace(/^\//, '').replace(/\/$/, ''); while (true) { const k = (d ? d + '/' : '') + 'package.json'; if (k in s) return d; if (!d) return null; const up = d.slice(0, d.lastIndexOf('/')); if (up === d) return null; d = up; } }
  function isEsmPkg(s, filePath) { const pjDir = findPkgJsonDir(s, pathmod.dirname(filePath)); try { const pj = JSON.parse(s[(pjDir || '') + (pjDir ? '/' : '') + 'package.json']); return pj.type === 'module'; } catch { return false; } }

  function makeRequire(dir) {
    const req = function require(id) {
      if (id === 'module') return makeModuleModule(req, MODULES);
      if (MODULES[id]) return MODULES[id]();
      const s = snapFn();
      if (id.startsWith('#')) {
        const pjRoot = findPkgJsonDir(s, dir);
        if (pjRoot) { const pj = JSON.parse(s[pjRoot + '/package.json']); const target = resolveImports(pj, id); if (target) { const resolved = pathmod.resolve('/' + pjRoot, target); return loadFile(resolved.replace(/^\//, ''), s); } }
        throw makeModuleNotFoundError(id, requireStack);
      }
      if (!id.startsWith('.')) {
        if (pkgCache[id]) return pkgCache[id];
        const pkgDir = walkUpNodeModules(s, dir, id);
        if (pkgDir) { const entry = resolvePackageEntry(s, pkgDir); if (entry) { const m = loadFile(entry.replace(/^\//, ''), s); if (m) return m; } }
        throw makeModuleNotFoundError(id, requireStack);
      }
      for (const c of resolveCandidates(dir, id)) {
        const key = c.replace(/^\//, '');
        if (key in s) { const loaded = loadFile(key, s); if (loaded !== undefined) return loaded; }
      }
      throw makeModuleNotFoundError(id, requireStack);
    };
    function loadFile(key, s) {
      if (key.endsWith('.json')) return JSON.parse(s[key]);
      if (reqCache[key]) return reqCache[key].exports;
      const mod = { exports: {} };
      reqCache[key] = mod;
      const modDir = pathmod.dirname('/' + key);
      requireStack.push('/' + key);
      try {
        const src = s[key]; const esm = key.endsWith('.mjs') || (key.endsWith('.js') && isEsmPkg(s, '/' + key)) || isEsmCode(src);
        if (esm) throw new Error("ESM module '" + key + "' requested via require() — use dynamic import() or run entry as ESM");
        new Function('module', 'exports', 'require', '__filename', '__dirname', 'process', 'console', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', src)(mod, mod.exports, makeRequire(modDir), '/' + key, modDir, proc, cons, Buf, setTimeout, setInterval, clearTimeout, clearInterval, fetch);
      }
      finally { requireStack.pop(); }
      mod.loaded = true;
      return mod.exports;
    }
    req.resolve = id => {
      if (MODULES[id] || id === 'module') return id;
      const s = snapFn();
      if (!id.startsWith('.')) { const pkgDir = walkUpNodeModules(s, dir, id); if (pkgDir) return resolvePackageEntry(s, pkgDir) || pkgDir; throw makeModuleNotFoundError(id, requireStack); }
      for (const c of resolveCandidates(dir, id)) { const key = c.replace(/^\//, ''); if (key in s) return '/' + key; }
      throw makeModuleNotFoundError(id, requireStack);
    };
    req.cache = reqCache;
    return req;
  }

  async function preloadAsyncPkgs(entryCode, entryDir) {
    const s = snapFn();
    const visited = new Set(); const queue = [{ code: entryCode, dir: entryDir }]; const pkgIds = new Set();
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (queue.length) {
      const { code, dir } = queue.shift(); let m; re.lastIndex = 0;
      while ((m = re.exec(code))) { const id = m[1]; if (MODULES[id]) continue; if (!id.startsWith('.')) { pkgIds.add(id); continue; } for (const c of resolveCandidates(dir, id)) { const key = c.replace(/^\//, ''); if (visited.has(key) || !(key in s)) continue; visited.add(key); queue.push({ code: s[key], dir: pathmod.dirname('/' + key) }); break; } }
    }
    for (const id of pkgIds) {
      if (pkgCache[id]) continue;
      const key = 'node_modules/' + id + '/index.js'; if (!(key in s)) continue;
      const urlMatch = s[key].match(/import\((".+?")\)/); if (!urlMatch) continue;
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
    globalThis.__fflate = await preloadFflate().catch(() => ({}));
    if (proc.sourceMapsEnabled) { await preloadSourceMap().catch(() => {}); installSourceMapStacks(snapFn); }
    await preloadAsyncPkgs(code, dir);
    const reqFn = makeRequire(dir);
    const scope = { process: proc, console: cons, require: reqFn, Buffer: Buf, __filename: fpath, __dirname: dir, setTimeout, setInterval, clearTimeout, clearInterval, fetch, module: { exports: {} }, exports: {}, global: globalThis, URL, URLSearchParams, TextEncoder, TextDecoder };
    const prevGlobals = { process: globalThis.process, Buffer: globalThis.Buffer };
    globalThis.process = proc; globalThis.Buffer = Buf;
    installCaptureStackTrace(); installPrepareStackTraceHook();
    const unhandledH = e => { e.preventDefault?.(); const err = e.reason || e; term.write('\x1b[31m' + rewriteStack(err, fpath) + '\x1b[0m\r\n'); ctx.lastExitCode = 1; };
    window.addEventListener('unhandledrejection', unhandledH);
    try {
      if (isEsmCode(code)) { const preamble = '\nconst __filename = ' + JSON.stringify(fpath) + ';\nconst __dirname = ' + JSON.stringify(dir) + ';\n'; const mod = await runEsm(preamble + code, scope); if (mod && !filename) { for (const [k, v] of Object.entries(mod)) if (k !== 'default') cons.log(k + ':', v); } ctx.lastExitCode = proc.exitCode | 0; return; }
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
    } finally {
      window.removeEventListener('unhandledrejection', unhandledH);
      if (prevGlobals.process !== undefined) globalThis.process = prevGlobals.process; else delete globalThis.process;
      if (prevGlobals.Buffer !== undefined) globalThis.Buffer = prevGlobals.Buffer; else delete globalThis.Buffer;
    }
  };
}
