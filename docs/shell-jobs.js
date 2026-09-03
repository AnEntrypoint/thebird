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

// Bound on the bg-job ledger. Completed jobs are descriptor-only (no live
// actor/promise) yet linger in ctx.bgJobs, and snapshotJobs() serializes the
// whole ledger into IDB, so without reaping a long-lived shell that spawns
// many jobs grows ctx.bgJobs (and the persisted term-state) unboundedly. Once
// the ledger exceeds MAX_JOBS we drop the oldest completed jobs (never a
// running/stopped/foreground job, which are not yet done).
const MAX_JOBS = 100;

export function createJobRegistry(ctx) {
  ctx.bgJobs = ctx.bgJobs || {};
  // jobOrder tracks spawn order explicitly (oldest first) rather than relying
  // on Object.keys(ctx.bgJobs) iteration order. Integer-like object keys are
  // always visited in ascending NUMERIC order per spec, which happens to
  // match insertion order only while ids are monotonically increasing and
  // none are deleted out of order -- true today, but fragile and undocumented
  // if it were relied on. jobOrder is the single source of truth for
  // "most/second-most recently spawned" (the '+'/'-' current/previous job
  // markers) and for reap()'s oldest-first eviction.
  ctx.jobOrder = ctx.jobOrder || Object.keys(ctx.bgJobs);
  // nextId starts at 1 and is bumped past any already-populated ctx.bgJobs entries
  // (e.g. from restoreTermState()) the first time spawnJob is called, preventing
  // collisions between freshly-spawned jobs and restored descriptor-only jobs.
  let nextId = 1;
  let seeded = false;
  function seedNextId() {
    if (seeded) return;
    seeded = true;
    const ids = Object.keys(ctx.bgJobs).map(Number).filter(n => !isNaN(n));
    if (ids.length) nextId = Math.max(...ids) + 1;
  }

  // Reap finished jobs (spawn-ordered, oldest first) until the ledger is back
  // under MAX_JOBS. Live jobs (done:false) are left untouched.
  function reap() {
    let len = ctx.jobOrder.length;
    for (let i = 0; i < ctx.jobOrder.length && len > MAX_JOBS; i++) {
      const id = ctx.jobOrder[i];
      const j = ctx.bgJobs[id];
      if (j && j.done) {
        delete ctx.bgJobs[id];
        ctx.jobOrder.splice(i, 1);
        i--; len--;
      }
    }
  }

  function spawnJob(cmd, runPipeline) {
    seedNextId();
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
    // ctx.fds is one table shared by the whole shell instance -- exec-style
    // redirects issued inside this backgrounded job (`exec 3>file`) mutate the
    // same live table the interactive shell and every other job read/write.
    // Snapshot the fd-slot keys present before the job runs so any NEW fd (>=3,
    // the only range exec-redirect opens) it opened is closed here once the job
    // finishes -- it must not leak into the foreground shell or collide with a
    // concurrently-running job's own exec-redirect on the same slot number.
    const preFds = ctx.fds ? new Set(Object.keys(ctx.fds.table)) : null;
    const p = (async () => {
      try { await runPipeline(cmd); job.exit = ctx.lastExitCode; actor.send({ type: 'DONE' }); }
      catch (e) { job.error = e.message; actor.send({ type: 'FAIL' }); }
      finally {
        job.done = true;
        job.stopped = false;
        if (preFds && ctx.fds) {
          for (const k of Object.keys(ctx.fds.table)) {
            const n = Number(k);
            if (n >= 3 && !preFds.has(k)) {
              try { ctx.fds.close(n); } catch (_) { /* already closed/invalid */ }
            }
          }
        }
        reap(); if (ctx.swJobs) ctx.swJobs.unregister(id).catch(() => {});
      }
    })();
    job.promise = p;
    ctx.bgJobs[id] = job;
    ctx.jobOrder.push(id);
    reap();
    if (ctx.swJobs) ctx.swJobs.register(id, cmd).catch(() => {});
    return id;
  }

  function list() {
    return ctx.jobOrder.filter(id => ctx.bgJobs[id]).map(id => {
      const j = ctx.bgJobs[id];
      return { id: j.id, cmd: j.cmd, state: j.actor?.getSnapshot().value || 'unknown', done: j.done, stopped: j.stopped };
    });
  }

  function resolve(ref) {
    const id = ref.startsWith('%') ? ref.slice(1) : ref;
    if (id === '+' || !id) { return ctx.bgJobs[ctx.jobOrder[ctx.jobOrder.length - 1]]; }
    return ctx.bgJobs[id];
  }

  return { spawnJob, list, resolve, reap };
}

export function makeJobsBuiltin(ctx, registry) {
  return args => {
    const long = args.includes('-l');
    const jobs = registry.list();
    const currentId = jobs.length ? jobs[jobs.length - 1].id : null;
    const previousId = jobs.length > 1 ? jobs[jobs.length - 2].id : null;
    for (const j of jobs) {
      const state = (j.stopped ? 'Stopped' : j.done ? 'Done' : 'Running').padEnd(20);
      // long-format column stands in for a real OS PID with the job's own
      // ledger id (browser jobs have no real PID) -- never claim it's a real pid.
      const pidCol = long ? String(j.id).padStart(6) + '  ' : '';
      const marker = j.id === currentId ? '+' : j.id === previousId ? '-' : ' ';
      ctx.term.write('[' + j.id + ']' + marker + '  ' + pidCol + state + j.cmd + (j.done ? '' : ' &') + '\r\n');
    }
  };
}

export function makeFgBuiltin(ctx, registry) {
  return async args => {
    const job = registry.resolve(args[0] || '+');
    if (!job) {
      ctx.term.write(args[0] ? 'bash: fg: ' + args[0] + ': no such job\r\n' : 'bash: fg: no current job\r\n');
      ctx.lastExitCode = 1; return;
    }
    if (job.__fgInFlight) {
      ctx.term.write('bash: fg: job ' + job.id + ' already in foreground\r\n');
      ctx.lastExitCode = 1; return;
    }
    if (job.stopped && job.actor) { job.actor.send({ type: 'CONT' }); job.stopped = false; }
    // Save/restore the prior foreground job rather than blindly nulling it: if a
    // second `fg` starts before this one's promise settles, its currentJob must
    // survive our finally, otherwise signals (signals.check reads ctx.currentJob)
    // get delivered to the wrong job. Mirrors the argv/optind save-restore in shell.js.
    const prevJob = ctx.currentJob;
    // Drain any pending signals queued against the previous foreground job
    // before switching ctx.currentJob, so signals.check() targets the right job.
    if (ctx.signals) await ctx.signals.check(() => {});
    ctx.currentJob = job;
    job.__fgInFlight = true;
    try { await job.promise; } finally { job.__fgInFlight = false; ctx.currentJob = prevJob; }
    ctx.lastExitCode = job.exit ?? (job.error ? 1 : 0);
  };
}

export function makeBgBuiltin(ctx, registry) {
  return args => {
    const job = registry.resolve(args[0] || '+');
    if (!job) { ctx.term.write('bash: bg: no such job\r\n'); ctx.lastExitCode = 1; return; }
    if (!job.stopped) {
      ctx.term.write('bash: bg: job ' + job.id + ': already in background\r\n');
      ctx.lastExitCode = 1; return;
    }
    if (job.actor) { job.actor.send({ type: 'CONT' }); job.stopped = false; }
    ctx.term.write('[' + job.id + ']+ ' + job.cmd + ' &\r\n');
  };
}

export function makeDisownBuiltin(ctx) {
  return args => {
    let failed = false;
    for (const a of args) {
      const id = a.startsWith('%') ? a.slice(1) : a;
      if (ctx.bgJobs[id]) {
        delete ctx.bgJobs[id];
        const idx = ctx.jobOrder.indexOf(id);
        if (idx !== -1) ctx.jobOrder.splice(idx, 1);
      } else {
        ctx.term.write('bash: disown: %' + id + ': no such job\r\n');
        failed = true;
      }
    }
    ctx.lastExitCode = failed ? 1 : 0;
  };
}
