import { Buffer } from './shims/buffer.js';
import { flushFs, hydrate, mkdirSync, readdirSync } from './shims/fs.js';
import { posix } from './shims/path.js';
import { createShell, hasBackgroundOperator } from './bash-shell.js';
import { onPythonPhase } from './python-in-page.js';
import { clearCancel, setCancelWord } from './txiki-in-page.js';

const WORKSPACE = '/workspace';
globalThis.Buffer = Buffer;
onPythonPhase((phase, detail) => postMessage({ phase, detail }));
const BACKGROUND_REFUSED = 'background jobs are not supported in the in-page shell; run the command in the foreground';

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

try {
  await hydrate();
  mkdirSync(WORKSPACE, { recursive: true });
  const shell = await createShell({ cwd: WORKSPACE });
  await flushFs();
  postMessage({ ready: true });
  let queue = Promise.resolve();
  const answer = async (data) => {
    let reply;
    try {
      if (data.complete !== undefined) {
        const result = data.command ? shell.commands().filter((name) => name.startsWith(data.complete)) : completions(data.complete, shell.cwd());
        reply = { id: data.id, ok: true, result };
      } else if (data.query === 'cwd') {
        reply = { id: data.id, ok: true, result: shell.cwd() };
      } else if (hasBackgroundOperator(data.run)) {
        reply = { id: data.id, ok: false, error: BACKGROUND_REFUSED };
      } else {
        clearCancel();
        const result = await shell.run(data.run, { onOutput: (stdout, stderr) => postMessage({ output: stdout + stderr }) });
        reply = { id: data.id, ok: true, result };
      }
    } catch (err) {
      reply = { id: data.id, ok: false, error: err.message };
    }
    await flushFs();
    postMessage(reply);
  };
  self.onmessage = ({ data }) => {
    if (data.init) {
      setCancelWord(data.init.flag ? new Int32Array(data.init.flag) : null);
      return;
    }
    if (data.cancel) {
      shell.cancel();
      return;
    }
    if (data.resize) {
      shell.resize(data.resize);
      return;
    }
    queue = queue.then(() => answer(data)).catch((err) => postMessage({ id: data.id, ok: false, error: err.message }));
  };
} catch (err) {
  postMessage({ ready: false, error: err.message });
}
