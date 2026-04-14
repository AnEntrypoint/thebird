import { createMachine, createActor } from './vendor/xstate.js';
import { createNodeEnv } from './shell-node.js';

function resolvePath(cwd, p) {
  if (!p || p === '~') return '/';
  if (p.startsWith('~/')) p = '/' + p.slice(2);
  if (!p.startsWith('/')) p = cwd.replace(/\/$/, '') + '/' + p;
  const parts = [];
  for (const s of p.split('/')) {
    if (s === '..') parts.pop();
    else if (s && s !== '.') parts.push(s);
  }
  return '/' + parts.join('/');
}

function makeBuiltins(ctx) {
  const snap = () => window.__debug.idbSnapshot || {};
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  return {
    ls: ([p]) => {
      const prefix = resolvePath(ctx.cwd, p || '') + '/';
      const keys = prefix === '//' ? Object.keys(snap()) : Object.keys(snap()).filter(k => k.startsWith(prefix === '//' ? '/' : prefix));
      wl(keys.join('\r\n') || '(empty)');
    },
    cat: ([f]) => {
      const c = snap()[resolvePath(ctx.cwd, f)];
      if (c == null) throw new Error('no such file: ' + f);
      wl(c);
    },
    echo: args => wl(args.join(' ')),
    pwd: () => wl(ctx.cwd),
    cd: ([p]) => { ctx.cwd = resolvePath(ctx.cwd, p || '~'); },
    mkdir: ([p]) => {
      window.__debug.idbSnapshot[resolvePath(ctx.cwd, p) + '/.keep'] = '';
      window.__debug.idbPersist?.();
    },
    rm: ([f]) => {
      delete window.__debug.idbSnapshot[resolvePath(ctx.cwd, f)];
      window.__debug.idbPersist?.();
    },
    cp: ([s, d]) => {
      window.__debug.idbSnapshot[resolvePath(ctx.cwd, d)] = snap()[resolvePath(ctx.cwd, s)];
      window.__debug.idbPersist?.();
    },
    mv: ([s, d]) => {
      const src = resolvePath(ctx.cwd, s), dst = resolvePath(ctx.cwd, d);
      window.__debug.idbSnapshot[dst] = snap()[src];
      delete window.__debug.idbSnapshot[src];
      window.__debug.idbPersist?.();
    },
    env: () => wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n')),
    export: ([kv]) => { const [k, ...v] = (kv || '').split('='); ctx.env[k] = v.join('='); },
    clear: () => ctx.term.clear(),
    help: () => wl(Object.keys(makeBuiltins(ctx)).join('  ')),
    exit: () => { if (ctx.nodeMode) { ctx.nodeMode = false; wl('[shell]'); } },
    node: async ([file]) => {
      if (!file) { ctx.nodeMode = true; wl('[node repl — type exit to return]'); return; }
      const path = resolvePath(ctx.cwd, file);
      const code = snap()[path];
      if (code == null) throw new Error('no such file: ' + path);
      await ctx.nodeEval(code, path);
    },
    npm: async args => {
      if (args[0] !== 'install') throw new Error('only npm install supported');
      const pkg = args[1];
      if (!pkg) throw new Error('npm install <pkg>');
      w('fetching ' + pkg + '...\r\n');
      const r = await fetch('https://esm.sh/' + pkg);
      if (!r.ok) throw new Error('fetch failed: ' + r.status);
      const key = 'node_modules/' + pkg + '/index.js';
      window.__debug.idbSnapshot[key] = await r.text();
      window.__debug.idbPersist?.();
      wl('installed ' + pkg);
    },
  };
}

const machine = createMachine({ id: 'shell', initial: 'idle', states: {
  idle: { on: { RUN: 'executing' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
}});

export function createShell({ term, onPreviewWrite }) {
  const ctx = { term, cwd: '/', env: {}, nodeMode: false, history: [], httpHandlers: {} };
  const BUILTINS = makeBuiltins(ctx);
  ctx.nodeEval = createNodeEnv({ ctx, term });

  const actor = createActor(machine);
  actor.start();

  window.__debug = window.__debug || {};
  window.__debug.shell = {
    get state() { return actor.getSnapshot().value; },
    get cwd() { return ctx.cwd; },
    get env() { return ctx.env; },
    get history() { return ctx.history; },
    httpHandlers: ctx.httpHandlers,
    get nodeMode() { return ctx.nodeMode; },
  };

  async function runCmd(line, capture) {
    if (!line.trim()) return '';
    const [cmd, ...args] = line.trim().split(/\s+/);
    const fn = BUILTINS[cmd];
    if (!capture) {
      if (fn) await fn(args); else term.write('command not found: ' + cmd + '\r\n');
      return '';
    }
    let out = '';
    const orig = term.write.bind(term);
    term.write = s => { out += s; };
    try { if (fn) await fn(args); else out += 'command not found: ' + cmd + '\r\n'; }
    finally { term.write = orig; }
    return out;
  }

  async function run(line) {
    if (!line.trim()) return;
    ctx.history.push(line);
    if (ctx.nodeMode && line.trim() !== 'exit') { await ctx.nodeEval(line); return; }
    if (line.trim() === 'exit') { BUILTINS.exit([]); return; }
    actor.send({ type: 'RUN' });
    try {
      const parts = line.split(' | ');
      if (parts.length > 1) {
        let buf = await runCmd(parts[0], true);
        for (const p of parts.slice(1)) {
          const [cmd, ...args] = p.trim().split(/\s+/);
          const fn = BUILTINS[cmd];
          if (fn) await fn([buf, ...args]); else term.write('command not found: ' + cmd + '\r\n');
          buf = '';
        }
      } else {
        await runCmd(line, false);
      }
      actor.send({ type: 'DONE' });
    } catch (e) {
      term.write('\x1b[31m' + e.message + '\x1b[0m\r\n');
      actor.send({ type: 'ERROR' });
    }
  }

  const prompt = () => term.write('\r\n\x1b[32m' + ctx.cwd + ' $ \x1b[0m');
  let buf = '';
  term.onData(async data => {
    if (data === '\r') {
      term.write('\r\n');
      const line = buf;
      buf = '';
      await run(line);
      prompt();
    } else if (data === '\x7f') {
      if (buf.length) { buf = buf.slice(0, -1); term.write('\x08 \x08'); }
    } else {
      buf += data;
      term.write(data);
    }
  });

  onPreviewWrite && (window.__debug.shell.onPreviewWrite = onPreviewWrite);
  prompt();
  return { run };
}
