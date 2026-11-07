import { Buffer } from './shims/buffer.js';
import { flushFs, hydrate, mkdirSync, readdirSync } from './shims/fs.js';
import { posix } from './shims/path.js';
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

function completions(prefix, cwd) {
  const slash = prefix.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : prefix.slice(0, slash + 1);
  const base = prefix.slice(slash + 1);
  let entries;
  try {
    entries = readdirSync(posix.resolve(cwd, dirPart || '.'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name.startsWith(base) && (!entry.name.startsWith('.') || base.startsWith('.')))
    .map((entry) => dirPart + entry.name + (entry.isDirectory() ? '/' : ''))
    .sort();
}

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
  let cancelRequested = false;
  const overrides = {
    run_shell: async (args) => {
      if (args.background || hasBackgroundOperator(args.command)) return { ok: false, error: 'background jobs need the relay (?engine=relay); the in-page shell runs foreground commands only' };
      shell ??= await createShell({ cwd: WORKSPACE });
      if (cancelRequested) return { ok: false, exitCode: 130, signal: null, output: 'cancelled\n' };
      return shell.run(args.command);
    },
    ...gitVerbs,
  };
  const client = clientFrom(tools, { gmHome: gmPrefix, workspace: WORKSPACE, runDir }, overrides);
  await flushFs();
  postMessage({ ready: true });
  self.onmessage = async ({ data }) => {
    if (data.complete !== undefined) {
      postMessage({ id: data.id, ok: true, result: completions(data.complete, shell?.cwd() ?? WORKSPACE) });
      return;
    }
    if (data.query === 'cwd') {
      postMessage({ id: data.id, ok: true, result: shell?.cwd() ?? WORKSPACE });
      return;
    }
    if (data.cancel) {
      cancelRequested = true;
      shell?.cancel();
      return;
    }
    cancelRequested = false;
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
