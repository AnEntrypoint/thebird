import { createMachine, createActor } from './vendor/xstate.js';
import { createReadline } from './shell-readline.js';
import { allBuiltinNames } from './builtins-manifest.js';
import { makeBuiltins, resolvePath } from './shell-builtins.js';
import { makeNpm, makeNpx } from './shell-npm.js';
import { makePmDispatcher, makeCorepackStub, detectPm } from './shell-pm.js';
import { makeDlx } from './shell-pm-layout.js';
import { tokenize, splitTopLevel, parsePipes, parseRedirects } from './shell-parser.js';
import { fullExpand } from './shell-expand.js';
import { isControlStart, isBlockOpen, runControl, runScript } from './shell-control.js';
import { createSignals, makeKillBuiltin, makeTrapBuiltin } from './shell-signals.js';
import { createJobRegistry, makeJobsBuiltin, makeFgBuiltin, makeBgBuiltin, makeDisownBuiltin } from './shell-jobs.js';
import { createFdTable, makeExecBuiltin } from './shell-fd.js';
import { readStream } from './shell-procsub.js';
import { makeExpander, makeCaptureRun, makeNodeRunner, makeNpmResultRunner } from './shell-exec.js';
import { createSwJobs, makeNohupBuiltin, makeNetcatStub, makeCurlBuiltin } from './shell-sw-jobs.js';
import { makeGitBuiltin } from './shell-git.js';
import { DEFAULT_CWD } from './shell-defaults.js';
import { createAuditLog, installFetchAudit, parseNetAuditLine } from './audit.js';
import { shortUid } from './vendor/uid.js';

// Memory-safety bound on inter-stage pipe buffers. A runaway producer
// (e.g. `yes | head -1`) would otherwise allocate unbounded output before a
// downstream consumer can short-circuit. Output past this is truncated.
const MAX_PIPE_BUFFER = 10 * 1024 * 1024;

const machine = createMachine({ id: 'shell', initial: 'idle', states: {
  idle: { on: { RUN: 'executing', ENTER_REPL: 'node-repl', NODE_START: 'node-running' } },
  executing: { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-running': { on: { DONE: 'idle', ERROR: 'idle' } },
  'node-repl': { on: { EXIT_REPL: 'idle', RUN: 'node-repl' } },
}});

export function createShell({ term, onPreviewWrite, instanceId, fs } = {}) {
  // Per-shell procsub namespace: scopes <(cmd) streams to this shell so another
  // instance on the same page cannot read them out of the global streams Map.
  const procsubNs = 'ps-' + (instanceId || '') + '-' + shortUid(8);
  const ctx = { term, cwd: DEFAULT_CWD, prevCwd: DEFAULT_CWD, env: {}, history: [], lastExitCode: 0, argv: [], functions: {}, opts: {}, localStack: [], loopFlag: null, arrays: {}, bgJobs: {}, traps: {}, procsubNs, optind: 1, pipeTruncated: false };
  // Proof-of-integration site for docs/audit.js: every top-level command run
  // through this shell's `run()` gets a process.spawn/process.exit pair.
  // Only wired when a real per-instance fs is supplied (fs is optional for
  // some ad-hoc/test shell instantiations).
  const auditLog = fs ? createAuditLog({ fs }) : null;
  // curl's one real outbound-fetch call site is audited explicitly (see
  // shell-sw-jobs.js's makeCurlBuiltin) -- window.fetch itself is never
  // globally monkey-patched.
  ctx.fetchAudit = auditLog ? installFetchAudit(window, auditLog).fetch : null;
  // In-band marker contract: a node-runtime worker (docs/shell-node-runtime.js's
  // Worker shim, backed by WebContainer stdout when present) may emit
  // "__NET_AUDIT__:{json}\n" lines on the SAME output stream as normal command
  // output to smuggle network-audit events across the worker boundary without
  // a dedicated message-channel event type. term.write is the single funnel
  // every builtin/runner writes through (see shell.js's own captureFn swap
  // above for precedent), so wrapping it here strips marker lines from what
  // xterm renders and routes their parsed payload into auditLog instead of
  // requiring every call site to know about the marker.
  if (auditLog) {
    const nativeWrite = term.write.bind(term);
    let markerCarry = '';
    term.write = chunk => {
      const text = markerCarry + String(chunk);
      const lines = text.split(/\r?\n/);
      // Last element is a partial line (no trailing newline yet); hold it
      // back until more data arrives so a marker split across two writes
      // isn't missed.
      markerCarry = lines.pop() || '';
      let visible = '';
      for (const line of lines) {
        const payload = parseNetAuditLine(line);
        if (payload) {
          const event = payload.event === auditLog.AuditEvent.NET_RESPONSE ? auditLog.AuditEvent.NET_RESPONSE : auditLog.AuditEvent.NET_REQUEST;
          auditLog.log(event, 'agent', payload);
        } else {
          visible += line + '\r\n';
        }
      }
      // Flush a non-marker partial tail immediately (it may be a prompt with
      // no newline); only a marker-shaped partial line is held for the next
      // chunk since NET_AUDIT_MARKER lines always end in \n when emitted.
      if (markerCarry && !markerCarry.startsWith('__NET_AUDIT__:')) { visible += markerCarry; markerCarry = ''; }
      if (visible) nativeWrite(visible);
    };
  }
  const actor = createActor(machine);
  actor.start();
  const httpHandlers = {};
  if (!window.__debug) window.__debug = {};

  let inputQueue = [];
  function drainQueue(onData) { const items = inputQueue.slice(); inputQueue = []; for (const d of items) onData(d); }

  const toKey = p => p.replace(/^\//, '');
  // Filesystem snapshot is instance-scoped: each shell reads/writes its OWN
  // instance fs, never the shared global window.__debug.idbSnapshot (which is
  // reassigned per-terminal and would otherwise let one instance's writes
  // pollute another's). Falls back to the global only when no fs is supplied.
  const snap = () => (fs ? fs.snapshot : window.__debug.idbSnapshot) || {};
  const persist = () => (fs ? fs.flush?.() : window.__debug.idbPersist?.());

  let expandTokens, captureRun;
  const BUILTINS = makeBuiltins(ctx, actor, invokeBuiltin);
  ctx.builtinsRef = BUILTINS;
  const _exp = makeExpander(ctx, l => captureRun(l), t => parseRedirects(t), snap);
  expandTokens = _exp.expandTokens;
  captureRun = makeCaptureRun(ctx, BUILTINS, actor, t => parseRedirects(t), t => expandTokens(t));
  ctx.signals = createSignals(ctx);
  ctx.fdTable = createFdTable(ctx, snap, persist);
  ctx.swJobs = createSwJobs();
  const jobRegistry = createJobRegistry(ctx);
  ctx.jobRegistry = jobRegistry;
  ctx.runPipeline = line => runPipeline(line);
  Object.assign(BUILTINS, { kill: makeKillBuiltin(ctx), trap: makeTrapBuiltin(ctx), jobs: makeJobsBuiltin(ctx, jobRegistry), fg: makeFgBuiltin(ctx, jobRegistry), bg: makeBgBuiltin(ctx, jobRegistry), disown: makeDisownBuiltin(ctx), exec: makeExecBuiltin(ctx, ctx.fdTable), nohup: makeNohupBuiltin(ctx), nc: makeNetcatStub(ctx), curl: makeCurlBuiltin(ctx) });
  ctx.runScript = text => runScript(text, run, ctx);
  ctx.expand = token => fullExpand(token, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays, ctx.opts.nounset);
  // shell-npm.js reads per-instance npm native-dep stub overrides
  // (cfg.npmOverrides, populated from a template's `overrides` field via
  // docs/lib/templates.js applyTemplate) off ctx.fs -- exposed here since ctx
  // itself has no fs reference otherwise (shell.js keeps fs in its own
  // snap/persist closures, not on ctx).
  ctx.fs = fs;
  // Builtins (cat/echo/tee/etc, in shell-builtins*.js) call previewWrite() after
  // a write so a live-preview surface can react; expose the real injected
  // callback via ctx instead of the callers reaching for the shared
  // window.__debug.shell global (which never actually carried this hook).
  ctx.onPreviewWrite = onPreviewWrite;
  // Same instance-scoped exposure for the Express/http createServer route
  // table this terminal's `httpHandlers` object (below, and returned on the
  // public API) backs -- shell-node-modules.js's app.listen()/server.listen()
  // write into it via ctx.httpHandlers rather than window.__debug.shell (the
  // desktop os-shell.js's own unrelated API object, not this createShell()
  // instance).
  ctx.httpHandlers = httpHandlers;
  const npmCmd = makeNpm(ctx); const npxCmd = makeNpx(npmCmd); ctx.exec = line => run(line);
  const pmDispatch = makePmDispatcher(term, null, () => persist(), ctx); const corepackCmd = makeCorepackStub(term); const dlxCmd = makeDlx(term, null, ctx, run);
  // shell-node.js is a single 'node'-command emulation surface that itself
  // statically imports ~30 shell-node-*.js modules (crypto/tar/cluster/dns/
  // brotli/inspector/profiler/opfs/...). Loading it unconditionally at shell
  // boot (as before) paid for all ~30 regardless of whether a session ever
  // ran `node`/`npx`/`npm run` -- see t4-builtins-manifest. Deferred to first
  // actual use; every call site below already `await`s ctx.nodeEval(...).
  let _nodeEnvPromise = null;
  ctx.nodeEval = async (...nodeEvalArgs) => {
    if (!_nodeEnvPromise) {
      _nodeEnvPromise = import('./shell-node.js').then(({ createNodeEnv }) => createNodeEnv({ ctx, term }));
    }
    const nodeEval = await _nodeEnvPromise;
    return nodeEval(...nodeEvalArgs);
  };
  // shell-python-pyodide.js also backs the lazy 'py' builtins group (python/
  // python3/pip/pip3 -- see docs/builtins-manifest.js); a static top-of-file
  // import here for createPyEnv would force-load it on every shell boot
  // regardless, defeating that laziness. The browser module registry dedupes
  // import() by specifier, so this and shell-builtins.js's lazy 'py' group
  // loader share the same module instance without a second fetch.
  let _pyEnvPromise = null;
  ctx.pyEval = async (...pyEvalArgs) => {
    if (!_pyEnvPromise) {
      _pyEnvPromise = import('./shell-python-pyodide.js').then(({ createPyEnv }) => createPyEnv({ ctx, term }));
    }
    const pyEval = await _pyEnvPromise;
    return pyEval(...pyEvalArgs);
  };
  const gitCmd = makeGitBuiltin(ctx);
  const runNode = makeNodeRunner(ctx, actor, snap);
  const runNpmResult = makeNpmResultRunner(ctx, line => run(line));

  async function captureFn(fn) {
    let out = ''; const orig = term.write.bind(term); term.write = s => { out += s; };
    try { await fn(); } finally { term.write = orig; }
    return out;
  }

  async function runFunction(name, args) {
    // getopts' optind is positional parse state over $@. A function gets a fresh
    // $@, so it must get a fresh optind too — and restore the caller's on return,
    // mirroring how argv is saved/restored. Without this, getopts inside a function
    // corrupted the caller's parse position.
    const savedArgv = ctx.argv; const savedOptind = ctx.optind;
    ctx.argv = [name, ...args]; ctx.optind = 1; ctx.localStack.push({});
    try { await runScript(ctx.functions[name], run, ctx); }
    finally {
      const locals = ctx.localStack.pop();
      for (const k of Object.keys(locals)) { if (locals[k] === undefined) delete ctx.env[k]; else ctx.env[k] = locals[k]; }
      ctx.argv = savedArgv;
      ctx.optind = savedOptind;
    }
  }

  async function invokeBuiltin(name, args, withCaptureInto, stdinBuf) {
    if (ctx.functions[name]) {
      if (!withCaptureInto) { await runFunction(name, args); return ''; }
      return captureFn(() => runFunction(name, args));
    }
    // BUILTINS starts populated with only the core commands (shell-builtins.js)
    // plus whatever runners were Object.assign'd in above (kill/jobs/exec/...).
    // A miss here means the command belongs to a still-unloaded lazy group
    // (shell-builtins-{text,extra,util,fs,system}.js / shell-python-pyodide.js) --
    // BUILTINS.resolveLazy dynamically imports that group, merges its
    // commands into BUILTINS (so later lookups are direct), and returns the fn.
    let fn = BUILTINS[name];
    if (!fn && BUILTINS.resolveLazy) fn = await BUILTINS.resolveLazy(name);
    if (!fn) throw new Error('command not found: ' + name);
    if (!withCaptureInto) { await fn(args, actor, stdinBuf, invokeBuiltin, run); return ''; }
    return captureFn(() => fn(args, actor, stdinBuf, invokeBuiltin, run));
  }

  function evalKV(kv) { const eq = kv.indexOf('='); return [kv.slice(0, eq), fullExpand(kv.slice(eq + 1), ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays, ctx.opts.nounset)]; }

  async function runSingleCommand(line) {
    const arrM = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=\((.*)\)\s*$/);
    if (arrM) { ctx.arrays[arrM[1]] = tokenize(arrM[2]).map(t => fullExpand(t, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays, ctx.opts.nounset)); ctx.lastExitCode = 0; return; }
    const idxM = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\[([^\]]+)\]=(.*)$/);
    if (idxM) { if (!Array.isArray(ctx.arrays[idxM[1]])) ctx.arrays[idxM[1]] = []; const a = ctx.arrays[idxM[1]], ex = t => fullExpand(t, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays, ctx.opts.nounset), k = ex(idxM[2]), v = ex(idxM[3]); a[parseInt(k, 10)] = v; ctx.lastExitCode = 0; return; }
    const raw = tokenize(line); if (!raw.length) return;
    let i = 0; const varAssigns = [];
    while (i < raw.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw[i])) varAssigns.push(raw[i++]);
    const rest = raw.slice(i);
    // Bare assignment lines yield exit 0 per POSIX (previously covered by a
    // pre-pipeline reset in run() that also clobbered `$?` for every command).
    if (!rest.length) { for (const kv of varAssigns) { const [k, v] = evalKV(kv); ctx.env[k] = v; } ctx.lastExitCode = 0; return; }
    const expanded = expandTokens(rest);
    if (expanded.length && ctx.aliases?.[expanded[0]]) {
      const aliasTokens = tokenize(ctx.aliases[expanded[0]]);
      expanded.splice(0, 1, ...aliasTokens);
    }
    const { args: [cmd, ...args], stdout: rout, stdoutAppend, stdin: fin } = parseRedirects(expanded);
    const writeOut = rout ? buf => {
      const k = toKey(resolvePath(ctx.cwd, rout));
      const s = snap();
      let next = stdoutAppend ? (s[k] || '') + buf : buf;
      if (next.length > MAX_PIPE_BUFFER) {
        term.write('\x1b[33m[redirect truncated: data exceeds ' + (MAX_PIPE_BUFFER / 1024 / 1024) + 'MB]\x1b[0m\r\n');
        next = next.slice(0, MAX_PIPE_BUFFER);
        ctx.lastExitCode = 1;
      }
      s[k] = next; persist();
    } : null;
    const stdinBuf = fin != null ? (snap()[toKey(resolvePath(ctx.cwd, fin))] || '') : undefined;
    const prevEnv = {}; for (const kv of varAssigns) { const [k, v] = evalKV(kv); prevEnv[k] = ctx.env[k]; ctx.env[k] = v; }
    try {
      if (cmd === 'npm') { ctx.lastExitCode = 0; if (writeOut) { writeOut(await captureFn(async () => { await runNpmResult(await npmCmd(args)); })); } else { await runNpmResult(await npmCmd(args)); } return; }
      if (cmd === 'npx') { ctx.lastExitCode = 0; await runNpmResult(await npxCmd(args)); return; }
      if (cmd === 'pnpm' || cmd === 'yarn' || cmd === 'bun') {
        if (args[0] === '--version' || args[0] === '-v' || args[0] === '-V') { term.write((cmd === 'bun' ? '1.3.8' : cmd === 'pnpm' ? '9.15.0' : '1.22.22') + '\r\n'); ctx.lastExitCode = 0; return; }
        ctx.lastExitCode = args[0] === 'dlx' || args[0] === 'x' ? await dlxCmd(args.slice(1)) : await pmDispatch(cmd, args[0] || 'install', args.slice(1)); return;
      }
      if (cmd === 'deno') {
        if (args[0] === '--version' || args[0] === '-V') { term.write('deno 2.1.4\r\n'); ctx.lastExitCode = 0; return; }
        if (args[0] === 'run') { ctx.lastExitCode = 0; await runNode(args.slice(1)); return; }
        ctx.lastExitCode = await pmDispatch('deno', args[0] || 'task', args.slice(1)); return;
      }
      if (cmd === 'corepack') { ctx.lastExitCode = await corepackCmd(args); return; }
      if (cmd === 'node') { ctx.lastExitCode = 0; await runNode(args); return; }
      if (cmd === 'git') { ctx.lastExitCode = 0; await gitCmd(args); return; }
      if (cmd === 'exit') { BUILTINS.exit([], actor); return; }
      if (writeOut) { writeOut(await invokeBuiltin(cmd, args, true, stdinBuf)); return; }
      await invokeBuiltin(cmd, args, false, stdinBuf);
    } finally { for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete ctx.env[k]; else ctx.env[k] = prevEnv[k]; } }
  }

  // Output process substitution (`>(cmd)`) registers a placeholder /procsub/N
  // path via expandTokens/expandProcSub and queues {path, cmd} onto
  // ctx.pendingWrites. The substituted path is an ordinary fs path from the
  // rest of the shell's point of view (writeOut/pipeline redirects write to
  // it via resolvePath+snap() like any other file), so after the command that
  // used the substitution finishes, drain the queue: read back whatever was
  // written under that path, feed it to cmd as stdin via captureRun, then
  // discard the placeholder key so it doesn't linger in the fs snapshot.
  async function drainPendingWrites() {
    const pending = ctx.pendingWrites;
    if (!pending || !pending.length) return;
    ctx.pendingWrites = [];
    const s = snap();
    for (const { path, cmd } of pending) {
      const k = toKey(path);
      const data = s[k] || '';
      delete s[k];
      const tmpKey = k + '.stdin';
      s[k + '.stdin'] = data;
      persist();
      try { await runPipeline(cmd + ' < /' + tmpKey); }
      catch (e) { term.write('\x1b[31m' + (e && e.message || e) + '\x1b[0m\r\n'); }
      finally { delete snap()[tmpKey]; }
    }
    persist();
  }

  async function runPipeline(line) {
    ctx.pipeTruncated = false;
    const pipes = parsePipes(line);
    if (pipes.length === 1) { await runSingleCommand(pipes[0]); ctx.arrays.PIPESTATUS = [String(ctx.lastExitCode)]; return; }
    let buf = '';
    const stageCodes = [];
    for (let i = 0; i < pipes.length; i++) {
      const isLast = i === pipes.length - 1;
      const { args: [cmd, ...args], stdout: rout, stdoutAppend } = parseRedirects(expandTokens(tokenize(pipes[i])));
      // Piped-in content flows to a stage via the stdin parameter only --
      // every builtin already reads it there (tee/grep/cat/xargs/...).
      // Prepending it as a positional arg here corrupted any non-first
      // pipe stage: `echo x | tee file` silently created a garbage file
      // literally named after the piped text (e.g. "x\n") alongside the
      // real target, because tee's `files` filter treats every non-flag
      // positional arg as a write target.
      const sArgs = args;
      const stdinForStage = buf;
      ctx.lastExitCode = 0;
      if (isLast && !rout) {
        if (cmd === 'node') { await runNode(args, stdinForStage); buf = ''; stageCodes.push(ctx.lastExitCode); continue; }
        await invokeBuiltin(cmd, sArgs, false, stdinForStage); buf = ''; stageCodes.push(ctx.lastExitCode); continue;
      }
      const out = cmd === 'node' ? await captureFn(() => runNode(args, stdinForStage)) : await invokeBuiltin(cmd, sArgs, true, stdinForStage);
      stageCodes.push(ctx.lastExitCode);
      if (rout) { const k = toKey(resolvePath(ctx.cwd, rout)); const s = snap(); s[k] = stdoutAppend ? (s[k] || '') + out : out; persist(); buf = ''; }
      else if (out.length > MAX_PIPE_BUFFER) {
        // Truncation discards data: surface it as a failed stage (non-zero exit)
        // so the chain loop reads lastOk=false instead of silently passing
        // partial output downstream as if the pipeline succeeded.
        term.write('\x1b[33m[pipe truncated: data exceeds ' + (MAX_PIPE_BUFFER / 1024 / 1024) + 'MB]\x1b[0m\r\n');
        ctx.pipeTruncated = true;
        buf = '';
        ctx.lastExitCode = 1;
        stageCodes[stageCodes.length - 1] = 1;
      } else buf = out;
    }
    ctx.arrays.PIPESTATUS = stageCodes.map(String);
    ctx.lastExitCode = ctx.opts.pipefail ? ([...stageCodes].reverse().find(c => c !== 0) ?? 0) : stageCodes[stageCodes.length - 1];
  }

  let blockLines = [];

  // Terminal session state (cwd, history, env) persists into the instance's
  // IDB snapshot under a reserved key so a refresh resumes the terminal at the
  // same directory with command history intact. The xstate `actor` already
  // models the run lifecycle (idle/running/node-repl); this adds the durable
  // context the machine operates over.
  const TERM_STATE_KEY = '.terminal-state.json';
  // Serialized schema: { v, cwd:string, history:string[], env:{[name]:string}, jobs:[{id,cmd,status}] }.
  // Bump TERM_STATE_VERSION when this shape changes; restore discards mismatched versions.
  const TERM_STATE_VERSION = 1;
  // Cap on the live in-memory ctx.history array. Without this, a long-running
  // tab (or one driving the shell via run() in a tight loop) grows ctx.history
  // without bound for the lifetime of the tab — every push() is O(1) but
  // getHistory()'s slice().reverse() on each readline keypress, and the
  // `history` builtin's full forEach, both become O(n) over an ever-growing n.
  const HISTORY_MAX = 500;
  // Serializable snapshot of the bg-job ledger. We never serialize the live
  // promise/actor — only the descriptor (id, cmd, status derived from the
  // per-job xstate actor's current state). A refresh can re-list these via the
  // `jobs` builtin even though the underlying process cannot truly resume.
  function snapshotJobs() {
    const out = [];
    for (const j of Object.values(ctx.bgJobs)) {
      let status;
      const st = j.actor?.getSnapshot?.().value;
      if (st) status = (st === 'done' || st === 'failed') ? 'done' : st; // running | stopped | done
      else status = j.detached ? 'detached' : (j.stopped ? 'stopped' : (j.done ? 'done' : 'running'));
      out.push({ id: j.id, cmd: j.cmd, status });
    }
    return out;
  }
  function persistTermState() {
    try {
      const s = snap();
      s[TERM_STATE_KEY] = JSON.stringify({ v: TERM_STATE_VERSION, cwd: ctx.cwd, history: ctx.history.slice(-500), env: ctx.env, jobs: snapshotJobs() });
      persist();
      ctx.persistFailed = false;
    } catch (e) {
      ctx.persistFailed = true;
      console.error('[shell persistence] term-state persist failed:', e);
    }
  }
  function restoreTermState() {
    try {
      const raw = snap()[TERM_STATE_KEY];
      if (!raw) return;
      const st = JSON.parse(raw);
      if (!st || typeof st !== 'object') { console.warn('[shell persistence] restored term-state is not an object'); ctx.restoreFailed = true; return; }
      if (typeof st.v === 'number' && st.v !== TERM_STATE_VERSION) { console.warn('[shell persistence] discarding incompatible term-state v' + st.v); return; }
      if (typeof st.cwd === 'string') {
        // Match cd's own not-found convention (shell-builtins.js: root always
        // valid, otherwise the key or some key under it must exist in the
        // instance fs). A directory deleted between sessions must not leave
        // the restored shell pointed at a broken cwd — fall back to the
        // default like a fresh shell would.
        const k = toKey(st.cwd);
        const s = snap();
        const exists = st.cwd === '/' || Object.keys(s).some(key => key === k || key.startsWith(k + '/'));
        ctx.cwd = exists ? st.cwd : DEFAULT_CWD;
        if (!exists) console.warn('[shell persistence] restored cwd no longer exists, falling back to default: ' + st.cwd);
      }
      if (Array.isArray(st.history)) {
        ctx.history.push(...st.history);
        if (ctx.history.length > HISTORY_MAX) ctx.history.splice(0, ctx.history.length - HISTORY_MAX);
      }
      if (st.env && typeof st.env === 'object') {
        for (const k in st.env) {
          if (typeof st.env[k] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) ctx.env[k] = st.env[k];
          else console.warn('[shell persistence] skipping invalid env entry: ' + k);
        }
      }
      // Restore the job ledger as descriptor-only entries. No live actor/promise
      // is recreated — the process is gone — but `registry.list()` /
      // `makeJobsBuiltin` read ctx.bgJobs and tolerate actor-less entries, so the
      // prior jobs re-surface (marked 'detached'). They are carried as Done if
      // they had already completed, else flagged stopped so they read as carried.
      if (st && Array.isArray(st.jobs)) {
        for (const j of st.jobs) {
          if (!j || ctx.bgJobs[j.id]) continue;
          ctx.bgJobs[j.id] = {
            id: j.id, cmd: j.cmd, detached: true,
            done: j.status === 'done', stopped: j.status === 'stopped',
            restored: true, actor: null, promise: null,
          };
          if (Array.isArray(ctx.jobOrder) && !ctx.jobOrder.includes(j.id)) ctx.jobOrder.push(j.id);
        }
        // Cap the restored ledger immediately instead of waiting on the next
        // spawnJob call — a large persisted job list would otherwise sit
        // unbounded in ctx.bgJobs/ctx.jobOrder (and keep re-persisting in full
        // via snapshotJobs) until a fresh job is spawned.
        jobRegistry.reap();
      }
      ctx.restoreFailed = false;
    } catch (e) {
      ctx.restoreFailed = true;
      console.warn('[shell persistence] term-state restore failed:', e);
    }
  }

  async function run(line, onData) {
    if (!line.trim()) return;
    ctx.history.push(line);
    if (ctx.history.length > HISTORY_MAX) ctx.history.splice(0, ctx.history.length - HISTORY_MAX);
    persistTermState();
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
    // splitTopLevel drops a dangling trailing '&' (its empty trailing segment is
    // not pushed and the orphaned separator is lost), so `cmd &` would run
    // foreground. Detect a top-level trailing '&' here, strip it, and background
    // the whole preceding command — the correct POSIX semantics.
    let bgLine = line;
    let trailingBg = false;
    {
      const stripped = line.replace(/\s+$/, '');
      // A single trailing '&' (not '&&') at top level backgrounds the command.
      if (/(^|[^&])&$/.test(stripped)) { bgLine = stripped.slice(0, -1).trim(); trailingBg = true; }
    }
    if (trailingBg && bgLine) {
      const id = jobRegistry.spawnJob(bgLine, runPipeline);
      ctx.env['!'] = id; term.write('[' + id + '] spawned\r\n');
      persistTermState(); ctx.bgJobs[id]?.promise?.finally?.(() => persistTermState());
      if (onData) drainQueue(onData);
      return;
    }
    const chain = splitTopLevel(line, ['&&', '||', ';', '&']);
    let lastOk = true;
    for (const { cmd, sep } of chain) {
      if (ctx.loopFlag) break;
      if (sep === '&&' && !lastOk) continue;
      if (sep === '||' && lastOk) { lastOk = true; continue; }
      // Mid-line '&' (e.g. `a & b`): background the segment that the '&' precedes.
      if (sep === '&') { if (!cmd.trim()) continue; const id = jobRegistry.spawnJob(cmd, runPipeline); ctx.env['!'] = id; term.write('[' + id + '] spawned\r\n'); persistTermState(); ctx.bgJobs[id]?.promise?.finally?.(() => persistTermState()); continue; }
      actor.send({ type: 'RUN' });
      ctx.currentJob = { cmd, killed: false };
      auditLog?.log(auditLog.AuditEvent.PROCESS_SPAWN, 'user', { cmd });
      // No pre-pipeline reset of lastExitCode here: `$?` must expand to the
      // PREVIOUS pipeline's status during this one. Bare assignment lines set
      // 0 explicitly in runSingleCommand instead.
      try { await runPipeline(cmd); await drainPendingWrites(); lastOk = ctx.lastExitCode === 0; actor.send({ type: 'DONE' }); }
      catch (e) { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); ctx.lastExitCode = 1; lastOk = false; actor.send({ type: 'ERROR' }); }
      auditLog?.log(auditLog.AuditEvent.PROCESS_EXIT, 'user', { cmd, exitCode: ctx.lastExitCode });
      const wasKilled = ctx.currentJob?.killed;
      ctx.currentJob = null;
      if (wasKilled) { ctx.lastExitCode = 130; break; }
      if (ctx.opts.errexit && !lastOk) break;
      if (ctx.signals) await ctx.signals.check(l => run(l));
    }
    // Re-persist after the chain actually runs: the pre-execution persist above
    // (right after the history push) only captures state as of BEFORE this
    // command's effects. A command that mutates ctx.cwd (cd) or ctx.env
    // (export) would otherwise have that mutation persisted only as a side
    // effect of the NEXT command typed — so `cd /docs` followed immediately by
    // a reload restored the previous cwd instead of the new one. Persisting
    // again here closes that one-command lag for cwd/env (jobs already have
    // their own post-spawn persist calls above).
    persistTermState();
    if (onData) drainQueue(onData);
  }

  // allBuiltinNames() enumerates every dispatchable command (core + every
  // lazy group's commands + runtime runners) from the manifest's static data
  // -- it does NOT trigger a single dynamic import, so tab-completion no
  // longer forces every builtin group to load just to list command names.
  const getCompletions = (line, word) => (line.trim().split(/\s+/).length <= 1 && !line.includes(' ')) ? allBuiltinNames().filter(c => c.startsWith(word)) : Object.keys(snap()).filter(f => f.startsWith(word));

  const handleLine = line => {
    if (blockLines.length > 0 || isControlStart(line)) {
      blockLines.push(line); if (isBlockOpen(blockLines)) { rl.showContinuation(); return; }
      const block = blockLines.slice(); blockLines = [];
      runControl(block, run, ctx).then(() => rl.showPrompt()).catch(e => { term.write('\x1b[31m' + e.message + '\x1b[0m\r\n'); rl.showPrompt(); });
      return;
    }
    run(line, onData).then(() => rl.showPrompt());
  };
  // ctx.history is oldest-first (run() does ctx.history.push(line), a plain
  // append-only log); shell-readline.js's own local `hist` array (built via
  // hist.unshift(...) in its commit()) is newest-first (hist[0] === most
  // recent, matched by histIdx===0 on the first ArrowUp). Reverse here so the
  // injected accessor honors the same newest-first contract the readline
  // module already assumes everywhere else (histNav/expandBang).
  const rl = createReadline({ term, getCompletions, getPrompt: () => actor.getSnapshot().value === 'node-repl' ? '> ' : ctx.cwd, isBlockOpen: () => blockLines.length > 0, onLine: handleLine, getHistory: () => ctx.history.slice().reverse() });
  function onData(data) {
    if (data === '\x03') {
      if (ctx.currentJob) ctx.currentJob.killed = true;
      if (ctx.signals) ctx.signals.raise('INT');
      actor.send({ type: 'ERROR' }); inputQueue = []; blockLines = []; term.write('^C'); rl.showPrompt(); return;
    }
    const st = actor.getSnapshot().value;
    if (st !== 'idle' && st !== 'node-repl') inputQueue.push(data); else rl.onData(data);
  }
  term.onData(onData);
  restoreTermState();
  rl.showPrompt();
  return {
    run: line => run(line, onData), onPreviewWrite, httpHandlers, procsubRead: id => readStream(id, ctx.procsubNs), fdRead: fd => ctx.fdTable.readFd(fd),
    addBuiltins: (extras) => { for (const k of Object.keys(extras)) BUILTINS[k] = extras[k]; },
    get state() { return actor.getSnapshot().value; }, get cwd() { return ctx.cwd; }, get env() { return ctx.env; }, get history() { return ctx.history; },
    get lastExitCode() { return ctx.lastExitCode; }, get inputQueue() { return inputQueue.slice(); },
    get persistFailed() { return ctx.persistFailed === true; },
  };
}
