export function createNodeEnv({ ctx, term }) {
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
      const key = 'node_modules/' + id + '/index.js';
      const src = (window.__debug.idbSnapshot || {})[key];
      if (src == null) throw new Error('module not found: ' + id);
      const mod = { exports: {} };
      new Function('module', 'exports', 'require', src)(mod, mod.exports, scope.require);
      return mod.exports;
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
