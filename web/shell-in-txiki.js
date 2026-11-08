import { runTjs } from './txiki-in-page.js';
import { flushFs } from './shims/fs.js';
import { pythonBuiltin, pipBuiltin } from './python-in-page.js';

const MODULES = ['shell-sed.js', 'shell-tar.js', 'shell-jq.js', 'shell-awk.js', 'shell-core.js', 'shell-program.js'];
const MARKER = '\u0001';
const BUILTINS = ['git', 'sqlite3', 'python3', 'pip', 'qjs', 'tjs', 'node', 'curl', 'wget'];
const SERVED = new Map([
  ['python3', (argv, signal) => pythonBuiltin(argv, signal)],
  ['pip', (argv, signal) => pipBuiltin(argv, signal)],
]);
const REFUSED_CAUSE = 'runs its own txiki engine, and the txiki shell cannot start a second engine run while this one is live';
const withNewline = (text) => (text ? text + '\n' : '');

const bridgedBuiltin = (name, argv, cwd, signal) => {
  const serve = SERVED.get(name);
  if (!serve) return Promise.reject(new Error(`${name}: not available in the txiki shell: it ${REFUSED_CAUSE}`));
  return serve(argv, signal).then(withNewline);
};

let source = null;

const loadText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`shell: ${url} did not load`);
  return response.text();
};

const programText = () => {
  source ??= Promise.all(MODULES.map((name) => loadText(new URL(`./${name}`, import.meta.url).href)))
    .then((texts) => texts.map((text) => text.replace(/^import .*;$/gm, '').replace(/^export /gm, '')).join('\n'))
    .catch((err) => {
      source = null;
      throw err;
    });
  return source;
};

export async function runShellInTxiki(script, { cwd = '/workspace', saved = null, timeoutMs, signal } = {}) {
  const args = JSON.stringify({ script, cwd, saved, timeoutMs, builtins: BUILTINS });
  const { output, status } = await runTjs(`const args = ${args};\n${await programText()}`, cwd, { signal, timeoutMs, builtin: bridgedBuiltin });
  await flushFs();
  const at = output.lastIndexOf(MARKER);
  if (status !== 0 || at < 0) throw new Error([output.trimEnd(), `shell engine exited with status ${status}`].filter(Boolean).join('\n'));
  const { stdout, stderr, exitCode, saved: next } = JSON.parse(output.slice(at + 1));
  return { ok: exitCode === 0, exitCode, stdout, stderr, saved: next };
}
