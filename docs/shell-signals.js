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

const KNOWN_SIGNALS = new Set(['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STOP', 'TSTP', 'CONT', 'CHLD', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'IO', 'PWR', 'SYS']);

export function makeKillBuiltin(ctx) {
  return args => {
    if (args[0] === '-l') {
      const names = [...KNOWN_SIGNALS];
      if (args.length === 1) {
        ctx.term.write(names.map((n, i) => (i + 1) + ') SIG' + n).join('\t') + '\r\n');
        ctx.lastExitCode = 0;
        return;
      }
      for (const a of args.slice(1)) {
        if (/^\d+$/.test(a)) {
          const name = names[Number(a) - 1];
          ctx.term.write((name || a) + '\r\n');
        } else {
          const norm = a.replace(/^SIG/, '').toUpperCase();
          const idx = names.indexOf(norm);
          ctx.term.write((idx >= 0 ? String(idx + 1) : a) + '\r\n');
        }
      }
      ctx.lastExitCode = 0;
      return;
    }
    let sig = 'TERM';
    const targets = [];
    for (const a of args) {
      if (a.startsWith('-')) sig = a.slice(1).replace(/^SIG/, '');
      else targets.push(a);
    }
    if (!targets.length) {
      ctx.term.write('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\r\n');
      ctx.lastExitCode = 2;
      return;
    }
    if (!/^\d+$/.test(sig) && !KNOWN_SIGNALS.has(sig)) {
      ctx.term.write('bash: kill: ' + sig + ': invalid signal specification\r\n');
      ctx.lastExitCode = 1;
      return;
    }
    for (const t of targets) {
      const isJobspec = t.startsWith('%');
      const id = isJobspec ? t.slice(1) : t;
      if (!isJobspec && !/^\d+$/.test(t)) {
        ctx.term.write('bash: kill: ' + t + ': arguments must be process or job IDs\r\n');
        ctx.lastExitCode = 1; continue;
      }
      const job = ctx.bgJobs?.[id];
      if (!job) {
        if (isJobspec) ctx.term.write('bash: kill: ' + t + ': no such job\r\n');
        else ctx.term.write('bash: kill: (' + t + ') - No such process\r\n');
        ctx.lastExitCode = 1; continue;
      }
      if (job.actor) job.actor.send({ type: 'SIGNAL', sig });
      if (sig === 'KILL' || sig === '9') { job.killed = true; }
      if ((sig === 'STOP' || sig === 'TSTP') && !job.done) { if (job.actor) job.actor.send({ type: 'STOP' }); job.stopped = true; }
      if (sig === 'CONT' && !job.done) { if (job.actor) job.actor.send({ type: 'CONT' }); job.stopped = false; }
    }
  };
}

export function makeTrapBuiltin(ctx) {
  return args => {
    const handlers = ctx.traps || (ctx.traps = {});
    if (!args.length) {
      for (const [sig, cmd] of Object.entries(handlers)) ctx.term.write("trap -- '" + cmd + "' SIG" + sig + '\r\n');
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
