import { Bash, initBashkit } from '/web/vendor/bashkit/index.js';
import { createHost } from './shims/bashkit-host.js';
import { gitBuiltin } from './git-in-page.js';

export async function createShell({ cwd = '/workspace' } = {}) {
  await initBashkit();
  const bash = new Bash({ cwd, fs: createHost(), customBuiltins: { git: (ctx) => gitBuiltin(ctx.argv).then((text) => (text ? text + '\n' : '')) } });
  return {
    async run(command) {
      const result = await bash.execute(command);
      return { ok: result.exitCode === 0, exitCode: result.exitCode, signal: null, output: result.stdout + result.stderr };
    },
  };
}
