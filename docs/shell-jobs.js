import { createMachine, createActor } from './vendor/xstate.js';

const jobMachine = createMachine({
  id: 'job', initial: 'running',
  states: {
    running: { on: { STOP: 'stopped', DONE: 'done', FAIL: 'failed', SIGNAL: { actions: 'deliverSignal' } } },
    stopped: { on: { CONT: 'running', DONE: 'done', SIGNAL: { actions: 'deliverSignal' } } },
    done: { type: 'final' },
    failed: { type: 'final' },
  },
});

export function createJobRegistry(ctx) {
  ctx.bgJobs = ctx.bgJobs || {};
  let nextId = 1;

  function spawnJob(cmd, runPipeline) {
    const id = String(nextId++);
    const actor = createActor(jobMachine.provide({
      actions: {
        deliverSignal: (_, ev) => {
          if (ev?.sig && ctx.signals) ctx.signals.raise(ev.sig);
        },
      },
    }));
    actor.start();
    const job = { id, cmd, actor, done: false, stopped: false, killed: false, startedAt: Date.now() };
    const p = (async () => {
      try { await runPipeline(cmd); job.exit = ctx.lastExitCode; actor.send({ type: 'DONE' }); }
      catch (e) { job.error = e.message; actor.send({ type: 'FAIL' }); }
      finally { job.done = true; }
    })();
    job.promise = p;
    ctx.bgJobs[id] = job;
    if (ctx.swJobs) ctx.swJobs.register(id, cmd).catch(() => {});
    return id;
  }

  function list() {
    return Object.values(ctx.bgJobs).map(j => ({ id: j.id, cmd: j.cmd, state: j.actor?.getSnapshot().value || 'unknown', done: j.done, stopped: j.stopped }));
  }

  function resolve(ref) {
    const id = ref.startsWith('%') ? ref.slice(1) : ref;
    if (id === '+' || !id) { const keys = Object.keys(ctx.bgJobs); return ctx.bgJobs[keys[keys.length - 1]]; }
    return ctx.bgJobs[id];
  }

  return { spawnJob, list, resolve };
}

export function makeJobsBuiltin(ctx, registry) {
  return args => {
    const long = args.includes('-l');
    for (const j of registry.list()) ctx.term.write('[' + j.id + ']  ' + (j.stopped ? 'Stopped' : j.done ? 'Done' : 'Running') + (long ? '  ' + j.id : '') + '  ' + j.cmd + '\r\n');
  };
}

export function makeFgBuiltin(ctx, registry) {
  return async args => {
    const job = registry.resolve(args[0] || '+');
    if (!job) { ctx.term.write('fg: no such job\r\n'); ctx.lastExitCode = 1; return; }
    if (job.stopped) { job.actor.send({ type: 'CONT' }); job.stopped = false; }
    ctx.currentJob = job;
    try { await job.promise; } finally { ctx.currentJob = null; }
    ctx.lastExitCode = job.exit ?? (job.error ? 1 : 0);
  };
}

export function makeBgBuiltin(ctx, registry) {
  return args => {
    const job = registry.resolve(args[0] || '+');
    if (!job) { ctx.term.write('bg: no such job\r\n'); ctx.lastExitCode = 1; return; }
    if (job.stopped) { job.actor.send({ type: 'CONT' }); job.stopped = false; }
    ctx.term.write('[' + job.id + ']+ ' + job.cmd + ' &\r\n');
  };
}

export function makeDisownBuiltin(ctx) {
  return args => {
    for (const a of args) {
      const id = a.startsWith('%') ? a.slice(1) : a;
      if (ctx.bgJobs[id]) { ctx.bgJobs[id].disowned = true; delete ctx.bgJobs[id]; }
    }
  };
}
