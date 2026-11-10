import { runTjs, TJS_CANCELLED, TJS_TIMED_OUT } from './txiki-in-page.js';

const LIBS = new URL('./vendor/npm/npm-libs.js', import.meta.url).href;
const PROGRAM = new URL('./npm-program.js', import.meta.url).href;

let source = null;

const loadText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`npm: ${url} did not load`);
  return response.text();
};

const sourceText = () => {
  source ??= Promise.all([loadText(LIBS), loadText(PROGRAM)])
    .then(([libs, program]) => `${libs}\n${program}`)
    .catch((err) => {
      source = null;
      throw err;
    });
  return source;
};

const runNpmProgram = async (name, argv, cwd, options) => {
  const input = JSON.stringify({ name, argv, cwd });
  const { output, status } = await runTjs(`globalThis.__npmInput = ${input};\n${await sourceText()}`, cwd, options);
  if (status === TJS_CANCELLED) throw new Error('cancelled');
  if (status === TJS_TIMED_OUT) throw new Error('timeout: command timed out');
  if (status !== 0) throw new Error(output.trimEnd());
  return output.trimEnd();
};

export const npmBuiltin = (argv, cwd, options) => runNpmProgram('npm', argv, cwd, options);

export const npxBuiltin = (argv, cwd, options) => runNpmProgram('npx', argv, cwd, options);
