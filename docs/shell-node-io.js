export function createChildProcess(ctx) {
  // child_process.exec/spawn captures shell output by intercepting ctx.term.write.
  // Concurrent calls each patched/restored the GLOBAL ctx.term.write against a
  // captured origWrite, so two in-flight execs raced: the inner restore could
  // reinstate a stale writer and one call's output leaked into the other (or the
  // real terminal write was lost). Serialize exec calls through a tail promise so
  // only one capture patch is active at a time — output stays paired to its call.
  let execTail = Promise.resolve();
  async function runThroughShell(cmd) {
    // ctx here IS the same context object createShell (shell.js) builds and
    // threads into createNodeEnv -- ctx.exec (set at shell.js's `ctx.exec = line
    // => run(line)`) is the actual injected re-entry point into this shell
    // instance's own run loop, not the shared window.__debug.shell global
    // (which is the desktop-shell's own unrelated API object, not this
    // terminal's createShell() instance -- reaching for it here could invoke a
    // DIFFERENT shell instance's run loop entirely in a multi-terminal page).
    const shellExec = ctx.exec || window.__debug?.shell?.run;
    if (!shellExec) throw new Error('child_process: shell not ready');
    const run = execTail.then(async () => {
      let captured = '';
      const prevWrite = ctx.term.write.bind(ctx.term);
      ctx.term.write = s => { captured += s; };
      try { await shellExec(cmd); } finally { ctx.term.write = prevWrite; }
      return { stdout: captured.replace(/\r\n/g, '\n').replace(/\x1b\[\d+m/g, ''), code: ctx.lastExitCode | 0 };
    });
    // keep the chain alive even if this run rejects, so a failure can't wedge the queue
    execTail = run.catch(e => { console.error('shell exec failed:', e); });
    return run;
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
        off: (ev, fn) => { if (handlers[ev]) handlers[ev] = handlers[ev].filter(x => x !== fn); return emitter; },
        once: (ev, fn) => { const wrap = (...a) => { emitter.off(ev, wrap); fn(...a); }; return emitter.on(ev, wrap); },
        removeListener: (ev, fn) => emitter.off(ev, fn),
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
    execSync: cmd => { throw Object.assign(new Error('child_process.execSync: use exec() with callback in browser - sync subprocess impossible'), { code: 'ENOSYS', status: null, stdout: '', stderr: '' }); },
    fork: () => { throw Object.assign(new Error('child_process.fork: not supported in browser sandbox'), { code: 'ENOSYS' }); },
  };
}

export function createHttpClient(Buf) {
  function makeReq(urlOrOpts, cb) {
    // Respect the requested scheme/port instead of hardcoding http:80 — an
    // https request built as http://host:80 silently hit the wrong endpoint.
    const proto = typeof urlOrOpts === 'object' ? String(urlOrOpts.protocol || 'http:').replace(/:?$/, ':') : 'http:';
    const defPort = proto === 'https:' ? 443 : 80;
    const u = typeof urlOrOpts === 'string' ? urlOrOpts : (proto + '//' + (urlOrOpts.hostname || 'localhost') + ':' + (urlOrOpts.port || defPort) + (urlOrOpts.path || '/'));
    const opts = typeof urlOrOpts === 'object' ? urlOrOpts : {};
    const handlers = { response: [], error: [], finish: [] };
    const emit = (ev, ...a) => { for (const h of handlers[ev] || []) h(...a); };
    // Request body is BUFFERED in memory (not streamed): write() accumulates into
    // `body` and the single fetch() fires on end(). write() always returns true —
    // backpressure is not honored, so callers must not rely on write() returning
    // false to pause a producer. For true streaming request bodies use native
    // fetch() with a ReadableStream. Maximum buffered body size is 10MB; write()
    // throws if exceeded to prevent OOM on constrained devices.
    const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
    let body = '';
    const req = {
      on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return req; },
      write: chunk => { const s = String(chunk); if (body.length + s.length > MAX_BODY_SIZE) throw new Error('http request body exceeds 10MB limit'); body += s; return true; },
      end: async chunk => {
        if (chunk != null) body += String(chunk);
        let timer;
        try {
          const controller = new AbortController();
          if (opts.timeout) timer = setTimeout(() => controller.abort(), opts.timeout);
          const res = await fetch(u, { method: opts.method || 'GET', headers: opts.headers || {}, body: body || undefined, signal: controller.signal });
          if (timer) clearTimeout(timer);
          // Honest streaming: emit one 'data' event per fetch chunk via the body
          // reader instead of buffering the whole payload with res.text().
          // Chunks that arrive before a listener attaches are buffered and
          // replayed on registration so no data is lost.
          const resHandlers = { data: [], end: [], error: [] };
          const pending = { data: [], ended: false, error: null };
          const resEmit = (ev, ...a) => {
            if (ev === 'data' && !resHandlers.data.length) { pending.data.push(a[0]); return; }
            if (ev === 'end') pending.ended = true;
            if (ev === 'error') pending.error = a[0];
            for (const h of resHandlers[ev]) h(...a);
          };
          const resObj = {
            statusCode: res.status, statusMessage: res.statusText, headers: Object.fromEntries(res.headers.entries()),
            on: (ev, fn) => {
              if (!resHandlers[ev]) return resObj;
              resHandlers[ev].push(fn);
              queueMicrotask(() => {
                if (ev === 'data') { const q = pending.data; pending.data = []; for (const c of q) fn(c); }
                if (ev === 'end' && pending.ended) fn();
                if (ev === 'error' && pending.error) fn(pending.error);
              });
              return resObj;
            },
            setEncoding: () => {}, pipe: () => {},
          };
          cb?.(resObj); emit('response', resObj);
          try {
            const reader = res.body?.getReader();
            if (reader) {
              for (;;) { const { done, value } = await reader.read(); if (done) break; resEmit('data', Buf.from(value)); }
            } else {
              const text = await res.text();
              if (text) resEmit('data', Buf.from(text));
            }
            resEmit('end');
          } catch (e) { resEmit('error', e); }
        } catch (e) {
          if (timer) clearTimeout(timer);
          // fetch() collapses DNS failure/connection refused/CORS block/abort into
          // a generic TypeError with no .code — approximate Node's errno shape so
          // the common `err.code === 'ECONNREFUSED'` idiom still matches, and map
          // an explicit opts.timeout abort to ETIMEDOUT specifically. True
          // ENOTFOUND-vs-ECONNREFUSED disambiguation is impossible from JS (fetch's
          // security model hides it), so we don't fabricate it — only the message
          // text is rewritten to Node's canonical format.
          const { hostname, port } = new URL(u);
          const code = e?.name === 'AbortError' ? 'ETIMEDOUT' : 'ECONNREFUSED';
          const message = `connect ${code} ${hostname}:${port || defPort}`;
          emit('error', Object.assign(e, { code, message }));
        }
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
  proc.memoryUsage = () => {
    // No real process RSS in a browser; derive from performance.memory when the
    // engine exposes it, otherwise report zeros so callers do not trust growth.
    const m = (typeof performance !== 'undefined' && performance.memory) || null;
    const heapUsed = m ? m.usedJSHeapSize : 0;
    const heapTotal = m ? m.totalJSHeapSize : 0;
    return { rss: heapTotal, heapTotal, heapUsed, external: 0, arrayBuffers: 0 };
  };
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
