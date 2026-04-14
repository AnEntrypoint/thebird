function serializeRoutes(routes) {
  const out = {};
  for (const [method, arr] of Object.entries(routes)) {
    out[method] = arr.map(r => ({ path: r.path }));
  }
  return out;
}

const makeBuiltinModules = term => ({
  express: () => () => {
    const routes = { GET: [], POST: [], USE: [] };
    const app = {
      get: (path, fn) => routes.GET.push({ path, fn }),
      post: (path, fn) => routes.POST.push({ path, fn }),
      use: (fn) => routes.USE.push({ path: '*', fn }),
      listen: (port, cb) => {
        window.__debug.shell.httpHandlers[port] = { routes };
        navigator.serviceWorker?.controller?.postMessage({ type: 'REGISTER_ROUTES', port, routes: serializeRoutes(routes) });
        term.write('Express listening on :' + port + '\r\n');
        cb?.();
      },
    };
    return app;
  },
  'better-sqlite3': () => class Database {
    constructor(name) {
      this._name = name;
      if (!window.__sqlJs) throw new Error('sql.js not loaded — call await loadSql() first');
      this._db = new window.__sqlJs.Database();
    }
    prepare(sql) {
      const db = this._db;
      return {
        run: (...params) => { db.run(sql, params); return { changes: 1 }; },
        get: (...params) => { const r = db.exec(sql, params); return r[0]?.values[0] ? Object.fromEntries(r[0].columns.map((c, i) => [c, r[0].values[0][i]])) : undefined; },
        all: (...params) => { const r = db.exec(sql, params); if (!r[0]) return []; return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]]))); },
      };
    }
  },
});

export function createNodeEnv({ ctx, term }) {
  const BUILTIN_MODULES = makeBuiltinModules(term);
  const scope = {
    process: {
      argv: [],
      env: ctx.env,
      cwd: () => ctx.cwd,
      exit: code => term.write('[exit ' + code + ']\r\n'),
    },
    console: {
      log: (...a) => term.write(a.map(String).join(' ') + '\r\n'),
      error: (...a) => term.write('\x1b[31m' + a.map(String).join(' ') + '\x1b[0m\r\n'),
      warn: (...a) => term.write('\x1b[33m' + a.map(String).join(' ') + '\x1b[0m\r\n'),
    },
    require: id => {
      if (BUILTIN_MODULES[id]) return BUILTIN_MODULES[id]();
      const key = 'node_modules/' + id + '/index.js';
      const src = (window.__debug.idbSnapshot || {})[key];
      if (src == null) throw new Error('module not found: ' + id);
      const mod = { exports: {} };
      new Function('module', 'exports', 'require', src)(mod, mod.exports, scope.require);
      return mod.exports;
    },
    loadSql: async () => {
      if (window.__sqlJs) return window.__sqlJs;
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = './vendor/sql-wasm.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      window.__sqlJs = await initSqlJs({ locateFile: f => './vendor/' + f });
      return window.__sqlJs;
    },
    setTimeout, setInterval, clearTimeout, clearInterval, fetch,
    Buffer: {
      from: (s, enc) => enc === 'base64'
        ? new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0)))
        : new TextEncoder().encode(s),
      toString: (buf, enc) => enc === 'base64'
        ? btoa(String.fromCharCode(...buf))
        : new TextDecoder().decode(buf),
    },
    get __filename() { return ctx.cwd + '/repl'; },
    get __dirname() { return ctx.cwd; },
    http: {
      createServer: handler => ({
        listen: (port, cb) => {
          window.__debug.shell.httpHandlers[port] = handler;
          term.write('listening on :' + port + '\r\n');
          cb?.();
        },
      }),
    },
  };

  return async function nodeEval(code, filename) {
    try {
      const keys = Object.keys(scope);
      const vals = Object.values(scope);
      const fn = new Function(...keys, 'return (async () => {\n' + code + '\n})()');
      await fn(...vals);
    } catch (e) {
      term.write('\x1b[31m' + (filename ? filename + ': ' : '') + e.message + '\x1b[0m\r\n');
    }
  };
}
