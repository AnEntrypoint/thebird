export function createSignals(ctx) {
  const pending = [];
  const handlers = ctx.traps || (ctx.traps = {});
  return {
    raise(sig) { pending.push(sig); },
    async check(run) {
      while (pending.length) {
        const sig = pending.shift();
        if (sig === 'KILL') { const j = ctx.currentJob; if (j) j.killed = true; throw new Error('killed by SIGKILL'); }
        const h = handlers[sig];
        if (h) { try { await run(h); } catch (e) { ctx.term.write('\x1b[31mtrap: ' + e.message + '\x1b[0m\r\n'); } }
        if (sig === 'INT' && !h && ctx.currentJob) ctx.currentJob.killed = true;
      }
    },
    pending: () => pending.slice(),
  };
}

export function makeKillBuiltin(ctx) {
  return args => {
    let sig = 'TERM';
    const targets = [];
    for (const a of args) {
      if (a.startsWith('-')) sig = a.slice(1).replace(/^SIG/, '');
      else targets.push(a);
    }
    for (const t of targets) {
      const id = t.startsWith('%') ? t.slice(1) : t;
      const job = ctx.bgJobs?.[id];
      if (!job) { ctx.term.write('kill: ' + t + ': no such job\r\n'); ctx.lastExitCode = 1; continue; }
      if (job.actor) job.actor.send({ type: 'SIGNAL', sig });
      if (sig === 'KILL' || sig === '9') { job.killed = true; if (job.reject) job.reject(new Error('killed')); }
      if (sig === 'STOP' || sig === 'TSTP') { if (job.actor) job.actor.send({ type: 'STOP' }); job.stopped = true; }
      if (sig === 'CONT') { if (job.actor) job.actor.send({ type: 'CONT' }); job.stopped = false; }
    }
  };
}

export function makeTrapBuiltin(ctx) {
  return args => {
    const handlers = ctx.traps || (ctx.traps = {});
    if (!args.length) {
      for (const [sig, cmd] of Object.entries(handlers)) ctx.term.write("trap -- '" + cmd + "' " + sig + '\r\n');
      return;
    }
    if (args[0] === '-l') { ctx.term.write('HUP INT QUIT ILL TRAP ABRT BUS FPE KILL USR1 SEGV USR2 PIPE ALRM TERM STOP TSTP CONT CHLD TTIN TTOU URG XCPU XFSZ VTALRM PROF WINCH IO PWR SYS\r\n'); return; }
    const [cmd, ...sigs] = args;
    for (const s of sigs) {
      const norm = s.replace(/^SIG/, '').toUpperCase();
      if (cmd === '-' || cmd === '') delete handlers[norm];
      else handlers[norm] = cmd;
    }
  };
}
