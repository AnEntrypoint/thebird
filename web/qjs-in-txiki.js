import { runTjs } from './txiki-in-page.js';

const PROGRAM = new URL('./qjs-program.js', import.meta.url).href;
const DIR = '/workspace';

let program = null;

const programText = () => {
  program ??= fetch(PROGRAM)
    .then((response) => {
      if (!response.ok) throw new Error(`qjs: ${PROGRAM} did not load`);
      return response.text();
    })
    .catch((err) => {
      program = null;
      throw err;
    });
  return program;
};

export async function qjsBuiltin(argv) {
  if (argv.length !== 2 || argv[0] !== '-e') throw new Error('usage: qjs -e <code>');
  const args = JSON.stringify({ code: argv[1] });
  const { output, status } = await runTjs(`const args = ${args};\n${await programText()}`, DIR);
  if (status !== 0) throw new Error(output.trimEnd());
  return output.trimEnd();
}
