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
  const toKey = p => p.replace(/^\//, '');
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  return {
    ls: ([p]) => {
      const prefix = toKey(resolvePath(ctx.cwd, p || '')) + '/';
      const keys = prefix === '/' ? Object.keys(snap()) : Object.keys(snap()).filter(k => k.startsWith(prefix));
      wl(keys.join('\r\n') || '(empty)');
    },
    cat: ([f]) => {
      const c = snap()[toKey(resolvePath(ctx.cwd, f))];
      if (c == null) throw new Error('no such file: ' + f);
      wl(c);
    },
    echo: args => wl(args.join(' ')),
    pwd: () => wl(ctx.cwd),
    cd: ([p]) => { ctx.cwd = resolvePath(ctx.cwd, p || '~'); },
    mkdir: ([p]) => {
      window.__debug.idbSnapshot[toKey(resolvePath(ctx.cwd, p)) + '/.keep'] = '';
      window.__debug.idbPersist?.();
    },
    rm: ([f]) => {
      delete window.__debug.idbSnapshot[toKey(resolvePath(ctx.cwd, f))];
      window.__debug.idbPersist?.();
    },
    cp: ([s, d]) => {
      window.__debug.idbSnapshot[toKey(resolvePath(ctx.cwd, d))] = snap()[toKey(resolvePath(ctx.cwd, s))];
      window.__debug.idbPersist?.();
    },
    mv: ([s, d]) => {
      const src = toKey(resolvePath(ctx.cwd, s)), dst = toKey(resolvePath(ctx.cwd, d));
      window.__debug.idbSnapshot[dst] = snap()[src];
      delete window.__debug.idbSnapshot[src];
      window.__debug.idbPersist?.();
    },
    env: () => wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n')),
    export: ([kv]) => { const [k, ...v] = (kv || '').split('='); ctx.env[k] = v.join('='); },
    clear: () => ctx.term.clear(),
    help: () => wl(Object.keys(makeBuiltins(ctx)).join('  ')),
    exit: (actor) => {
      const st = actor.getSnapshot().value;
      if (st === 'node-repl') { actor.send({ type: 'EXIT_REPL' }); wl('[shell]'); }
    },
    node: async ([file], actor) => {
      if (!file) { actor.send({ type: 'ENTER_REPL' }); wl('[node repl — type exit to return]'); return; }
      const path = resolvePath(ctx.cwd, file);
      const code = snap()[toKey(path)];
      if (code == null) throw new Error('no such file: ' + path);
      actor.send({ type: 'NODE_START' });
      await ctx.nodeEval(code, path);
    },
    npm: async (args, actor) => {
      if (args[0] !== 'install') throw new Error('only npm install supported');
      const pkg = args[1];
      if (!pkg) throw new Error('npm install <pkg>');
      actor.send({ type: 'NPM_START' });
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
  idle: { on: { RUN: 'executing', ENTER_REPL: 'node-repl', NPM_START: 'npm-installing', NODE_START: 'node-running' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
  'npm-installing': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-running': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-repl': { on: { EXIT_REPL: 'idle', RUN: 'node-repl' } },
}});

export function createShell({ term, onPreviewWrite }) {
  const ctx = { term, cwd: '/', env: {}, history: [], httpHandlers: {} };
  const BUILTINS = makeBuiltins(ctx);
  ctx.nodeEval = createNodeEnv({ ctx, term });

  const actor = createActor(machine);
  actor.start();

  let inputQueue = [];

  function drainQueue(onData) {
    const items = inputQueue.slice();
    inputQueue = [];
    for (const d of items) onData(d);
  }

  window.__debug = window.__debug || {};
  window.__debug.shell = {
    get state() { return actor.getSnapshot().value; },
    get cwd() { return ctx.cwd; },
    get env() { return ctx.env; },
    get history() { return ctx.history; },
    httpHandlers: ctx.httpHandlers,
    get inputQueue() { return inputQueue.slice(); },
  };

  async function runCmd(line, capture, actor) {
    if (!line.trim()) return '';
    const [cmd, ...args] = line.trim().split(/\s+/);
    const fn = BUILTINS[cmd];
    if (!capture) {
      if (fn) await fn(args, actor); else term.write('command not found: ' + cmd + '\r\n');
      return '';
    }
    let out = '';
    const orig = term.write.bind(term);
    term.write = s => { out += s; };
    try { if (fn) await fn(args, actor); else out += 'command not found: ' + cmd + '\r\n'; }
    finally { term.write = orig; }
    return out;
  }

  async function run(line, onData) {
    if (!line.trim()) return;
    ctx.history.push(line);
    const st = actor.getSnapshot().value;
    if (st === 'node-repl' && line.trim() !== 'exit') { await ctx.nodeEval(line); return; }
    if (line.trim() === 'exit') { BUILTINS.exit(actor); return; }
    const [cmd] = line.trim().split(/\s+/);
    if (cmd !== 'npm' && cmd !== 'node') actor.send({ type: 'RUN' });
    try {
      const parts = line.split(' | ');
      if (parts.length > 1) {
        let buf = await runCmd(parts[0], true, actor);
        for (const p of parts.slice(1)) {
          const [c, ...a] = p.trim().split(/\s+/);
          const fn = BUILTINS[c];
          if (fn) await fn([buf, ...a], actor); else term.write('command not found: ' + c + '\r\n');
          buf = '';
        }
      } else {
        await runCmd(line, false, actor);
      }
      actor.send({ type: 'DONE' });
      drainQueue(onData);
    } catch (e) {
      term.write('\x1b[31m' + e.message + '\x1b[0m\r\n');
      actor.send({ type: 'ERROR' });
      drainQueue(onData);
    }
  }

  const prompt = () => term.write('\r\n\x1b[32m' + ctx.cwd + ' $ \x1b[0m');
  let buf = '';

  function onData(data) {
    if (data === '\x03') {
      actor.send({ type: 'ERROR' });
      inputQueue = [];
      buf = '';
      term.write('^C');
      prompt();
      return;
    }
    const st = actor.getSnapshot().value;
    if (st !== 'idle' && st !== 'node-repl') {
      inputQueue.push(data);
      return;
    }
    if (data === '\r') {
      term.write('\r\n');
      const line = buf;
      buf = '';
      run(line, onData).then(() => prompt());
    } else if (data === '\x7f') {
      if (buf.length) { buf = buf.slice(0, -1); term.write('\x08 \x08'); }
    } else {
      buf += data;
      term.write(data);
    }
  }

  term.onData(onData);
  onPreviewWrite && (window.__debug.shell.onPreviewWrite = onPreviewWrite);
  const runPublic = line => run(line, onData);
  window.__debug.shell.run = runPublic;
  prompt();
  return { run: runPublic };
}
