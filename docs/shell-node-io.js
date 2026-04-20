export function createChildProcess(ctx) {
  async function runThroughShell(cmd) {
    const shell = window.__debug?.shell;
    if (!shell?.run) throw new Error('child_process: shell not ready');
    let captured = '';
    const origWrite = ctx.term.write.bind(ctx.term);
    ctx.term.write = s => { captured += s; };
    try { await shell.run(cmd); } finally { ctx.term.write = origWrite; }
    return { stdout: captured.replace(/\r\n/g, '\n').replace(/\x1b\[\d+m/g, ''), code: ctx.lastExitCode | 0 };
  }
  return {
    spawn: (cmd, args = [], opts = {}) => {
      const handlers = { stdout: [], stderr: [], exit: [], close: [], error: [] };
      const emit = (ev, ...a) => { for (const h of handlers[ev] || []) h(...a); };
      const emitter = {
        stdout: { on: (ev, fn) => { if (ev === 'data') handlers.stdout.push(fn); return emitter.stdout; }, pipe: () => emitter.stdout },
        stderr: { on: (ev, fn) => { if (ev === 'data') handlers.stderr.push(fn); return emitter.stderr; } },
        stdin: { write: () => true, end: () => {} },
        on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return emitter; },
        once: (ev, fn) => emitter.on(ev, fn),
        kill: () => {},
        pid: Math.floor(Math.random() * 65535) + 1,
      };
      const line = [cmd, ...args].join(' ');
      queueMicrotask(async () => {
        try { const r = await runThroughShell(line); if (r.stdout) emit('stdout', r.stdout); emit('exit', r.code, null); emit('close', r.code, null); }
        catch (e) { emit('error', e); emit('exit', 1, null); emit('close', 1, null); }
      });
      return emitter;
    },
    exec: (cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      queueMicrotask(async () => { try { const r = await runThroughShell(cmd); cb?.(r.code === 0 ? null : Object.assign(new Error('exit ' + r.code), { code: r.code }), r.stdout, ''); } catch (e) { cb?.(e, '', String(e.message)); } });
    },
    execSync: cmd => { throw new Error('child_process.execSync: use exec() with callback in browser — sync subprocess impossible'); },
    fork: () => { throw new Error('child_process.fork: not supported in browser'); },
  };
}

export function createHttpClient(Buf) {
  function makeReq(urlOrOpts, cb) {
    const u = typeof urlOrOpts === 'string' ? urlOrOpts : ('http://' + (urlOrOpts.hostname || 'localhost') + ':' + (urlOrOpts.port || 80) + (urlOrOpts.path || '/'));
    const opts = typeof urlOrOpts === 'object' ? urlOrOpts : {};
    const handlers = { response: [], error: [], finish: [] };
    const emit = (ev, ...a) => { for (const h of handlers[ev] || []) h(...a); };
    let body = '';
    const req = {
      on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return req; },
      write: chunk => { body += String(chunk); return true; },
      end: async chunk => {
        if (chunk != null) body += String(chunk);
        try {
          const res = await fetch(u, { method: opts.method || 'GET', headers: opts.headers || {}, body: body || undefined });
          const text = await res.text();
          const resObj = {
            statusCode: res.status, statusMessage: res.statusText, headers: Object.fromEntries(res.headers.entries()),
            on: (ev, fn) => { if (ev === 'data') queueMicrotask(() => fn(Buf.from(text))); if (ev === 'end') queueMicrotask(() => fn()); return resObj; },
            setEncoding: () => {}, pipe: () => {},
          };
          cb?.(resObj); emit('response', resObj);
        } catch (e) { emit('error', e); }
      },
      setHeader: () => {}, getHeader: () => undefined, abort: () => {}, destroy: () => {},
    };
    return req;
  }
  return {
    request: (urlOrOpts, cb) => makeReq(urlOrOpts, cb),
    get: (urlOrOpts, cb) => { const r = makeReq(urlOrOpts, cb); r.end(); return r; },
    Agent: class Agent {},
    STATUS_CODES: { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error' },
  };
}

export function extendProcess(proc, ctx) {
  proc.execPath = '/usr/local/bin/node';
  proc.argv0 = 'node';
  proc.title = 'node';
  if (!ctx.env.PATH) ctx.env.PATH = '/usr/local/bin:/usr/bin:/bin';
  if (!ctx.env.HOME) ctx.env.HOME = '/root';
  if (!ctx.env.USER) ctx.env.USER = 'root';
  if (!ctx.env.SHELL) ctx.env.SHELL = '/bin/jsh';
  if (!ctx.env.TERM) ctx.env.TERM = 'xterm-256color';
  if (!ctx.env.LANG) ctx.env.LANG = 'C.UTF-8';
  proc.memoryUsage = () => ({ rss: 50000000, heapTotal: 20000000, heapUsed: 10000000, external: 0, arrayBuffers: 0 });
  proc.uptime = () => performance.now() / 1000;
  proc.cpuUsage = () => ({ user: 0, system: 0 });
  proc.getuid = () => 0; proc.getgid = () => 0; proc.geteuid = () => 0; proc.getegid = () => 0;
  proc.umask = () => 0o022;
  proc.features = { tls: false };
  proc.release = { name: 'node', lts: false, sourceUrl: '', headersUrl: '' };
  return proc;
}

export function rewriteStack(err, filename) {
  if (!err.stack) return err.message;
  const lines = err.stack.split('\n');
  const first = lines[0];
  const fname = filename || '[eval]';
  const frames = lines.slice(1)
    .filter(l => !l.includes('new Function') && !l.includes('AsyncFunction') && !l.includes('<anonymous>'))
    .map(l => l.replace(/\bat eval \(eval at[^)]*\), /, 'at ').replace(/:(\d+):(\d+)\)?$/, (_, ln, col) => ':' + ln + ':' + col))
    .slice(0, 5);
  return [first, ...frames].join('\n') + '\n\nNode.js v23.10.0';
}

export function isEsmCode(code) {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return /^\s*(import\s+[\w*{]|import\s*['"`]|export\s+(default|const|function|class|let|var|\{))/m.test(stripped);
}

export async function runEsm(code, scope) {
  const injectionKeys = Object.keys(scope);
  const preamble = injectionKeys.map(k => `const ${k} = globalThis.__esmScope__.${k};`).join('\n');
  globalThis.__esmScope__ = scope;
  const blob = new Blob([preamble + '\n' + code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}

export function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
