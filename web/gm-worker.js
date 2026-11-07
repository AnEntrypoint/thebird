import { Buffer } from './shims/buffer.js';
import { flushFs, hydrate, mkdirSync } from './shims/fs.js';
import { createShell, hasBackgroundOperator } from './bash-shell.js';
import { gitVerbs } from './git-in-page.js';

const WORKSPACE = '/workspace';
globalThis.Buffer = Buffer;
globalThis.process = {
  platform: 'linux',
  env: {},
  argv: [],
  pid: 1,
  execPath: '/bin/node',
  exitCode: undefined,
  cwd: () => WORKSPACE,
  kill: () => false,
  on() {},
  emitWarning() {},
};

const gmPrefix = new URL(self.location.href).searchParams.get('gm') === 'raw' ? '/gm-raw' : '/gm';
const runDir = `${WORKSPACE}/.thebird/run`;

try {
  await hydrate();
  mkdirSync(runDir, { recursive: true });
  const [{ createTools }, { openLog }, { clientFrom }] = await Promise.all([
    import(`${gmPrefix}/tools.mjs`),
    import(`${gmPrefix}/log.mjs`),
    import('/src/gm-client.js'),
  ]);
  const tools = createTools({ workspace: WORKSPACE, runDir, log: openLog(`${runDir}/log.jsonl`), background: false });
  let shell;
  const overrides = {
    run_shell: async (args) => {
      if (args.background || hasBackgroundOperator(args.command)) return { ok: false, error: 'background jobs need the relay (?engine=relay); the in-page shell runs foreground commands only' };
      shell ??= await createShell({ cwd: WORKSPACE });
      return shell.run(args.command);
    },
    ...gitVerbs,
  };
  const client = clientFrom(tools, { gmHome: gmPrefix, workspace: WORKSPACE, runDir }, overrides);
  await flushFs();
  postMessage({ ready: true });
  self.onmessage = async ({ data }) => {
    let reply;
    try {
      reply = { id: data.id, ok: true, result: await client.call(data.verb, data.args ?? {}) };
    } catch (err) {
      reply = { id: data.id, ok: false, error: err.message };
    }
    await flushFs();
    postMessage(reply);
  };
} catch (err) {
  postMessage({ ready: false, error: err.message });
}
