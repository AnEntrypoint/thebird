import { runTjs } from './txiki-in-page.js';

const PROGRAM = new URL('./git-program.js', import.meta.url).href;
const ISOMORPHIC = new URL('./vendor/isomorphic-git.mjs', import.meta.url).href;
const ACORN = new URL('./vendor/acorn.mjs', import.meta.url).href;
const GATE = new URL('./commit-gate.js', import.meta.url).href;
const BUFFER = new URL('./shims/buffer.js', import.meta.url).href;
const DIR = '/workspace';
const REMOTE_VERBS = new Set(['clone', 'fetch', 'pull', 'push']);

let sources = null;

const textOf = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`git: ${url} did not load`);
  return response.text();
};

const loadSources = () => {
  sources ??= Promise.all([PROGRAM, ISOMORPHIC, ACORN, GATE, BUFFER].map(textOf))
    .then(([program, isomorphic, acorn, gate, buffer]) => ({ program, isomorphic, acorn, gate, buffer }), (err) => {
      sources = null;
      throw err;
    });
  return sources;
};

const moduleBody = (text) => text.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '');

const namespaceFactory = (text) => {
  const match = [...text.matchAll(/export\s*\{([^}]*)\}\s*;?/g)].at(-1);
  if (!match) throw new Error('git: a vendored module has no export list');
  const exported = match[1].split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [local, alias] = item.split(/\s+as\s+/);
    return `${alias ?? local}: ${local}`;
  });
  return `(function () {\n${text.slice(0, match.index)}\nreturn { ${exported.join(', ')} };\n})()`;
};

const programFor = ({ program, isomorphic, acorn, gate, buffer }, argv) => [
  'const native = globalThis.__thebirdFs;',
  'delete globalThis.__thebirdFs;',
  `globalThis.Buffer = (function () {\n${moduleBody(buffer)}\nreturn Buffer;\n})();`,
  program,
  'const fsp = makeFsp(native);',
  `const isomorphic = ${namespaceFactory(isomorphic)}.default;`,
  `const acornModule = ${namespaceFactory(acorn)};`,
  `const gate = (function (parse, fsp) {\n${moduleBody(gate)}\nreturn { runCommitGate, NOT_COVERED };\n})(acornModule.parse, fsp);`,
  `try {\n  console.log(await gitMain(${JSON.stringify(argv)}, ${JSON.stringify(DIR)}));\n} catch (err) {\n  throw new Error(String(err?.message ?? err));\n}`,
].join('\n');

const failureText = (output) => output.split('\n')
  .map((line) => line.replace(/^Uncaught (Error: )?/, ''))
  .join('\n')
  .trim() || 'git failed';

export async function gitBuiltin(argv) {
  const [sub] = argv;
  if (REMOTE_VERBS.has(sub)) throw new Error(`git ${sub}: remote access is refused in the in-page shell before any request is made`);
  const { output, status } = await runTjs(programFor(await loadSources(), argv), DIR);
  if (status !== 0) throw new Error(failureText(output));
  return output.trimEnd();
}
