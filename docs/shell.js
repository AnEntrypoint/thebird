import { createMachine, createActor } from './vendor/xstate.js';
import { createNodeEnv } from './shell-node.js';
import { createReadline } from './shell-readline.js';
import { makeBuiltins, resolvePath } from './shell-builtins.js';
import { makeNpm, makeNpx } from './shell-npm.js';
import { makePmDispatcher, makeCorepackStub, detectPm } from './shell-pm.js';
import { makeDlx } from './shell-pm-layout.js';
import { tokenize, splitTopLevel, parsePipes } from './shell-parser.js';
import { fullExpand } from './shell-expand.js';
import { isControlStart, isBlockOpen, runControl, runScript } from './shell-control.js';
import { createSignals, makeKillBuiltin, makeTrapBuiltin } from './shell-signals.js';
import { createJobRegistry, makeJobsBuiltin, makeFgBuiltin, makeBgBuiltin, makeDisownBuiltin } from './shell-jobs.js';
import { createFdTable, makeExecBuiltin } from './shell-fd.js';
import { readStream } from './shell-procsub.js';
import { makeExpander, makeCaptureRun, makeNodeRunner, makeNpmResultRunner } from './shell-exec.js';
import { createSwJobs, makeNohupBuiltin, makeNetcatStub, makeCurlBuiltin } from './shell-sw-jobs.js';
import { makeGitBuiltin } from './shell-git.js';

const machine = createMachine({ id: 'shell', initial: 'idle', states: {
  idle: { on: { RUN: 'executing', ENTER_REPL: 'node-repl', NODE_START: 'node-running' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-running': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-repl': { on: { EXIT_REPL: 'idle', RUN: 'node-repl' } },
}});

export function createShell({ term, onPreviewWrite }) {
  const ctx = { term, cwd: '/', prevCwd: '/', env: {}, history: [], lastExitCode: 0, argv: [], functions: {}, opts: {}, localStack: [], loopFlag: null, arrays: {}, bgJobs: {}, traps: {} };
  const actor = createActor(machine);
  actor.start();
  const httpHandlers = {};
  window.__debug = window.__debug || {};

  let inputQueue = [];
  function drainQueue(onData) { const items = inputQueue.slice(); inputQueue = []; for (const d of items) onData(d); }

  const toKey = p => p.replace(/^\//, '');
  const snap = () => window.__debug.idbSnapshot || {};

  let expandTokens, captureRun;
  const BUILTINS = makeBuiltins(ctx, actor, invokeBuiltin);
  ctx.builtinsRef = BUILTINS;
  const _exp = makeExpander(ctx, l => captureRun(l), t => parseRedirect(t));
  expandTokens = _exp.expandTokens;
  captureRun = makeCaptureRun(ctx, BUILTINS, actor, t => parseRedirect(t), t => expandTokens(t));
  ctx.signals = createSignals(ctx);
  ctx.fdTable = createFdTable(ctx);
  ctx.swJobs = createSwJobs();
  const jobRegistry = createJobRegistry(ctx);
  ctx.jobRegistry = jobRegistry;
  ctx.runPipeline = line => runPipeline(line);
  Object.assign(BUILTINS, { kill: makeKillBuiltin(ctx), trap: makeTrapBuiltin(ctx), jobs: makeJobsBuiltin(ctx, jobRegistry), fg: makeFgBuiltin(ctx, jobRegistry), bg: makeBgBuiltin(ctx, jobRegistry), disown: makeDisownBuiltin(ctx), exec: makeExecBuiltin(ctx, ctx.fdTable), nohup: makeNohupBuiltin(ctx), nc: makeNetcatStub(ctx), curl: makeCurlBuiltin(ctx) });
  ctx.runScript = text => runScript(text, run, ctx);
  ctx.expand = token => fullExpand(token, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays);
  const npmCmd = makeNpm(ctx); const npxCmd = makeNpx(npmCmd); ctx.exec = line => run(line);
  const pmDispatch = makePmDispatcher(term, null, () => window.__debug.idbPersist?.(), ctx); const corepackCmd = makeCorepackStub(term); const dlxCmd = makeDlx(term, null, ctx, run);
  ctx.nodeEval = createNodeEnv({ ctx, term });
  const gitCmd = makeGitBuiltin(ctx);
  const runNode = makeNodeRunner(ctx, actor);
  const runNpmResult = makeNpmResultRunner(ctx, line => run(line));

  async function captureFn(fn) {
    let out = ''; const orig = term.write.bind(term); term.write = s => { out += s; };
    try { await fn(); } finally { term.write = orig; }
    return out;
  }

  async function runFunction(name, args) {
    const savedArgv = ctx.argv; ctx.argv = [name, ...args]; ctx.localStack.push({});
    try { await runScript(ctx.functions[name], run, ctx); }
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

  function evalKV(kv) { const eq = kv.indexOf('='); return [kv.slice(0, eq), fullExpand(kv.slice(eq + 1), ctx.env, ctx.lastExitCode, ctx.argv, captureRun)]; }

  async function runSingleCommand(line) {
    const arrM = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=\((.*)\)\s*$/);
    if (arrM) { (ctx.arrays = ctx.arrays || {})[arrM[1]] = tokenize(arrM[2]).map(t => fullExpand(t, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays)); return; }
    const idxM = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\[([^\]]+)\]=(.*)$/);
    if (idxM) { ctx.arrays = ctx.arrays || {}; if (!ctx.arrays[idxM[1]]) ctx.arrays[idxM[1]] = {}; const a = ctx.arrays[idxM[1]], ex = t => fullExpand(t, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays), k = ex(idxM[2]), v = ex(idxM[3]); if (Array.isArray(a)) a[parseInt(k, 10)] = v; else a[k] = v; return; }
    const raw = tokenize(line); if (!raw.length) return;
    let i = 0; const varAssigns = [];
    while (i < raw.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw[i])) varAssigns.push(raw[i++]);
    const rest = raw.slice(i);
    if (!rest.length) { for (const kv of varAssigns) { const [k, v] = evalKV(kv); ctx.env[k] = v; } return; }
    const { args: [cmd, ...args], stdout: rout, append } = parseRedirect(expandTokens(rest));
    const writeOut = rout ? buf => { const k = toKey(resolvePath(ctx.cwd, rout)); snap()[k] = append ? (snap()[k] || '') + buf : buf; window.__debug.idbPersist?.(); } : null;
    const prevEnv = {}; for (const kv of varAssigns) { const [k, v] = evalKV(kv); prevEnv[k] = ctx.env[k]; ctx.env[k] = v; }
    try {
      if (cmd === 'npm') { if (writeOut) { writeOut(await captureFn(async () => { await runNpmResult(await npmCmd(args)); })); return; } await runNpmResult(await npmCmd(args)); return; }
      if (cmd === 'npx') { await runNpmResult(await npxCmd(args)); return; }
      if (cmd === 'pnpm' || cmd === 'yarn' || cmd === 'bun') { ctx.lastExitCode = args[0] === 'dlx' || args[0] === 'x' ? await dlxCmd(args.slice(1)) : await pmDispatch(cmd, args[0] || 'install', args.slice(1)); return; }
      if (cmd === 'deno') { if (args[0] === 'run') { await runNode(args.slice(1)); return; } ctx.lastExitCode = await pmDispatch('deno', args[0] || 'task', args.slice(1)); return; }
      if (cmd === 'corepack') { ctx.lastExitCode = await corepackCmd(args); return; }
      if (cmd === 'node') { await runNode(args); return; }
      if (cmd === 'git') { await gitCmd(args); return; }
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

  async function runPipeline(line) {
    const pipes = parsePipes(line);
    if (pipes.length === 1) { await runSingleCommand(pipes[0]); return; }
    let buf = '';
    for (let i = 0; i < pipes.length; i++) {
      const isLast = i === pipes.length - 1;
      const { args: [cmd, ...args], stdout: rout, append } = parseRedirect(expandTokens(tokenize(pipes[i])));
      const sArgs = i === 0 ? args : (buf && cmd !== 'node' ? [buf, ...args] : args);
      const stdinForStage = cmd === 'node' ? buf : buf;
      if (isLast && !rout) {
        if (cmd === 'node') { await runNode(args, stdinForStage); buf = ''; continue; }
        await invokeBuiltin(cmd, sArgs, false, stdinForStage); buf = ''; continue;
      }
      const out = cmd === 'node' ? await captureFn(() => runNode(args, stdinForStage)) : await invokeBuiltin(cmd, sArgs, true, stdinForStage);
      if (rout) { const k = toKey(resolvePath(ctx.cwd, rout)); snap()[k] = append ? (snap()[k] || '') + out : out; window.__debug.idbPersist?.(); buf = ''; } else { buf = out; }
    }
  }

  let blockLines = [];

  async function run(line, onData) {
    if (!line.trim()) return;
    ctx.history.push(line);
    const st = actor.getSnapshot().value;
    if (st === 'node-repl') {
      const t = line.trim();
      if (t === 'exit' || t === '.exit' || t === '.quit') { actor.send({ type: 'EXIT_REPL' }); return; }
      if (t === '.help') { term.write('.exit    Exit the REPL\r\n.help    Show this list\r\n.clear   Break out of current expression\r\n'); return; }
      if (t === '.clear') return;
      const exprCode = 'try { const __r = (' + line + '); if (__r !== undefined) console.log(require("util").inspect(__r)); } catch (__e1) { try {\n' + line + '\n} catch (__e2) { console.error(__e2.message); } }';
      await ctx.nodeEval(exprCode); return;
    }
    if (ctx.opts.xtrace) term.write('\x1b[90m+ ' + line + '\x1b[0m\r\n');
    const chain = splitTopLevel(line, ['&&', '||', ';', '&']);
    let lastOk = true;
    for (const { cmd, sep } of chain) {
      if (ctx.loopFlag) break;
      if (sep === '&&' && !lastOk) continue;
      if (sep === '||' && lastOk) { lastOk = true; continue; }
      if (sep === '&') { const id = jobRegistry.spawnJob(cmd, runPipeline); ctx.env['!'] = id; term.write('[' + id + '] spawned\r\n'); continue; }
      actor.send({ type: 'RUN' });
      try { ctx.lastExitCode = 0; await runPipeline(cmd); lastOk = ctx.lastExitCode === 0; actor.send({ type: 'DONE' }); }
      catch (e) { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); ctx.lastExitCode = 1; lastOk = false; actor.send({ type: 'ERROR' }); }
      if (ctx.opts.errexit && !lastOk) break;
      if (ctx.signals) await ctx.signals.check(l => run(l));
    }
    if (onData) drainQueue(onData);
  }

  const getCompletions = (line, word) => (line.trim().split(/\s+/).length <= 1 && !line.includes(' ')) ? Object.keys(BUILTINS).concat(['npm', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'npx', 'corepack', 'git']).filter(c => c.startsWith(word)) : Object.keys(snap()).filter(f => f.startsWith(word));

  const handleLine = line => {
    if (blockLines.length > 0 || isControlStart(line)) {
      blockLines.push(line); if (isBlockOpen(blockLines)) { rl.showContinuation(); return; }
      const block = blockLines.slice(); blockLines = [];
      runControl(block, run, ctx).then(() => rl.showPrompt()).catch(e => { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); rl.showPrompt(); });
      return;
    }
    run(line, onData).then(() => rl.showPrompt());
  };
  const rl = createReadline({ term, getCompletions, getPrompt: () => actor.getSnapshot().value === 'node-repl' ? '> ' : ctx.cwd, isBlockOpen: () => blockLines.length > 0, onLine: handleLine });
  function onData(data) {
    if (data === '\x03') { actor.send({ type: 'ERROR' }); inputQueue = []; blockLines = []; term.write('^C'); rl.showPrompt(); return; }
    const st = actor.getSnapshot().value;
    if (st !== 'idle' && st !== 'node-repl') inputQueue.push(data); else rl.onData(data);
  }
  term.onData(onData);
  rl.showPrompt();
  return {
    run: line => run(line, onData), onPreviewWrite, httpHandlers, procsubRead: id => readStream(id), fdRead: fd => ctx.fdTable.readFd(fd),
    get state() { return actor.getSnapshot().value; }, get cwd() { return ctx.cwd; }, get env() { return ctx.env; }, get history() { return ctx.history; },
    get lastExitCode() { return ctx.lastExitCode; }, get inputQueue() { return inputQueue.slice(); },
  };
}
