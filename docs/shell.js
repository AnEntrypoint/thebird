import { createMachine, createActor } from './vendor/xstate.js';
import { createNodeEnv } from './shell-node.js';
import { createReadline } from './shell-readline.js';

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
      const prefix = toKey(resolvePath(ctx.cwd, p || ''));
      const pLen = prefix ? prefix.length + 1 : 0;
      const seen = new Set();
      for (const k of Object.keys(snap())) {
        if (prefix && !k.startsWith(prefix + '/') && k !== prefix) continue;
        if (!prefix && !k.includes('/')) { seen.add(k); continue; }
        const rest = k.slice(pLen);
        const first = rest.split('/')[0];
        if (first && first !== '.keep') seen.add(first);
      }
      wl([...seen].join('\r\n') || '(empty)');
    },
    cat: ([f]) => {
      const c = snap()[toKey(resolvePath(ctx.cwd, f))];
      if (c == null) throw new Error('no such file: ' + f);
      wl(c);
    },
    echo: args => wl(args.join(' ')),
    pwd: () => wl(ctx.cwd),
    cd: ([p]) => { ctx.cwd = resolvePath(ctx.cwd, p || '~'); },
    mkdir: ([p]) => { snap()[toKey(resolvePath(ctx.cwd, p)) + '/.keep'] = ''; window.__debug.idbPersist?.(); },
    rm: ([f]) => { delete snap()[toKey(resolvePath(ctx.cwd, f))]; window.__debug.idbPersist?.(); },
    cp: ([s, d]) => { snap()[toKey(resolvePath(ctx.cwd, d))] = snap()[toKey(resolvePath(ctx.cwd, s))]; window.__debug.idbPersist?.(); },
    mv: ([s, d]) => {
      const src = toKey(resolvePath(ctx.cwd, s)), dst = toKey(resolvePath(ctx.cwd, d));
      snap()[dst] = snap()[src]; delete snap()[src]; window.__debug.idbPersist?.();
    },
    touch: ([f]) => { const k = toKey(resolvePath(ctx.cwd, f)); if (!(k in snap())) { snap()[k] = ''; window.__debug.idbPersist?.(); } },
    head: ([f]) => { const c = snap()[toKey(resolvePath(ctx.cwd, f))]; if (!c) throw new Error('no such file: ' + f); wl(c.split('\n').slice(0, 10).join('\r\n')); },
    tail: ([f]) => { const c = snap()[toKey(resolvePath(ctx.cwd, f))]; if (!c) throw new Error('no such file: ' + f); wl(c.split('\n').slice(-10).join('\r\n')); },
    wc: ([f]) => { const c = snap()[toKey(resolvePath(ctx.cwd, f))]; if (!c) throw new Error('no such file: ' + f); const lines = c.split('\n').length; wl(lines + ' ' + c.length + ' ' + f); },
    grep: ([pat, f]) => {
      const c = snap()[toKey(resolvePath(ctx.cwd, f))];
      if (!c) throw new Error('no such file: ' + f);
      const re = new RegExp(pat, 'g');
      wl(c.split('\n').filter(l => re.test(l)).join('\r\n') || '(no matches)');
    },
    env: () => wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n')),
    export: ([kv]) => { const [k, ...v] = (kv || '').split('='); ctx.env[k] = v.join('='); },
    clear: () => ctx.term.clear(),
    help: () => wl(Object.keys(makeBuiltins(ctx)).join('  ')),
    which: ([cmd]) => wl(makeBuiltins(ctx)[cmd] ? '(builtin) ' + cmd : 'not found: ' + cmd),
    exit: (_, actor) => {
      if (actor.getSnapshot().value === 'node-repl') { actor.send({ type: 'EXIT_REPL' }); wl('[shell]'); }
    },
    node: async (args, actor) => {
      if (!args.length) { actor.send({ type: 'ENTER_REPL' }); wl('[node repl — type exit to return]'); return; }
      if (args[0] === '-v' || args[0] === '--version') { wl('v20.0.0'); return; }
      if (args[0] === '-e' || args[0] === '--eval') { await ctx.nodeEval(args.slice(1).join(' ')); return; }
      const path = resolvePath(ctx.cwd, args[0]);
      const code = snap()[toKey(path)];
      if (code == null) throw new Error('no such file: ' + path);
      actor.send({ type: 'NODE_START' });
      await ctx.nodeEval(code, path, args.slice(1));
    },
    npm: async (args) => {
      if (args[0] !== 'install' && args[0] !== 'i') throw new Error('only npm install supported');
      let pkgs = args.slice(1);
      if (!pkgs.length) {
        const pkgJsonKey = toKey(resolvePath(ctx.cwd, 'package.json'));
        const raw = snap()[pkgJsonKey];
        if (!raw) throw new Error('no package.json in ' + ctx.cwd + ' — try: npm install <pkg>');
        const pj = JSON.parse(raw);
        pkgs = Object.keys({ ...(pj.dependencies || {}), ...(pj.peerDependencies || {}) });
        if (!pkgs.length) { wl('no dependencies to install'); return; }
        wl('installing ' + pkgs.length + ' deps from package.json: ' + pkgs.join(', '));
      }
      for (const pkg of pkgs) {
        w('fetching ' + pkg + '...\r\n');
        const url = 'https://esm.sh/' + pkg + '?bundle&target=es2022';
        await import(url);
        snap()['node_modules/' + pkg + '/index.js'] = '// async esm.sh stub\nawait import(' + JSON.stringify(url) + ');';
        window.__debug.idbPersist?.();
        wl('installed ' + pkg);
      }
    },
  };
}

const machine = createMachine({ id: 'shell', initial: 'idle', states: {
  idle: { on: { RUN: 'executing', ENTER_REPL: 'node-repl', NODE_START: 'node-running' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-running': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-repl': { on: { EXIT_REPL: 'idle', RUN: 'node-repl' } },
}});

export function createShell({ term, onPreviewWrite }) {
  const ctx = { term, cwd: '/', env: {}, history: [] };
  const BUILTINS = makeBuiltins(ctx);
  ctx.nodeEval = createNodeEnv({ ctx, term });

  const actor = createActor(machine);
  actor.start();

  let inputQueue = [];
  function drainQueue(onData) { const items = inputQueue.slice(); inputQueue = []; for (const d of items) onData(d); }

  const httpHandlers = {};
  window.__debug = window.__debug || {};

  async function runCmd(line, capture) {
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
    try { if (fn) await fn(args, actor); else out += 'command not found: ' + cmd; }
    finally { term.write = orig; }
    return out;
  }

  async function run(line, onData) {
    if (!line.trim()) return;
    const st = actor.getSnapshot().value;
    if (st === 'node-repl' && line.trim() !== 'exit') { await ctx.nodeEval(line); return; }
    if (line.trim() === 'exit') { BUILTINS.exit([], actor); return; }
    const [cmd] = line.trim().split(/\s+/);
    if (cmd !== 'npm' && cmd !== 'node') actor.send({ type: 'RUN' });
    try {
      const parts = line.split(' | ');
      if (parts.length > 1) {
        let buf = await runCmd(parts[0], true);
        for (const p of parts.slice(1)) {
          const [c, ...a] = p.trim().split(/\s+/);
          const fn = BUILTINS[c];
          if (fn) await fn([buf, ...a], actor); else term.write('command not found: ' + c + '\r\n');
          buf = '';
        }
      } else {
        await runCmd(line, false);
      }
      actor.send({ type: 'DONE' });
      drainQueue(onData);
    } catch (e) {
      term.write('\x1b[31m' + e.message + '\x1b[0m\r\n');
      actor.send({ type: 'ERROR' });
      drainQueue(onData);
    }
  }

  function getCompletions(line, word) {
    const files = Object.keys(window.__debug.idbSnapshot || {});
    const tokens = line.trim().split(/\s+/);
    if (tokens.length <= 1 && !line.includes(' ')) return Object.keys(BUILTINS).filter(c => c.startsWith(word));
    return files.filter(f => f.startsWith(word));
  }

  const rl = createReadline({ term, getCompletions, getPrompt: () => ctx.cwd, onLine: line => run(line, onData).then(() => rl.showPrompt()) });

  function onData(data) {
    if (data === '\x03') { actor.send({ type: 'ERROR' }); inputQueue = []; term.write('^C'); rl.showPrompt(); return; }
    const st = actor.getSnapshot().value;
    if (st !== 'idle' && st !== 'node-repl') { inputQueue.push(data); return; }
    rl.onData(data);
  }

  term.onData(onData);
  const runPublic = line => run(line, onData);
  rl.showPrompt();
  return {
    run: runPublic, onPreviewWrite, httpHandlers,
    get state() { return actor.getSnapshot().value; },
    get cwd() { return ctx.cwd; },
    get env() { return ctx.env; },
    get history() { return ctx.history; },
    get inputQueue() { return inputQueue.slice(); },
  };
}
