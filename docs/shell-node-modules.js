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

export function createExpress(term, fsmod) {
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
      window.__debug.shell.httpHandlers[port] = { routes, middlewares };
      navigator.serviceWorker?.controller?.postMessage({ type: 'REGISTER_ROUTES', port, routes: serializeRoutes(routes) });
      term.write('Express listening on :' + port + '\r\n');
      cb?.();
    };
    app.json = () => (req, res, next) => {
      if (typeof req.body === 'string') try { req.body = JSON.parse(req.body); } catch {}
      next?.();
    };
    app.static = dir => (req, res) => {
      const fp = dir.replace(/\/$/, '') + req.path;
      try { res.send(fsmod.readFileSync(fp)); } catch { res.status(404).send('Not Found'); }
    };
    return app;
  };
}

export function createHttp(term) {
  return () => ({
    createServer(handler) {
      const routes = { GET: [{ path: '*', fn: (req, res) => handler(req, res) }], POST: [], PUT: [], DELETE: [], USE: [] };
      return {
        listen(port, cb) {
          window.__debug.shell.httpHandlers[port] = { routes, middlewares: [] };
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
      if (!window.__sqlJs) throw new Error('sql.js not loaded');
      this._db = new window.__sqlJs.Database();
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

export function createProcess(term, ctx) {
  return {
    argv: ['node'],
    env: ctx.env,
    cwd: () => ctx.cwd,
    chdir: d => { ctx.cwd = d; },
    exit: code => term.write('[exit ' + (code || 0) + ']\r\n'),
    platform: 'browser',
    version: 'v20.0.0',
    versions: { node: '20.0.0' },
    pid: 1,
    nextTick: fn => Promise.resolve().then(fn),
    stdout: { write: s => term.write(String(s)) },
    stderr: { write: s => term.write('\x1b[31m' + String(s) + '\x1b[0m') },
    stdin: { on: () => {} },
    on: () => {},
    off: () => {},
    hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
  };
}
