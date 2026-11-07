import { Bash, initBashkit } from '/web/vendor/bashkit/index.js';
import { createHost } from './shims/bashkit-host.js';
import { gitBuiltin } from './git-in-page.js';
import { sqliteBuiltin } from './sqlite-in-page.js';
import { pythonBuiltin } from './python-in-page.js';
import { curlBuiltin } from './curl-in-page.js';
import { lookupPrologue } from './shell-lookup.js';

const withNewline = (text) => (text ? text + '\n' : '');
const EMULATED = /\b(uname|whoami|hostname|id|ps|kill|tar)\b/;
const EMULATION_NOTE = 'note: uname, whoami, hostname, id, ps, kill and tar are in-page emulations; they report sandbox values and see only the in-page shell, not this machine';

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
  const customBuiltins = {
    git: (ctx) => gitBuiltin(ctx.argv).then(withNewline),
    sqlite3: (ctx) => sqliteBuiltin(ctx.argv).then(withNewline),
    python3: (ctx) => pythonBuiltin(ctx.argv).then(withNewline),
    curl: (ctx) => curlBuiltin('curl', ctx.argv, ctx.cwd).then(withNewline),
    wget: (ctx) => curlBuiltin('wget', ctx.argv, ctx.cwd).then(withNewline),
  };
  const bash = new Bash({ cwd, fs: createHost(), customBuiltins });
  await bash.execute(lookupPrologue(Object.keys(customBuiltins)));
  const commandNames = [...new Set((await bash.execute('for n in $(compgen -c); do command -v "$n" >/dev/null && echo "$n"; done')).stdout.split('\n').filter(Boolean))].sort();
  let status = 0;
  let running = false;
  let cancelled = false;
  let current = cwd;
  return {
    async run(command, { onOutput } = {}) {
      const restore = status === 0 ? '' : `(exit ${status}); `;
      running = true;
      cancelled = false;
      let result;
      let streamed = Boolean(onOutput);
      try {
        result = await bash.execute(restore + command, onOutput ? { onOutput } : {});
      } catch (err) {
        if (!cancelled) throw err;
        streamed = false;
        result = { exitCode: 130, stdout: '', stderr: 'cancelled\n' };
      } finally {
        running = false;
        bash.clearCancel();
      }
      status = result.exitCode;
      current = (await bash.execute('pwd')).stdout.trim() || current;
      const note = EMULATED.test(command) ? withNewline(EMULATION_NOTE) : '';
      const text = streamed ? '' : result.stdout + result.stderr;
      return { ok: result.exitCode === 0, exitCode: result.exitCode, signal: null, output: text + note };
    },
    cancel() {
      if (!running) return;
      cancelled = true;
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
