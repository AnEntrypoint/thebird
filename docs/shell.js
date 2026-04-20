import { createMachine, createActor } from './vendor/xstate.js';
import { createNodeEnv } from './shell-node.js';
import { createReadline } from './shell-readline.js';
import { makeBuiltins, resolvePath } from './shell-builtins.js';
import { makeNpm } from './shell-npm.js';
import { tokenize, expand, expandCmdSub, splitTopLevel, parsePipes, globToRe } from './shell-parser.js';
import { isControlStart, isBlockOpen, runControl } from './shell-control.js';

const machine = createMachine({ id: 'shell', initial: 'idle', states: {
  idle: { on: { RUN: 'executing', ENTER_REPL: 'node-repl', NODE_START: 'node-running' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-running': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-repl': { on: { EXIT_REPL: 'idle', RUN: 'node-repl' } },
}});

export function createShell({ term, onPreviewWrite }) {
  const ctx = { term, cwd: '/', prevCwd: '/', env: {}, history: [], lastExitCode: 0, argv: [], functions: {}, opts: {}, localStack: [], loopFlag: null };
  const actor = createActor(machine);
  actor.start();
  const httpHandlers = {};
  window.__debug = window.__debug || {};

  let inputQueue = [];
  function drainQueue(onData) { const items = inputQueue.slice(); inputQueue = []; for (const d of items) onData(d); }

  const toKey = p => p.replace(/^\//, '');
  const snap = () => window.__debug.idbSnapshot || {};

  const BUILTINS = makeBuiltins(ctx, actor, invokeBuiltin);
  ctx.builtinsRef = BUILTINS;
  ctx.expand = token => expandCmdSub(token, ctx.env, ctx.lastExitCode, captureRun, ctx.argv);
  const npmCmd = makeNpm(ctx);
  ctx.nodeEval = createNodeEnv({ ctx, term });

  function expandGlob(token) {
    if (!token.includes('*') && !token.includes('?')) return [token];
    const prefix = toKey(resolvePath(ctx.cwd, ''));
    const keys = Object.keys(snap()).map(k => prefix && k.startsWith(prefix + '/') ? k.slice(prefix.length + 1) : k);
    const re = globToRe(token);
    const matches = keys.filter(k => re.test(k));
    return matches.length ? matches.sort() : [token];
  }

  function expandTokens(tokens) {
    return tokens.flatMap(t => {
      const expanded = expandCmdSub(t, ctx.env, ctx.lastExitCode, captureRun, ctx.argv);
      return expandGlob(expanded);
    });
  }

  function captureRun(line) {
    const raw = tokenize(line); if (!raw.length) return '';
    let out = ''; const orig = term.write.bind(term); term.write = s => { out += s; };
    try { const [cmd, ...args] = parseRedirect(expandTokens(raw)).args; BUILTINS[cmd]?.(args, actor); } finally { term.write = orig; }
    return out.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  async function captureFn(fn) {
    let out = ''; const orig = term.write.bind(term); term.write = s => { out += s; };
    try { await fn(); } finally { term.write = orig; }
    return out;
  }

  async function runFunction(name, args) {
    const savedArgv = ctx.argv; ctx.argv = [name, ...args]; ctx.localStack.push({});
    try { for (const ln of ctx.functions[name].split(/;|\n/)) if (ln.trim()) await run(ln.trim()); }
    finally {
      const locals = ctx.localStack.pop();
      for (const k of Object.keys(locals)) { if (locals[k] === undefined) delete ctx.env[k]; else ctx.env[k] = locals[k]; }
      ctx.argv = savedArgv;
    }
  }

  async function invokeBuiltin(name, args, withCaptureInto, stdinBuf) {
    if (ctx.functions[name]) {
      if (!withCaptureInto) { await runFunction(name, args); return ''; }
      return captureFn(() => runFunction(name, args));
    }
    const fn = BUILTINS[name];
    if (!fn) throw new Error('command not found: ' + name);
    if (!withCaptureInto) { await fn(args, actor, stdinBuf, invokeBuiltin, run); return ''; }
    return captureFn(() => fn(args, actor, stdinBuf, invokeBuiltin, run));
  }

  function evalKV(kv) { const eq = kv.indexOf('='); return [kv.slice(0, eq), expandCmdSub(kv.slice(eq + 1), ctx.env, ctx.lastExitCode, captureRun, ctx.argv)]; }

  async function runSingleCommand(line) {
    const raw = tokenize(line); if (!raw.length) return;
    let i = 0; const varAssigns = [];
    while (i < raw.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw[i])) varAssigns.push(raw[i++]);
    const rest = raw.slice(i);
    if (!rest.length) { for (const kv of varAssigns) { const [k, v] = evalKV(kv); ctx.env[k] = v; } return; }
    const { args: [cmd, ...args], stdout: rout, append } = parseRedirect(expandTokens(rest));
    const writeOut = rout ? buf => { const k = toKey(resolvePath(ctx.cwd, rout)); snap()[k] = append ? (snap()[k] || '') + buf : buf; window.__debug.idbPersist?.(); } : null;
    const prevEnv = {}; for (const kv of varAssigns) { const [k, v] = evalKV(kv); prevEnv[k] = ctx.env[k]; ctx.env[k] = v; }
    try {
      if (cmd === 'npm') { if (writeOut) { writeOut(await captureFn(async () => { const r = await npmCmd(args); if (r?.runInShell) await run(r.runInShell); })); return; } const r = await npmCmd(args); if (r?.runInShell) await run(r.runInShell); return; }
      if (cmd === 'node') { await runNode(args); return; }
      if (cmd === 'exit') { BUILTINS.exit([], actor); return; }
      if (writeOut) { writeOut(await invokeBuiltin(cmd, args, true)); return; }
      await invokeBuiltin(cmd, args, false);
    } finally { for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete ctx.env[k]; else ctx.env[k] = prevEnv[k]; } }
  }

  function parseRedirect(tokens) {
    const out = { args: [], stdout: null, append: false };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '>' || t === '>>') { out.stdout = tokens[++i]; out.append = t === '>>'; } else out.args.push(t);
    }
    return out;
  }

  async function runNode(args) {
    if (!args.length) { actor.send({ type: 'ENTER_REPL' }); term.write('[node repl — type exit to return]\r\n'); return; }
    if (args[0] === '-v' || args[0] === '--version') { term.write('v20.0.0\r\n'); return; }
    if (args[0] === '-e' || args[0] === '--eval') { await ctx.nodeEval(args.slice(1).join(' ')); return; }
    if (args[0] === '-p' || args[0] === '--print') { await ctx.nodeEval('console.log(' + args.slice(1).join(' ') + ')'); return; }
    const code = snap()[toKey(resolvePath(ctx.cwd, args[0]))];
    if (code == null) throw new Error('node: no such file: ' + args[0]);
    actor.send({ type: 'NODE_START' }); ctx.argv = args;
    try { await ctx.nodeEval(code, args[0], args.slice(1)); } finally { ctx.argv = []; }
  }

  async function runPipeline(line) {
    const pipes = parsePipes(line);
    if (pipes.length === 1) { await runSingleCommand(pipes[0]); return; }
    let buf = '';
    for (let i = 0; i < pipes.length; i++) {
      const isLast = i === pipes.length - 1;
      const { args: [cmd, ...args], stdout: rout, append } = parseRedirect(expandTokens(tokenize(pipes[i])));
      const sArgs = i === 0 ? args : (buf ? [buf, ...args] : args);
      if (isLast && !rout) { await invokeBuiltin(cmd, sArgs, false, buf); buf = ''; continue; }
      const out = await invokeBuiltin(cmd, sArgs, true, buf);
      if (rout) { const k = toKey(resolvePath(ctx.cwd, rout)); snap()[k] = append ? (snap()[k] || '') + out : out; window.__debug.idbPersist?.(); buf = ''; } else { buf = out; }
    }
  }

  let blockLines = [];

  async function run(line, onData) {
    if (!line.trim()) return;
    ctx.history.push(line);
    const st = actor.getSnapshot().value;
    if (st === 'node-repl' && line.trim() !== 'exit') { await ctx.nodeEval(line); return; }
    if (ctx.opts.xtrace) term.write('\x1b[90m+ ' + line + '\x1b[0m\r\n');
    const chain = splitTopLevel(line, ['&&', '||', ';']);
    let lastOk = true;
    for (const { cmd, sep } of chain) {
      if (ctx.loopFlag) break;
      if (sep === '&&' && !lastOk) continue;
      if (sep === '||' && lastOk) { lastOk = true; continue; }
      actor.send({ type: 'RUN' });
      try { ctx.lastExitCode = 0; await runPipeline(cmd); lastOk = ctx.lastExitCode === 0; actor.send({ type: 'DONE' }); }
      catch (e) { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); ctx.lastExitCode = 1; lastOk = false; actor.send({ type: 'ERROR' }); }
      if (ctx.opts.errexit && !lastOk) break;
    }
    if (onData) drainQueue(onData);
  }

  const getCompletions = (line, word) => (line.trim().split(/\s+/).length <= 1 && !line.includes(' '))
    ? Object.keys(BUILTINS).concat(['npm', 'node']).filter(c => c.startsWith(word))
    : Object.keys(snap()).filter(f => f.startsWith(word));

  const handleLine = line => {
    if (blockLines.length > 0 || isControlStart(line)) {
      blockLines.push(line);
      if (isBlockOpen(blockLines)) { rl.showContinuation(); return; }
      const block = blockLines.slice(); blockLines = [];
      runControl(block, run, ctx).then(() => rl.showPrompt()).catch(e => { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); rl.showPrompt(); });
      return;
    }
    run(line, onData).then(() => rl.showPrompt());
  };
  const rl = createReadline({ term, getCompletions, getPrompt: () => ctx.cwd, isBlockOpen: () => blockLines.length > 0, onLine: handleLine });
  function onData(data) {
    if (data === '\x03') { actor.send({ type: 'ERROR' }); inputQueue = []; blockLines = []; term.write('^C'); rl.showPrompt(); return; }
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
