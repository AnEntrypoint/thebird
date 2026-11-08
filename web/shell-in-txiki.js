import { runTjs } from './txiki-in-page.js';
import { flushFs } from './shims/fs.js';
import { BUILTIN_NAMES, runBuiltin } from './builtins.js';

const MODULES = ['shell-sed.js', 'shell-tar.js', 'shell-jq.js', 'shell-awk.js', 'shell-core.js', 'shell-program.js'];
const MARKER = '\u0001';
const withNewline = (text) => (text ? text + '\n' : '');

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

const bridgedBuiltin = (timeoutMs) => (name, argv, cwd, signal) => runBuiltin(name, argv, { cwd, signal, timeoutMs }).then(withNewline);

export async function runShellInTxiki(script, { cwd = '/workspace', saved = null, timeoutMs, signal } = {}) {
  const args = JSON.stringify({ script, cwd, saved, timeoutMs, builtins: BUILTIN_NAMES });
  const { output, status } = await runTjs(`const args = ${args};\n${await programText()}`, cwd, { signal, timeoutMs, builtin: bridgedBuiltin(timeoutMs) });
  await flushFs();
  const at = output.lastIndexOf(MARKER);
  if (status !== 0 || at < 0) throw new Error([output.trimEnd(), `shell engine exited with status ${status}`].filter(Boolean).join('\n'));
  const { stdout, stderr, exitCode, saved: next } = JSON.parse(output.slice(at + 1));
  return { ok: exitCode === 0, exitCode, stdout, stderr, saved: next };
}
