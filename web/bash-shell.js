import { Bash, initBashkit } from './vendor/bashkit/index.js';
import { createHost } from './shims/bashkit-host.js';
import { BUILTIN_NAMES, runBuiltin } from './builtins.js';
import { lookupPrologue } from './shell-lookup.js';

const withNewline = (text) => (text ? text + '\n' : '');
const EMULATED = /\b(uname|whoami|hostname|id|ps|kill|tar)\b/;
const COMMAND_TIMEOUT_MS = 300000;
const EMULATION_NOTE ='note: uname, whoami, hostname, id, ps, kill and tar are in-page emulations; they report sandbox values and see only the in-page shell, not this machine';

export function hasBackgroundOperator(command) {
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
      else return true;
    }
  }
  return false;
}

export async function createShell({ cwd = '/workspace' } = {}) {
  await initBashkit();
  let abort = new AbortController();
  let engineCancelled = false;
  const customBuiltins = Object.fromEntries(BUILTIN_NAMES.map((name) => [name, (ctx) => runBuiltin(name, ctx.argv, { cwd: ctx.cwd, signal: abort.signal, timeoutMs: COMMAND_TIMEOUT_MS }).then(withNewline, (err) => {
    engineCancelled ||= err?.message === 'cancelled';
    throw err;
  })]));
  const bash = new Bash({ cwd, fs: createHost(), customBuiltins, timeoutMs: COMMAND_TIMEOUT_MS });
  await bash.execute(lookupPrologue(Object.keys(customBuiltins)));
  const commandNames = [...new Set((await bash.execute('for n in $(compgen -c); do command -v "$n" >/dev/null && echo "$n"; done')).stdout.split('\n').filter(Boolean))].sort();
  let status = 0;
  let running = false;
  let cancelled = false;
  let current = cwd;
  let size = '';
  return {
    async run(command, { onOutput } = {}) {
      const restore = status === 0 ? '' : `(exit ${status}); `;
      running = true;
      cancelled = false;
      engineCancelled = false;
      abort = new AbortController();
      let result;
      let streamed = Boolean(onOutput);
      try {
        result = await bash.execute(size + restore + command, onOutput ? { onOutput } : {});
      } catch (err) {
        if (!cancelled) throw err;
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
      const note = EMULATED.test(command) ? withNewline(EMULATION_NOTE) : '';
      const text = streamed ? '' : result.stdout + result.stderr;
      return { ok: result.exitCode === 0, exitCode: result.exitCode, signal: null, output: text + note };
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
