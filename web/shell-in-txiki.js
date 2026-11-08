import { runTjs } from './txiki-in-page.js';

const CORE = new URL('./shell-core.js', import.meta.url).href;
const PROGRAM = new URL('./shell-program.js', import.meta.url).href;
const MARKER = '\u0001';
const BUILTINS = ['git', 'sqlite3', 'python3', 'pip', 'qjs', 'tjs', 'node', 'curl', 'wget'];

let source = null;

const loadText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`shell: ${url} did not load`);
  return response.text();
};

const programText = () => {
  source ??= Promise.all([loadText(CORE), loadText(PROGRAM)])
    .then(([core, program]) => `${core.replace(/^export /gm, '')}\n${program}`)
    .catch((err) => {
      source = null;
      throw err;
    });
  return source;
};

export async function runShellInTxiki(script, { cwd = '/workspace', saved = null, timeoutMs, signal } = {}) {
  const args = JSON.stringify({ script, cwd, saved, timeoutMs, builtins: BUILTINS });
  const { output, status } = await runTjs(`const args = ${args};\n${await programText()}`, cwd, { signal });
  const at = output.lastIndexOf(MARKER);
  if (status !== 0 || at < 0) throw new Error([output.trimEnd(), `shell engine exited with status ${status}`].filter(Boolean).join('\n'));
  const { stdout, stderr, exitCode, saved: next } = JSON.parse(output.slice(at + 1));
  return { ok: exitCode === 0, exitCode, stdout, stderr, saved: next };
}
