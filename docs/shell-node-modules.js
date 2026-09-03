function serializeRoutes(routes) {
  const out = {};
  for (const [method, arr] of Object.entries(routes)) out[method] = arr.map(r => ({ path: r.path }));
  return out;
}

function runFns(fns, req, res) {
  let i = 0;
  const next = err => {
    if (err) { res.status?.(500).send?.(String(err)); return; }
    const fn = fns[i++];
    if (fn) fn(req, res, next);
  };
  next();
}

export function createExpress(term, fsmod, httpHandlers) {
  // httpHandlers is the same instance-scoped route table object shell.js
  // constructs and exposes via ctx.httpHandlers/the public API -- falls back to
  // the shared window.__debug.shell global only when a caller didn't inject one
  // (window.__debug.shell is the desktop os-shell.js's own API object, not this
  // createShell() instance, so relying on it here silently wrote routes onto
  // the wrong object in a multi-terminal page).
  const handlers = httpHandlers || (window.__debug.shell || (window.__debug.shell = {})).httpHandlers || (window.__debug.shell.httpHandlers = {});
  return () => {
    const routes = { GET: [], POST: [], PUT: [], DELETE: [], USE: [] };
    const middlewares = [];
    const app = fn => middlewares.push(fn);
    const addRoute = method => (p, ...fns) => routes[method].push({ path: p, fn: (req, res) => runFns([...middlewares, ...fns], req, res) });
    app.get = addRoute('GET');
    app.post = addRoute('POST');
    app.put = addRoute('PUT');
    app.delete = addRoute('DELETE');
    app.use = (...args) => {
      if (typeof args[0] === 'function') middlewares.push(args[0]);
      else routes.USE.push({ path: args[0], fn: args[1] });
    };
    app.listen = (port, cb) => {
      handlers[port] = { routes, middlewares };
      navigator.serviceWorker?.controller?.postMessage({ type: 'REGISTER_ROUTES', port, routes: serializeRoutes(routes) });
      term.write('Express listening on :' + port + '\r\n');
      cb?.();
    };
    app.json = () => (req, res, next) => {
      if (typeof req.body === 'string') try { req.body = JSON.parse(req.body); } catch { /* swallow: body isn't JSON, leave it as the raw string for the handler to interpret */ }
      next?.();
    };
    app.static = dir => (req, res) => {
      const fp = dir.replace(/\/$/, '') + req.path;
      try { res.send(fsmod.readFileSync(fp)); } catch { res.status(404).send('Not Found'); }
    };
    return app;
  };
}

export function createHttp(term, httpHandlers) {
  // Same instance-scoped-over-global contract as createExpress above.
  const handlers = httpHandlers || (window.__debug.shell || (window.__debug.shell = {})).httpHandlers || (window.__debug.shell.httpHandlers = {});
  return () => ({
    createServer(handler) {
      const routes = { GET: [{ path: '*', fn: (req, res) => handler(req, res) }], POST: [], PUT: [], DELETE: [], USE: [] };
      return {
        listen(port, cb) {
          handlers[port] = { routes, middlewares: [] };
          term.write('http listening on :' + port + '\r\n');
          (typeof cb === 'function' ? cb : (typeof port === 'function' ? port : null))?.();
          return this;
        },
        close(cb) { cb?.(); },
        on() { return this; },
      };
    },
    request: () => { throw new Error('http.request: not supported in browser — use fetch()'); },
    get: () => { throw new Error('http.get: not supported in browser — use fetch()'); },
    STATUS_CODES: { 200: 'OK', 404: 'Not Found', 500: 'Internal Server Error' },
  });
}

export function createSqlite() {
  return class Database {
    constructor(name) {
      this._name = name;
      const init = globalThis.sqlite3InitModule;
      if (typeof init !== 'function') throw new Error('sqlite3InitModule (plugkit-backed) not loaded');
      const ns = init.__sync;
      if (!ns) throw new Error('createSqlite: synchronous sqlite3 namespace unavailable; use async createClient instead');
      this._db = new ns.oo1.DB();
    }
    prepare(sql) {
      const db = this._db;
      return {
        run: (...p) => { db.run(sql, p); return { changes: 1 }; },
        get: (...p) => { const r = db.exec(sql, p); return r[0]?.values[0] ? Object.fromEntries(r[0].columns.map((c, i) => [c, r[0].values[0][i]])) : undefined; },
        all: (...p) => { const r = db.exec(sql, p); if (!r[0]) return []; return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]]))); },
      };
    }
    close() {}
  };
}

export function createConsole(term) {
  const w = s => term.write(s + '\r\n');
  const timers = {};
  return {
    log: (...a) => w(a.map(v => typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)).join(' ')),
    error: (...a) => term.write('\x1b[31m' + a.map(String).join(' ') + '\x1b[0m\r\n'),
    warn: (...a) => term.write('\x1b[33m' + a.map(String).join(' ') + '\x1b[0m\r\n'),
    info: (...a) => w(a.map(String).join(' ')),
    dir: o => w(JSON.stringify(o, null, 2)),
    table: data => {
      if (!Array.isArray(data)) { w(JSON.stringify(data, null, 2)); return; }
      if (!data.length) { w('(empty)'); return; }
      const cols = Object.keys(data[0]);
      w(cols.join('\t'));
      for (const row of data) w(cols.map(c => String(row[c] ?? '')).join('\t'));
    },
    time: label => { timers[label || 'default'] = performance.now(); },
    timeEnd: label => {
      const k = label || 'default';
      const ms = timers[k] ? (performance.now() - timers[k]).toFixed(3) : 0;
      delete timers[k];
      w(k + ': ' + ms + 'ms');
    },
    assert: (cond, ...a) => { if (!cond) term.write('\x1b[31mAssertion failed: ' + a.join(' ') + '\x1b[0m\r\n'); },
    count: (() => { const c = {}; return label => { const k = label || 'default'; c[k] = (c[k] || 0) + 1; w(k + ': ' + c[k]); }; })(),
    clear: () => term.clear(),
    trace: (...a) => w('Trace: ' + a.map(String).join(' ')),
    group: () => {},
    groupEnd: () => {},
  };
}

export const NODE_VERSION = 'v23.10.0';
export const NODE_VERSIONS = { node: '23.10.0', acorn: '8.14.0', ada: '3.1.3', amaro: '0.4.1', ares: '1.34.4', brotli: '1.1.0', cjs_module_lexer: '2.1.0', cldr: '46.0', icu: '76.1', llhttp: '9.2.1', modules: '131', napi: '10', nbytes: '0.1.1', ncrypto: '0.0.1', nghttp2: '1.64.0', openssl: '3.0.16', simdjson: '3.12.2', simdutf: '6.0.3', sqlite: '3.49.1', tz: '2025a', undici: '6.21.1', unicode: '16.0', uv: '1.50.0', uvwasi: '0.0.21', v8: '12.9.202.28-node.13', zlib: '1.3.0.1-motley-788cb3c', zstd: '1.5.6' };
export const NPM_VERSION = '10.9.2';

export class NodeExit extends Error {
  constructor(code) {
    super('__NodeExit:' + code);
    if (code === undefined) code = 0;
    if (typeof code !== 'number') { const e = new TypeError('The "code" argument must be of type number. Received type ' + typeof code); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (!Number.isInteger(code)) { const e = new RangeError('The value of "code" is out of range. It must be an integer. Received ' + code); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    this.code = code < 0 ? 127 : (code % 256);
    this.__nodeExit = true;
  }
}

export function createProcess(term, ctx) {
  const stdinHandlers = { data: [], end: [] };
  let _title = 'node';
  return {
    argv: ['node'],
    argv0: 'node',
    get title() { return _title; },
    set title(v) { _title = String(v); },
    env: ctx.env,
    cwd: () => ctx.cwd,
    chdir: d => { ctx.cwd = d; },
    exit: code => { throw new NodeExit(code || 0); },
    platform: 'linux',
    arch: 'x64',
    version: NODE_VERSION,
    versions: { ...NODE_VERSIONS },
    pid: 1,
    ppid: 0,
    nextTick: fn => Promise.resolve().then(fn),
    stdout: { write: s => { term.write(String(s)); return true; }, isTTY: true, columns: 80, rows: 24 },
    stderr: { write: s => { term.write('\x1b[31m' + String(s) + '\x1b[0m'); return true; }, isTTY: true, columns: 80, rows: 24 },
    stdin: {
      on: (ev, fn) => { (stdinHandlers[ev] || (stdinHandlers[ev] = [])).push(fn); return this; },
      once: (ev, fn) => { (stdinHandlers[ev] || (stdinHandlers[ev] = [])).push(fn); },
      _feed: buf => { if (buf) for (const h of stdinHandlers.data) h(buf); for (const h of stdinHandlers.end) h(); },
      isTTY: false, setEncoding: () => {}, resume: () => {}, pause: () => {},
    },
    on: () => {},
    off: () => {},
    emit: () => {},
    hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
    exitCode: 0,
    _stdinHandlers: stdinHandlers,
  };
}
