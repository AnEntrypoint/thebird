import { Bash, ExecutionProfile, initBashkit } from './vendor/bashkit/index.js';
import { createHost } from './shims/bashkit-host.js';
import { BUILTIN_NAMES, runBuiltin } from './builtins.js';
import { lookupPrologue } from './shell-lookup.js';
import { createShell as createCoreShell, syntaxText } from './shell-core.js';

const withNewline = (text) => (text ? text + '\n' : '');
const EMULATED = /\b(uname|whoami|hostname|id|ps|kill|tar)\b/;
const COMMAND_TIMEOUT_MS = 900000;
const CORE_NAMES = ['sort', 'touch'];
const JOB_NAMES = ['wait', 'jobs'];
const coreWrapper = (name) => `${name}() {\n  command ${name} "$@"\n  local rc\n  rc="$(thebird_status)"\n  thebird_stderr >&2\n  return "$rc"\n}\n`;
const EMULATION_NOTE ='note: uname, whoami, hostname, id, ps, kill and tar are in-page emulations; they report sandbox values and see only the in-page shell, not this machine';

export function backgroundSplit(command) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') i++;
      continue;
    }
    if (c === '\\') i++;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '&') {
      if (command[i + 1] === '&') i++;
      else if (['>', '<', '|', ';'].includes(command[i - 1]) || command[i + 1] === '>') continue;
      else {
        parts.push(command.slice(start, i));
        start = i + 1;
      }
    }
  }
  return { background: parts, foreground: command.slice(start) };
}

const coreHost = (host) => ({
  read: (path) => {
    const bytes = host.read(path);
    return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
  },
  write: (path, text) => host.write(path, new TextEncoder().encode(text)),
  exists: (path) => host.exists(path),
  touch: (path, access, modify) => host.touch(path, access, modify),
  stat: (path) => {
    try {
      const info = host.stat(path);
      return { ...info, dir: info.type === 'dir', file: info.type === 'file' };
    } catch {
      return null;
    }
  },
});

const commandRunner = (cwd, signal, commandTimeoutMs) => {
  let shell = null;
  const cancel = () => shell?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  return async (command) => {
    shell ??= await createShell({ cwd, commandTimeoutMs });
    return shell.run(command);
  };
};

export async function createShell({ cwd = '/workspace', commandTimeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  await initBashkit();
  const host = createHost();
  let abort = new AbortController();
  let engineCancelled = false;
  let builtinStatus = 1;
  let pendingStderr = '';
  const jobs = new Map();
  let jobSeq = 0;
  let lineOutput = null;
  let pendingOutput = '';
  const deliver = (text) => {
    if (!text) return;
    if (lineOutput) lineOutput(text);
    else pendingOutput += text;
  };
  const customBuiltins = Object.fromEntries(BUILTIN_NAMES.map((name) => [name, (ctx) => runBuiltin(name, ctx.argv, { cwd: ctx.cwd, signal: abort.signal, timeoutMs: commandTimeoutMs, exec: commandRunner(ctx.cwd, abort.signal, commandTimeoutMs) }).then((text) => {
    builtinStatus = 0;
    return withNewline(text);
  }, (err) => {
    engineCancelled ||= err?.message === 'cancelled';
    builtinStatus = err?.message === 'cancelled' ? 130 : (err?.exitCode ?? 1);
    if (err?.stdout !== undefined) return withNewline(err.stdout);
    throw err;
  })]));
  customBuiltins.thebird_status = () => String(builtinStatus);
  customBuiltins.thebird_stderr = () => {
    const text = pendingStderr;
    pendingStderr = '';
    return text;
  };
  for (const name of CORE_NAMES) {
    customBuiltins[name] = async (ctx) => {
      const { code, out, err } = await createCoreShell({ host: coreHost(host), cwd: ctx.cwd }).command([name, ...ctx.argv], ctx.stdin ?? '');
      builtinStatus = code;
      pendingStderr = err;
      return out;
    };
  }
  let current = cwd;
  let status = 0;
  const startJob = (text) => {
    const id = ++jobSeq;
    const jobBash = new Bash({ cwd: current, fs: host, customBuiltins, timeoutMs: commandTimeoutMs, profile: ExecutionProfile.Interactive });
    const job = { id, command: text.trim(), status: 'running', exitCode: 0 };
    jobs.set(id, job);
    const timer = setTimeout(() => {
      if (job.status !== 'running') return;
      job.status = 'reaped';
      job.exitCode = 124;
      jobBash.cancel();
      deliver(`thebird: job ${id} reaped at its deadline\n`);
    }, commandTimeoutMs);
    job.promise = jobBash.execute(text).then((result) => {
      clearTimeout(timer);
      if (job.status !== 'running') return;
      job.status = 'done';
      job.exitCode = result.exitCode;
      deliver(result.stdout + result.stderr);
    }, (err) => {
      clearTimeout(timer);
      if (job.status !== 'running') return;
      job.status = 'failed';
      job.exitCode = 1;
      deliver(`${err?.message ?? 'job failed'}\n`);
    });
    return job;
  };
  customBuiltins.wait = async (ctx) => {
    let err = '';
    let code = 0;
    const selected = [];
    if (ctx.argv.length === 0) selected.push(...jobs.values());
    for (const arg of ctx.argv) {
      const job = jobs.get(Number(arg.replace(/^%/, '')));
      if (job) selected.push(job);
      else {
        err += `wait: ${arg}: no such job\n`;
        code = 127;
      }
    }
    for (const job of selected) {
      await job.promise;
      code = job.exitCode;
      jobs.delete(job.id);
    }
    builtinStatus = code;
    pendingStderr = err;
    return '';
  };
  customBuiltins.jobs = async () => {
    builtinStatus = 0;
    return withNewline([...jobs.values()].map((job) => `[${job.id}]  ${job.status === 'running' ? 'Running' : job.status === 'done' ? 'Done' : job.status === 'reaped' ? 'Terminated' : 'Exit ' + job.exitCode}  ${job.command} &`).join('\n'));
  };
  const bash = new Bash({ cwd, fs: host, customBuiltins, timeoutMs: commandTimeoutMs, profile: ExecutionProfile.Interactive });
  await bash.execute(lookupPrologue([...BUILTIN_NAMES, ...CORE_NAMES]));
  await bash.execute([...CORE_NAMES, ...JOB_NAMES].map(coreWrapper).join(''));
  const commandNames = [...new Set((await bash.execute('for n in $(compgen -c); do command -v "$n" >/dev/null && echo "$n"; done')).stdout.split('\n').filter(Boolean))].sort();
  let running = false;
  let cancelled = false;
  let size = '';
  return {
    async run(command, { onOutput } = {}) {
      const split = backgroundSplit(command);
      let collected = pendingOutput;
      pendingOutput = '';
      lineOutput = onOutput ? (text) => onOutput(text, '') : (text) => { collected += text; };
      for (const part of split.background) startJob(part);
      const foreground = split.foreground;
      if (foreground.trim() === '') {
        status = 0;
        lineOutput = null;
        return { ok: true, exitCode: 0, signal: null, output: collected };
      }
      const restore = status === 0 ? '' : `(exit ${status}); `;
      running = true;
      cancelled = false;
      engineCancelled = false;
      abort = new AbortController();
      let result;
      let streamed = Boolean(onOutput);
      try {
        result = await bash.execute(size + restore + foreground, onOutput ? { onOutput } : {});
      } catch (err) {
        if (!cancelled && /^parse error at line /.test(err.message)) {
          const text = syntaxText(foreground);
          if (text !== null) {
            status = 2;
            lineOutput = null;
            return { ok: false, exitCode: 2, signal: null, output: text };
          }
        }
        if (!cancelled) {
          lineOutput = null;
          throw err;
        }
      } finally {
        running = false;
        bash.clearCancel();
      }
      if (cancelled || engineCancelled) {
        streamed = false;
        result = { exitCode: 130, stdout: '', stderr: 'cancelled\n' };
      }
      status = result.exitCode;
      current = (await bash.execute('pwd')).stdout.trim() || current;
      lineOutput = null;
      const note = EMULATED.test(command) ? withNewline(EMULATION_NOTE) : '';
      const text = streamed ? '' : result.stdout + result.stderr;
      return { ok: result.exitCode === 0, exitCode: result.exitCode, signal: null, output: collected + text + note };
    },
    resize({ cols, rows }) {
      size = `export COLUMNS=${cols} LINES=${rows}; `;
    },
    cancel() {
      if (!running) return;
      cancelled = true;
      abort.abort();
      bash.cancel();
    },
    cwd() {
      return current;
    },
    commands() {
      return commandNames;
    },
  };
}
