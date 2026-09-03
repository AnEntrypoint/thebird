import { createPath, createFs, createEvents, createUrl, createQuerystring, createBuffer } from './node-builtins.js';
import { createExpress, createHttp, createSqlite, createConsole, createProcess, NODE_VERSION, NODE_VERSIONS, NodeExit } from './shell-node-modules.js';
import { inspect, format, createZlib, preloadFflate } from './shell-node-stdlib.js';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from './shell-node-crypto.js';
import { createChildProcess, createHttpClient, extendProcess, rewriteStack, isEsmCode, runEsm, parseDotEnv } from './shell-node-io.js';
import { resolveExports, resolveImports, walkUpNodeModules, resolvePackageEntry, makeModuleModule, makeModuleNotFoundError, makeFsPromises, makeFsWatch } from './shell-node-resolve.js';
import { extendBuffer, extendPath, createUrlExt, makeStringDecoder, makeReadline, makeTimersMod, makePerfHooks, makeV8Mod, makeAsyncHooks, makeStubs, makeErrorCodes, extendProcessExtras, makeStreamConsumers } from './shell-node-extras.js';
import { makeStream, extendFsStreams } from './shell-node-streams.js';
import { extendCrypto } from './shell-node-cipher.js';
import { extendKeys } from './shell-node-keyobject.js';
import { makeStreamingZlib, makeVmModule, makeModuleRegister, makeHttp2, makeWasi } from './shell-node-advanced.js';
import { makeDebugRegistry, makeDiagnosticsChannel, makeTraceEvents, makeBufferPool, makeProcessBindings, makePerfMemory, makeFetchPool, makeFsWatchReal, installPrepareStackTraceHook, installCaptureStackTrace } from './shell-node-observe.js';
import { makeWorkerThreads, makeChildProcessReal, makeRepl } from './shell-node-runtime.js';
import { detectBrowser, registerPolyfill, makeCompressionStreamZlib, makeWebCodecs, makeWebPush, makeStorageHelpers } from './shell-node-firefox.js';
import { preloadBrotli, makeBrotli } from './shell-node-brotli.js';
import { preloadSourceMap, installSourceMapStacks } from './shell-node-srcmap.js';
import { makeNet, makeTls, makeDgram } from './shell-node-net.js';
import { makeInspector } from './shell-node-inspector.js';
import { makeV8Profiler, makeHeapSnapshot } from './shell-node-profiler.js';
import { makeCluster } from './shell-node-cluster.js';
import { preloadX509 } from './shell-node-keyobject.js';
import { detectRuntime, registerRuntime, switchRuntime, logRuntimeSwitch } from './shell-runtime.js';
import { makeDenoGlobal } from './shell-deno.js'; import { makeBunGlobal } from './shell-bun.js';
import { makePmDispatcher, detectPm, makeCorepackStub } from './shell-pm.js';
import { isTsFile, preprocessSource } from './shell-ts.js'; import { installPosixFs, installFds, installTmpAndMisc } from './shell-posix.js';
import { makeTestRunner, makeTapReporter } from './shell-node-testrunner.js'; import { makeForkIpc } from './shell-node-ipc.js';
import { styleText, stripVTControlCharacters, getCallSites, MIMEType, MIMEParams, makeConsoleExtras } from './shell-node-util-extras.js';
import { makeProcFs, wireProcFs } from './shell-node-procfs.js'; import { makeGit } from './shell-node-git.js'; import { makeTar } from './shell-node-tar.js'; import { makeDns } from './shell-node-dns.js'; import { makeNativeLoader } from './shell-node-native.js'; import { makeRegistry } from './shell-node-registry.js';
import { makeBusnet, makeBusHttp } from './shell-node-busnet.js';

export function createNodeEnv({ ctx, term }) {
  const pathmod = extendPath(createPath()); const Buf = makeBufferPool(extendBuffer(createBuffer())); const debugReg = makeDebugRegistry(ctx);
  const browserInfo = detectBrowser(); debugReg.browser = browserInfo; const snapFn = () => window.__debug?.idbSnapshot || {};
  // fs.promises.* (makeFsPromises, below) wraps the SYNC fs functions
  // installed by installPosixFs -- those are backed by the live in-memory
  // `snapshot` object, which docs/instance-fs.js persists to real per-file
  // OPFS storage as the primary backing store (falling back to IndexedDB
  // only when OPFS is unavailable). A prior separate OPFS overlay here
  // (shell-node-opfs.js's wireOpfsIntoFs, writing async fs.promises.* calls
  // straight to root-level OPFS files bypassing `snapshot` entirely) was
  // dead code in practice: `fsmod.promises = makeFsPromises(fsmod)` on the
  // very next line unconditionally overwrote it every boot, and even had it
  // not been overwritten, a write via fs.promises.writeFile and a read via
  // fs.readFileSync on the same path would have silently diverged into two
  // different storage locations. Removed in favor of this single coherent
  // path -- fs.promises.* now durably persists through the SAME OPFS-backed
  // snapshot every other fs consumer (sync or async) already reads/writes.
  const fsmod = installTmpAndMisc(installFds(installPosixFs(extendFsStreams(createFs(), Buf), Buf, ctx), Buf), Buf, ctx);
  const runtime = detectRuntime(); registerRuntime(debugReg, runtime); fsmod.promises = makeFsPromises(fsmod); fsmod.watch = makeFsWatchReal(snapFn);
  // glob -> regex with correct globstar semantics: escape regex metachars FIRST
  // (so a literal '.' in the pattern isn't treated as any-char), then translate
  // ** (cross-segment, zero-or-more incl '/') and * (within-segment) and ?.
  const globToRe = pat => {
    let re = '';
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === '*') { if (pat[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*'; }
      else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$');
  };
  fsmod.glob = (pat, opts, cb) => { if (typeof opts === 'function') { cb = opts; opts = {}; } const reg = globToRe(pat); const matches = Object.keys(window.__debug?.idbSnapshot || {}).filter(k => reg.test(k)); queueMicrotask(() => cb?.(null, matches)); };
  fsmod.globSync = pat => { const reg = globToRe(pat); return Object.keys(window.__debug?.idbSnapshot || {}).filter(k => reg.test(k)); };
  const zlibMod = createZlib(Buf); const httpClient = createHttpClient(Buf); const cpMod = createChildProcess(ctx); const streamMod = makeStream();
  const cpReal = makeChildProcessReal(Buf, streamMod); Object.assign(cpMod, { exec: cpReal.exec.bind(cpReal), spawn: cpReal.spawn.bind(cpReal), execFile: cpReal.execFile.bind(cpReal), execSync: cpReal.execSync, spawnSync: cpReal.spawnSync, fork: cpReal.fork });
  let cryptoMod = { createHash, createHmac, pbkdf2Sync, pbkdf2: (pw, salt, iter, len, dig, cb) => queueMicrotask(() => { try { cb(null, Buf.from(pbkdf2Sync(pw, salt, iter, len, dig))); } catch (e) { cb(e); } }), randomBytes: n => Buf.from(randomBytes(n)), randomUUID: () => crypto.randomUUID(), randomInt: (a, b) => { let min = b === undefined ? 0 : a, max = b === undefined ? a : b; min = Math.floor(min); max = Math.floor(max); const range = max - min; if (!(range > 0)) throw new RangeError('max must be greater than min'); const bytes = Math.ceil(Math.log2(range) / 8) || 1; const limit = Math.floor(256 ** bytes / range) * range; let r; do { r = 0; const buf = randomBytes(bytes); for (let i = 0; i < bytes; i++) r = r * 256 + buf[i]; } while (r >= limit); return min + (r % range); }, webcrypto: globalThis.crypto, constants: {} };
  cryptoMod = extendKeys(extendCrypto(cryptoMod, Buf)); cryptoMod._ops = () => ++debugReg.cryptoOps; cryptoMod.secureHeapUsed = () => ({ total: 0, min: 0, used: 0, utilization: 0 });
  const errorCodes = makeErrorCodes(); const stubs = makeStubs(ctx); const diagCh = makeDiagnosticsChannel(); const traceEv = makeTraceEvents(debugReg);
  const vmMod = makeVmModule(); const http2Mod = makeHttp2(); const wasiMod = makeWasi(); const moduleRegister = makeModuleRegister(); const workerThreads = makeWorkerThreads(snapFn, Buf);
  const getMem = makePerfMemory(performance); const FetchAgent = makeFetchPool(); const netMod = makeNet(Buf); const tlsMod = makeTls(netMod, Buf); const dgramMod = makeDgram(Buf);
  const v8Real = makeV8Profiler(debugReg); const heapSnap = makeHeapSnapshot(snapFn); const clusterReal = makeCluster(); const inspector = makeInspector(debugReg);
  const nativeCS = makeCompressionStreamZlib(streamMod, Buf); const webCodecs = makeWebCodecs(); const webPush = makeWebPush(); const storage = makeStorageHelpers();
  const gitMod = makeGit(fsmod); const tarMod = makeTar(fsmod, null, Buf); const dnsMod = makeDns(); const nativeLoader = makeNativeLoader(); const registryMod = makeRegistry(); const busnet = makeBusnet(); globalThis.__busnet = busnet; const busHttp = makeBusHttp(busnet); debugReg.busnet = busnet;
  if (nativeCS) registerPolyfill(debugReg, 'compressionStream', 'native', 'CompressionStream available'); if (browserInfo.capabilities.webCodecs) registerPolyfill(debugReg, 'webCodecs', 'native', 'WebCodecs available');
  const proc = extendProcessExtras(extendProcess(createProcess(term, ctx), ctx), ctx);
  proc.stdin.setRawMode = () => proc.stdin; proc.stdin.isRaw = false; proc.binding = makeProcessBindings(); proc.memoryUsage = getMem; proc.storage = storage; proc.storageBuckets = storage.buckets; proc.cwd = () => ctx.cwd; proc.chdir = p => { ctx.cwd = p.startsWith('/') ? p : pathmod.resolve(ctx.cwd, p); }; proc.umask = m => { const prev = ctx.umask || 0o022; if (m != null) ctx.umask = m; return prev; }; makeForkIpc(proc); proc.dlopen = (t, p) => nativeLoader.dlopen(t, p); /* Synthetic process.resourceUsage(): only userCPUTime (performance.now) and maxRSS (performance.memory) carry browser-relevant data; all other fields are hardcoded 0 for Node API compatibility — do not use for profiling or tuning. */ proc.resourceUsage = () => { const m = performance.memory || {}; return { userCPUTime: performance.now() * 1000 | 0, systemCPUTime: 0, maxRSS: (m.totalJSHeapSize || 0) / 1024 | 0, sharedMemorySize: 0, unsharedDataSize: 0, unsharedStackSize: 0, minorPageFault: 0, majorPageFault: 0, swappedOut: 0, fsRead: 0, fsWrite: 0, ipcSent: 0, ipcReceived: 0, signalsCount: 0, voluntaryContextSwitches: 0, involuntaryContextSwitches: 0 }; };
  wireProcFs(fsmod, makeProcFs(proc)); const denoGlobal = makeDenoGlobal(fsmod, proc, cpMod, ctx.httpHandlers || {}, Buf); const bunGlobal = makeBunGlobal(fsmod, proc, cpMod, ctx.httpHandlers || {}, Buf, streamMod, cryptoMod);
  proc.execve = () => { const e = new Error('execve is not supported in this environment'); e.code = 'ENOSYS'; e.syscall = 'execve'; throw e; };
  const promisifyCustom = Symbol('nodejs.util.promisify.custom');
  const MODULES = {
    path: () => pathmod, fs: () => fsmod, events: () => createEvents(), url: () => createUrlExt(), querystring: () => createQuerystring(),
    /* os polyfill: cpus()/loadavg()/speed are synthetic mock metrics (zero times, fake model) for Node API compatibility only — not real system metrics; do not use for performance decisions. platform()/type()/EOL are hardcoded to POSIX values by design — thebird's shell always emulates bash/Linux regardless of host OS, so scripts branching on process.platform must see 'linux' consistently; do not swap to real host detection here. */
    os: () => { const n=navigator?.hardwareConcurrency||1; const mem=performance.memory||{}; return { platform: () => 'linux', arch: () => 'x64', homedir: () => ctx.env.HOME || '/root', tmpdir: () => '/tmp', cpus: () => { const now = Math.floor(performance.now()); return Array.from({length:n},(_,i)=>({model:'Browser CPU (synthetic)',speed:3000,times:{user:0,nice:0,sys:0,idle:now,irq:0}})); }, totalmem: () => mem.jsHeapSizeLimit || 1073741824, freemem: () => (mem.jsHeapSizeLimit || 1073741824) - (mem.usedJSHeapSize || 0), hostname: () => ctx.env.HOSTNAME || 'thebird', EOL: '\n', release: () => '6.0.0-browser', type: () => 'Linux', uptime: () => performance.now() / 1000, networkInterfaces: () => ({ lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] }), loadavg: () => [0, 0, 0], userInfo: () => ({ username: ctx.env.USER || 'root', uid: 0, gid: 0, shell: ctx.env.SHELL || '/bin/sh', homedir: ctx.env.HOME || '/root' }), endianness: () => 'LE', version: () => '#1 SMP', machine: () => 'x86_64', devNull: '/dev/null', availableParallelism: () => n, constants: { signals: { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }, errno: { EACCES: 13, EEXIST: 17, ENOENT: 2, EISDIR: 21, ENOTDIR: 20 } } }; },
    util: () => ({ inspect, format, promisify: Object.assign(fn => { if (fn[promisifyCustom]) return fn[promisifyCustom]; return (...a) => new Promise((r, j) => fn(...a, (e, ...vals) => e ? j(e) : r(vals.length > 1 ? vals : vals[0]))); }, { custom: promisifyCustom }), callbackify: fn => (...a) => { const cb = a.pop(); fn(...a).then(v => cb(null, v), e => cb(e)); }, types: { isPromise: p => p instanceof Promise, isDate: v => v instanceof Date, isRegExp: v => v instanceof RegExp, isBuffer: v => v instanceof Uint8Array, isTypedArray: v => ArrayBuffer.isView(v) && !(v instanceof DataView), isAsyncFunction: f => f?.constructor?.name === 'AsyncFunction', isNativeError: e => e instanceof Error }, deprecate: fn => fn, inherits: (a, b) => { Object.setPrototypeOf(a.prototype, b.prototype); }, debuglog: () => () => {}, isDeepStrictEqual: (a, b) => { const _eq = (x, y, seen) => { if (Object.is(x, y)) return true; if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false; if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false; if (seen.has(x)) return seen.get(x) === y; seen.set(x, y); const kx = Object.keys(x), ky = Object.keys(y); if (kx.length !== ky.length) return false; for (const k of kx) { if (!Object.prototype.hasOwnProperty.call(y, k) || !_eq(x[k], y[k], seen)) return false; } return true; }; return _eq(a, b, new Map()); }, styleText, stripVTControlCharacters, getCallSites, MIMEType, MIMEParams, parseArgs: ({ args = [], options = {} }) => { const values = {}, positionals = []; for (let i = 0; i < args.length; i++) { const a = args[i]; if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); if (v !== undefined) values[k] = v; else if (options[k]?.type === 'string') values[k] = args[++i]; else values[k] = true; } else positionals.push(a); } return { values, positionals }; } }),
    crypto: () => cryptoMod,
    stream: () => streamMod, 'stream/promises': () => streamMod.promises, 'stream/consumers': () => makeStreamConsumers(), 'stream/web': () => ({ ReadableStream, WritableStream, TransformStream }),
    http: () => ({ ...httpClient, Agent: FetchAgent, globalAgent: new FetchAgent() }), https: () => ({ ...httpClient, Agent: FetchAgent, globalAgent: new FetchAgent() }),
    http2: () => http2Mod, 'node:http2': () => http2Mod,
    vm: () => vmMod, 'node:vm': () => vmMod,
    buffer: () => ({ Buffer: Buf, constants: { MAX_LENGTH: 4294967295, MAX_STRING_LENGTH: 536870888 }, kMaxLength: 4294967295, Blob, File }),
    child_process: () => cpMod,
    net: () => netMod, dgram: () => dgramMod, tls: () => tlsMod, worker_threads: () => workerThreads,
    zlib: () => ({ ...zlibMod, ...makeStreamingZlib(streamMod, Buf, globalThis.__fflate || {}), ...(nativeCS || {}), ...makeBrotli(streamMod, Buf) }),
    assert: () => { const mkAssertErr = (msg, actual, expected, operator) => Object.assign(new Error(msg), { name: 'AssertionError', code: 'ERR_ASSERTION', actual, expected, operator }); const a = (v, m) => { if (!v) throw mkAssertErr(m || 'assertion failed'); }; const _specialEq = (x, y) => { if (x instanceof Date && y instanceof Date) return x.getTime() === y.getTime(); if (x instanceof RegExp && y instanceof RegExp) return x.source === y.source && x.flags === y.flags; if (x instanceof Map && y instanceof Map) { if (x.size !== y.size) return false; for (const [k, v] of x) { if (!y.has(k) || y.get(k) !== v) return false; } return true; } if (x instanceof Set && y instanceof Set) { if (x.size !== y.size) return false; for (const v of x) if (!y.has(v)) return false; return true; } return undefined; }; const _deepEq = (x, y, seen) => { if (Object.is(x, y)) return true; if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false; if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false; const sp = _specialEq(x, y); if (sp !== undefined) return sp; if (seen.has(x)) return seen.get(x) === y; seen.set(x, y); const kx = Object.keys(x), ky = Object.keys(y); if (kx.length !== ky.length) return false; for (const k of kx) { if (!Object.prototype.hasOwnProperty.call(y, k) || !_deepEq(x[k], y[k], seen)) return false; } return true; }; const _deepEqLoose = (x, y, seen) => { if (x == y) return true; if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false; const sp = _specialEq(x, y); if (sp !== undefined) return sp; if (seen.has(x)) return seen.get(x) === y; seen.set(x, y); const kx = Object.keys(x), ky = Object.keys(y); if (kx.length !== ky.length) return false; for (const k of kx) { if (!Object.prototype.hasOwnProperty.call(y, k) || !_deepEqLoose(x[k], y[k], seen)) return false; } return true; }; const deepEq = (x, y) => _deepEq(x, y, new Map()); const deepEqLoose = (x, y) => _deepEqLoose(x, y, new Map()); a.ok = a; a.equal = (x, y, m) => { if (!(x == y)) throw mkAssertErr(m || `${inspect(x)} == ${inspect(y)}`, x, y, '=='); }; a.deepEqual = (x, y, m) => { if (!deepEqLoose(x, y)) throw mkAssertErr(m || 'deepEqual failed', x, y, 'deepEqual'); }; a.deepStrictEqual = (x, y, m) => { if (!deepEq(x, y)) throw mkAssertErr(m || `Expected values to be strictly deep-equal:\n\n${inspect(x)}\n\nshould deepStrictEqual\n\n${inspect(y)}\n`, x, y, 'deepStrictEqual'); }; a.strictEqual = (x, y, m) => { if (!(x === y)) throw mkAssertErr(m || `Expected values to be strictly equal:\n\n${inspect(x)} !== ${inspect(y)}\n`, x, y, '==='); }; a.notEqual = (x, y, m) => { if (!(x != y)) throw mkAssertErr(m || `${inspect(x)} != ${inspect(y)}`, x, y, '!='); }; a.notDeepEqual = (x, y, m) => { if (deepEqLoose(x, y)) throw mkAssertErr(m || 'notDeepEqual failed', x, y, 'notDeepEqual'); }; a.notDeepStrictEqual = (x, y, m) => { if (deepEq(x, y)) throw mkAssertErr(m || 'notDeepStrictEqual failed', x, y, 'notDeepStrictEqual'); }; a.notStrictEqual = (x, y, m) => { if (!(x !== y)) throw mkAssertErr(m || 'notStrictEqual failed', x, y, '!=='); }; const _checkErr = (e, err) => { if (err === undefined || typeof err === 'string') return true; if (err instanceof RegExp) return err.test(e && e.message !== undefined ? e.message : String(e)); if (typeof err === 'function' && (err === Error || err.prototype instanceof Error || err.prototype === Error.prototype)) return e instanceof err; if (typeof err === 'function') return !!err(e); if (typeof err === 'object' && err !== null) return Object.keys(err).every(k => e && e[k] === err[k]); return true; }; a.throws = (fn, err, m) => { if (typeof err === 'string' && m === undefined) { m = err; err = undefined; } let caught; try { fn(); } catch (e) { caught = { e }; } if (!caught) throw mkAssertErr(m || 'Missing expected exception.'); if (!_checkErr(caught.e, err)) throw mkAssertErr(m || 'The error is expected to match the validator.', caught.e, err, 'throws'); }; a.doesNotThrow = (fn, m) => { try { fn(); } catch (e) { throw mkAssertErr(m || 'threw unexpectedly'); } }; a.rejects = async (fn, err, m) => { if (typeof err === 'string' && m === undefined) { m = err; err = undefined; } let caught; try { await (typeof fn === 'function' ? fn() : fn); } catch (e) { caught = { e }; } if (!caught) throw mkAssertErr(m || 'Missing expected rejection.'); if (!_checkErr(caught.e, err)) throw mkAssertErr(m || 'The error is expected to match the validator.', caught.e, err, 'rejects'); }; a.fail = m => { throw mkAssertErr(m || 'failed'); }; a.match = (s, re, m) => { if (!re.test(s)) throw mkAssertErr(m || `The input did not match the regular expression ${re}. Input:\n\n${inspect(s)}\n`, s, re, 'match'); }; return a; },
    string_decoder: () => stubs.string_decoder, readline: () => makeReadline(term, proc), 'readline/promises': () => stubs.readline_promises,
    timers: () => makeTimersMod(), 'timers/promises': () => makeTimersMod().promises, perf_hooks: () => makePerfHooks(),
    v8: () => ({ ...makeV8Mod(), ...v8Real, ...heapSnap }), async_hooks: () => makeAsyncHooks(),
    inspector: () => inspector, cluster: () => clusterReal || stubs.cluster,
    codecs: () => { if (!webCodecs) throw makeModuleNotFoundError('codecs', []); return webCodecs; }, 'web-push': () => webPush,
    sea: () => stubs.sea, 'node:sea': () => stubs.sea, test: () => makeTestRunner(term), 'node:test': () => makeTestRunner(term),
    'node:test/reporters': () => ({ tap: makeTapReporter(term), spec: class {}, dot: class {} }), tty: () => stubs.tty, domain: () => stubs.domain,
    diagnostics_channel: () => diagCh, punycode: () => stubs.punycode, errors: () => errorCodes, trace_events: () => traceEv,
    wasi: () => wasiMod, module: () => ({ ...makeModuleModule(() => {}, MODULES), register: moduleRegister.register, _registerHooks: moduleRegister._hooks }), express: () => createExpress(term, fsmod, ctx.httpHandlers),
    'better-sqlite3': createSqlite, sqlite: () => ({ DatabaseSync: createSqlite, StatementSync: class {} }), 'node:sqlite': () => ({ DatabaseSync: createSqlite, StatementSync: class {} }),
    dns: () => dnsMod, 'dns/promises': () => dnsMod.promises, 'node:dns': () => dnsMod, 'isomorphic-git': () => gitMod, git: () => gitMod, tar: () => tarMod, 'npm-registry-fetch': () => registryMod,
    busnet: () => busnet, 'bus-http': () => busHttp,
  };
  for (const k of Object.keys(MODULES)) if (!k.startsWith('node:')) MODULES['node:' + k] = MODULES[k];
  proc.getBuiltinModule = id => { try { return MODULES[id] ? MODULES[id]() : undefined; } catch { return undefined; } };
  const cons = createConsole(term);
  cons.log = (...a) => term.write(format(...a) + '\r\n'); cons.info = cons.log; cons.error = (...a) => term.write('\x1b[31m' + format(...a) + '\x1b[0m\r\n'); cons.warn = (...a) => term.write('\x1b[33m' + format(...a) + '\x1b[0m\r\n'); cons.debug = cons.log; Object.assign(cons, makeConsoleExtras(cons, term));
  function loadDotEnv() { const envFile = snapFn()[ctx.cwd.replace(/^\//, '').replace(/\/$/, '') + '/.env'] || snapFn()['.env']; if (!envFile) return; for (const [k, v] of Object.entries(parseDotEnv(envFile))) if (!(k in ctx.env)) ctx.env[k] = v; }

  const resolveCandidates = (dir, id) => { const base = pathmod.resolve(dir, id); return [base, base + '.js', base + '.json', base + '/index.js', base + '/index.json']; };
  function findPkgJsonDir(s, dir) { let d = dir.replace(/^\//, '').replace(/\/$/, ''); while (true) { const k = (d ? d + '/' : '') + 'package.json'; if (k in s) return d; if (!d) return null; const up = d.slice(0, d.lastIndexOf('/')); if (up === d) return null; d = up; } }
  function isEsmPkg(s, filePath) { const pjDir = findPkgJsonDir(s, pathmod.dirname(filePath)); try { const pj = JSON.parse(s[(pjDir || '') + (pjDir ? '/' : '') + 'package.json']); return pj.type === 'module'; } catch { return false; } }

  const pkgCache = {}; const reqCache = {};
  function makeRequire(dir, mainModule, requireStack = []) {
    const req = function require(id) {
      if (id === 'module') return makeModuleModule(req, MODULES);
      if (MODULES[id]) return MODULES[id]();
      const s = snapFn();
      if (id.startsWith('#')) {
        const pjRoot = findPkgJsonDir(s, dir);
        if (pjRoot) { let pj; try { pj = JSON.parse(s[pjRoot + '/package.json']); } catch { pj = null; } if (pj) { const target = resolveImports(pj, id); if (target) { const resolved = pathmod.resolve('/' + pjRoot, target); return loadFile(resolved.replace(/^\//, ''), s); } } }
        throw makeModuleNotFoundError(id, requireStack);
      }
      if (!id.startsWith('.')) {
        if (pkgCache[id]) return pkgCache[id];
        // require('pkg/lib/x') is a DEEP SUBPATH import: everything up to the
        // first '/' (or, for a scoped @scope/pkg, up to the second '/') is the
        // package name; the rest is a subpath resolved relative to that
        // package's root. Passing the whole 'pkg/lib/x' string as the package
        // name to walkUpNodeModules made it look for the literal directory
        // node_modules/pkg/lib/x/package.json, which never exists -- deep
        // subpath imports (a common real-world pattern, e.g. 'lodash/get')
        // always failed even when the package itself was installed correctly.
        const scopedM = id.match(/^(@[^/]+\/[^/]+)(\/.*)?$/);
        const plainM = id.match(/^([^/]+)(\/.*)?$/);
        const m = scopedM || plainM;
        const pkgName = m[1];
        const subpath = m[2] ? m[2].slice(1) : null;
        const pkgDir = walkUpNodeModules(s, dir, pkgName);
        if (pkgDir) {
          const entry = subpath ? pkgDir + '/' + subpath : resolvePackageEntry(s, pkgDir);
          if (entry) {
            const key = entry.replace(/^\//, '');
            const candidates = subpath ? [key, key + '.js', key + '.json', key + '/index.js'] : [key];
            for (const c of candidates) {
              if (c in s) { const mLoaded = loadFile(c, s); if (mLoaded) { pkgCache[id] = mLoaded; return mLoaded; } }
            }
          }
        }
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
      if (reqCache[key]) {
        return reqCache[key].exports;
      }
      const mod = { exports: {}, loading: true, loaded: false };
      reqCache[key] = mod;
      const modDir = pathmod.dirname('/' + key);
      try {
        const src = s[key]; const esm = key.endsWith('.mjs') || (key.endsWith('.js') && isEsmPkg(s, '/' + key)) || isEsmCode(src);
        if (esm) throw Object.assign(new Error("Must use import to load ES Module: /" + key), { code: 'ERR_REQUIRE_ESM' });
        new Function('module', 'exports', 'require', '__filename', '__dirname', 'process', 'console', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', src)(mod, mod.exports, makeRequire(modDir, mainModule || mod, ['/' + key, ...requireStack]), '/' + key, modDir, proc, cons, Buf, setTimeout, setInterval, clearTimeout, clearInterval, fetch);
      }
      catch (e) { if (reqCache[key] === mod) delete reqCache[key]; throw e; }
      finally { mod.loading = false; }
      mod.loaded = true;
      return mod.exports;
    }
    req.resolve = id => {
      if (MODULES[id] || id === 'module') return id;
      const s = snapFn();
      if (id.startsWith('#')) {
        const pjRoot = findPkgJsonDir(s, dir);
        if (pjRoot) { let pj; try { pj = JSON.parse(s[pjRoot + '/package.json']); } catch { pj = null; } if (pj) { const target = resolveImports(pj, id); if (target) return pathmod.resolve('/' + pjRoot, target); } }
        throw makeModuleNotFoundError(id, requireStack);
      }
      if (!id.startsWith('.')) { const pkgDir = walkUpNodeModules(s, dir, id); if (pkgDir) return resolvePackageEntry(s, pkgDir) || pkgDir; throw makeModuleNotFoundError(id, requireStack); }
      for (const c of resolveCandidates(dir, id)) { const key = c.replace(/^\//, ''); if (key in s) return '/' + key; }
      throw makeModuleNotFoundError(id, requireStack);
    };
    req.cache = reqCache;
    req.main = mainModule;
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
      try { const mod = await import(url); const exp = { ...mod }; if (mod.default && typeof mod.default === 'object') Object.assign(exp, mod.default); const exports = mod.default && Object.keys(mod).length === 1 ? mod.default : exp; pkgCache[id] = exports; reqCache[key] = { exports, loading: false, loaded: true }; }
      catch (e) { term.write('\x1b[31mfailed to load ' + id + ': ' + e.message + (e.stack ? '\r\n' + e.stack : '') + '\x1b[0m\r\n'); debugReg.asyncLoadErrors = debugReg.asyncLoadErrors || []; debugReg.asyncLoadErrors.push({ id, url, error: e, timestamp: Date.now() }); }
    }
  }

  return async function nodeEval(code, filename, argv, stdinBuf, suppressAutoPrint) {
    const dir = filename ? pathmod.dirname(filename) : ctx.cwd;
    const fpath = filename || '[eval]';
    proc.argv = filename ? ['node', fpath, ...(argv || [])] : ['node'];
    proc.exitCode = 0;
    loadDotEnv();
    globalThis.__fflate = await preloadFflate().catch(() => ({}));
    if (proc.sourceMapsEnabled) { await preloadSourceMap().catch(() => {}); installSourceMapStacks(snapFn); }
    const rtName = switchRuntime(code.startsWith('#!') ? code.slice(0, code.indexOf('\n')) : ''); logRuntimeSwitch(debugReg, debugReg.runtime.active, rtName, fpath);
    // A leading shebang (e.g. real npm bin scripts fetched via npx's tarball
    // path, "#!/usr/bin/env node") is valid ONLY as the first line of a
    // top-level script/module; V8 does not special-case it inside a function
    // body. Both eval paths below wrap `code` in a function (new Function(...)
    // for CJS, a Blob-imported module for ESM whose preamble also precedes
    // `code`), so an un-stripped shebang line reaches the parser as a bare `#`
    // token and throws "SyntaxError: Invalid or unexpected token". Strip it
    // (already consumed above for runtime detection) before either eval path.
    if (code.startsWith('#!')) { const nl = code.indexOf('\n'); code = nl === -1 ? '' : code.slice(nl + 1); }
    if (isTsFile(fpath)) code = await preprocessSource(fpath, code);
    await preloadAsyncPkgs(code, dir);
    const entryModule = { exports: {} };
    const reqFn = makeRequire(dir, entryModule);
    const scope = { process: proc, console: cons, require: reqFn, Buffer: Buf, __filename: fpath, __dirname: dir, setTimeout, setInterval, clearTimeout, clearInterval, fetch, module: entryModule, exports: entryModule.exports, global: globalThis, URL, URLSearchParams, TextEncoder, TextDecoder };
    const prevGlobals = { process: globalThis.process, Buffer: globalThis.Buffer, Deno: globalThis.Deno, Bun: globalThis.Bun };
    globalThis.process = proc; globalThis.Buffer = Buf;
    if (rtName === 'deno') globalThis.Deno = denoGlobal; else delete globalThis.Deno;
    if (rtName === 'bun') globalThis.Bun = bunGlobal; else delete globalThis.Bun;
    installCaptureStackTrace(); installPrepareStackTraceHook();
    const unhandledH = e => { e.preventDefault?.(); const err = e.reason || e; term.write('\x1b[31m' + rewriteStack(err, fpath) + '\x1b[0m\r\n'); ctx.lastExitCode = 1; };
    window.addEventListener('unhandledrejection', unhandledH);
    try {
      if (isEsmCode(code)) { const preamble = '\nconst __filename = ' + JSON.stringify(fpath) + ';\nconst __dirname = ' + JSON.stringify(dir) + ';\n'; const mod = await runEsm(preamble + code, scope); if (mod && !filename) { for (const [k, v] of Object.entries(mod)) if (k !== 'default') cons.log(k + ':', v); } ctx.lastExitCode = proc.exitCode | 0; proc._emitSignal?.('exit', ctx.lastExitCode); return; }
      const keys = Object.keys(scope), vals = Object.values(scope);
      const fn = new Function(...keys, 'return (async () => {\n' + code + '\n})()');
      const pending = fn(...vals);
      if (stdinBuf) queueMicrotask(() => proc.stdin._feed(stdinBuf));
      const result = await pending;
      // Only a REPL auto-prints the last expression's value; `node -e`/`node
      // script.js` never do (real Node's -e is silent unless the script
      // itself calls console.log). !filename alone used to gate this (true
      // for BOTH the REPL path and `-e`), which made `-e` wrongly echo its
      // result -- suppressAutoPrint (set by shell-exec.js's -e call site)
      // distinguishes the two now.
      if (result !== undefined && !filename && !suppressAutoPrint) cons.log(result);
      ctx.lastExitCode = proc.exitCode | 0;
      proc._emitSignal?.('exit', ctx.lastExitCode);
    } catch (e) {
      if (e && e.__nodeExit) { ctx.lastExitCode = e.code | 0; proc._emitSignal?.('exit', ctx.lastExitCode); return; }
      // Real Node fires 'uncaughtException' BEFORE the fallback stderr dump +
      // process exit(1) -- a registered handler can suppress the default
      // termination by calling process.exit() itself inside the handler, but
      // this sandboxed eval can't support that (single synchronous script run,
      // no event-loop resumption after the throw), so emit the signal for
      // observability/logging use cases and still fall through to the same
      // stderr+exit-1 behavior every unhandled throw already had.
      proc._emitSignal?.('uncaughtException', e);
      term.write('\x1b[31m' + rewriteStack(e, fpath) + '\x1b[0m\r\n');
      ctx.lastExitCode = 1;
      proc._emitSignal?.('exit', 1);
    } finally {
      window.removeEventListener('unhandledrejection', unhandledH);
      if (prevGlobals.process !== undefined) globalThis.process = prevGlobals.process; else delete globalThis.process;
      if (prevGlobals.Buffer !== undefined) globalThis.Buffer = prevGlobals.Buffer; else delete globalThis.Buffer;
      if (prevGlobals.Deno !== undefined) globalThis.Deno = prevGlobals.Deno; else delete globalThis.Deno;
      if (prevGlobals.Bun !== undefined) globalThis.Bun = prevGlobals.Bun; else delete globalThis.Bun;
    }
  };
}
