import { Bash, initBashkit } from '/web/vendor/bashkit/index.js';
import { createHost } from './shims/bashkit-host.js';
import { gitBuiltin } from './git-in-page.js';
import { sqliteBuiltin } from './sqlite-in-page.js';

const withNewline = (text) => (text ? text + '\n' : '');

export async function createShell({ cwd = '/workspace' } = {}) {
  await initBashkit();
  const customBuiltins = {
    git: (ctx) => gitBuiltin(ctx.argv).then(withNewline),
    sqlite3: (ctx) => sqliteBuiltin(ctx.argv).then(withNewline),
  };
  const bash = new Bash({ cwd, fs: createHost(), customBuiltins });
  return {
    async run(command) {
      const result = await bash.execute(command);
      return { ok: result.exitCode === 0, exitCode: result.exitCode, signal: null, output: result.stdout + result.stderr };
    },
  };
}
