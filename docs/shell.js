import { createMachine, createActor } from './vendor/xstate.js';
import { createNodeEnv } from './shell-node.js';
import { createReadline } from './shell-readline.js';
import { makeBuiltins, resolvePath } from './shell-builtins.js';
import { makeNpm } from './shell-npm.js';
import { tokenize, expand, splitTopLevel, parsePipes } from './shell-parser.js';

const machine = createMachine({ id: 'shell', initial: 'idle', states: {
  idle: { on: { RUN: 'executing', ENTER_REPL: 'node-repl', NODE_START: 'node-running' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-running': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-repl': { on: { EXIT_REPL: 'idle', RUN: 'node-repl' } },
}});

export function createShell({ term, onPreviewWrite }) {
  const ctx = { term, cwd: '/', prevCwd: '/', env: {}, history: [], lastExitCode: 0 };
  const actor = createActor(machine);
  actor.start();
  const BUILTINS = makeBuiltins(ctx, actor);
  const npmCmd = makeNpm(ctx);
  ctx.nodeEval = createNodeEnv({ ctx, term });
  const httpHandlers = {};
  window.__debug = window.__debug || {};

  let inputQueue = [];
  function drainQueue(onData) { const items = inputQueue.slice(); inputQueue = []; for (const d of items) onData(d); }

  function toKey(p) { return p.replace(/^\//, ''); }
  const snap = () => window.__debug.idbSnapshot || {};

  async function invokeBuiltin(name, args, withCaptureInto) {
    const fn = BUILTINS[name];
    if (!fn) throw new Error('command not found: ' + name);
    if (!withCaptureInto) { await fn(args, actor); return ''; }
    let out = '';
    const orig = term.write.bind(term);
    term.write = s => { out += s; };
    try { await fn(args, actor); } finally { term.write = orig; }
    return out;
  }

  async function runSingleCommand(line) {
    const raw = tokenize(line);
    if (!raw.length) return;
    const expanded = raw.map(t => expand(t, ctx.env));
    const redir = parseRedirect(expanded);
    const [cmd, ...args] = redir.args;
    const writeOut = redir.stdout ? buf => { const k = toKey(resolvePath(ctx.cwd, redir.stdout)); snap()[k] = redir.append ? (snap()[k] || '') + buf : buf; window.__debug.idbPersist?.(); } : null;
    if (cmd === 'npm') {
      const capturing = !!writeOut;
      let out = '';
      if (capturing) { const orig = term.write.bind(term); term.write = s => { out += s; }; try { const result = await npmCmd(args); if (result?.runInShell) await run(result.runInShell); } finally { term.write = orig; } writeOut(out); return; }
      const result = await npmCmd(args);
      if (result?.runInShell) await run(result.runInShell);
      return;
    }
    if (cmd === 'node') { await runNode(args); return; }
    if (cmd === 'exit') { BUILTINS.exit([], actor); return; }
    if (writeOut) { const out = await invokeBuiltin(cmd, args, true); writeOut(out); return; }
    await invokeBuiltin(cmd, args, false);
  }

  function parseRedirect(tokens) {
    const out = { args: [], stdout: null, append: false };
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '>' || tokens[i] === '>>') { out.stdout = tokens[++i]; out.append = tokens[i - 1] === '>>'; continue; }
      out.args.push(tokens[i]);
    }
    return out;
  }

  async function runNode(args) {
    if (!args.length) { actor.send({ type: 'ENTER_REPL' }); term.write('[node repl — type exit to return]\r\n'); return; }
    if (args[0] === '-v' || args[0] === '--version') { term.write('v20.0.0\r\n'); return; }
    if (args[0] === '-e' || args[0] === '--eval') { await ctx.nodeEval(args.slice(1).join(' ')); return; }
    if (args[0] === '-p' || args[0] === '--print') { const r = await ctx.nodeEval('console.log(' + args.slice(1).join(' ') + ')'); return r; }
    const path = resolvePath(ctx.cwd, args[0]);
    const code = snap()[toKey(path)];
    if (code == null) throw new Error('node: no such file: ' + args[0]);
    actor.send({ type: 'NODE_START' });
    await ctx.nodeEval(code, path, args.slice(1));
  }

  async function runPipeline(line) {
    const pipes = parsePipes(line);
    if (pipes.length === 1) { await runSingleCommand(pipes[0]); return; }
    let buf = '';
    for (let i = 0; i < pipes.length; i++) {
      const isLast = i === pipes.length - 1;
      const raw = tokenize(pipes[i]);
      const expanded = raw.map(t => expand(t, ctx.env));
      const redir = parseRedirect(expanded);
      const [cmd, ...args] = redir.args;
      const effectiveArgs = i === 0 ? args : [buf, ...args];
      if (isLast && !redir.stdout) { await invokeBuiltin(cmd, effectiveArgs, false); buf = ''; continue; }
      const out = await invokeBuiltin(cmd, effectiveArgs, true);
      if (redir.stdout) { const k = toKey(resolvePath(ctx.cwd, redir.stdout)); snap()[k] = redir.append ? (snap()[k] || '') + out : out; window.__debug.idbPersist?.(); buf = ''; } else { buf = out; }
    }
  }

  async function run(line, onData) {
    if (!line.trim()) return;
    ctx.history.push(line);
    const st = actor.getSnapshot().value;
    if (st === 'node-repl' && line.trim() !== 'exit') { await ctx.nodeEval(line); return; }
    const chain = splitTopLevel(line, ['&&', '||', ';']);
    let lastOk = true;
    for (const { cmd, sep } of chain) {
      if (sep === '&&' && !lastOk) continue;
      if (sep === '||' && lastOk) { lastOk = true; continue; }
      actor.send({ type: 'RUN' });
      try { await runPipeline(cmd); ctx.lastExitCode = 0; lastOk = true; actor.send({ type: 'DONE' }); }
      catch (e) { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); ctx.lastExitCode = 1; lastOk = false; actor.send({ type: 'ERROR' }); }
    }
    drainQueue(onData);
  }

  function getCompletions(line, word) {
    const tokens = line.trim().split(/\s+/);
    const files = Object.keys(snap());
    if (tokens.length <= 1 && !line.includes(' ')) return Object.keys(BUILTINS).concat(['npm', 'node']).filter(c => c.startsWith(word));
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
  rl.showPrompt();
  return {
    run: line => run(line, onData), onPreviewWrite, httpHandlers,
    get state() { return actor.getSnapshot().value; },
    get cwd() { return ctx.cwd; },
    get env() { return ctx.env; },
    get history() { return ctx.history; },
    get lastExitCode() { return ctx.lastExitCode; },
    get inputQueue() { return inputQueue.slice(); },
  };
}
