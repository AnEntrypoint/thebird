import { runTjs } from './txiki-in-page.js';
import { posix } from './shims/path.js';

const PROGRAM = new URL('./sqlite-program.js', import.meta.url).href;

let program = null;

const programText = () => {
  program ??= fetch(PROGRAM)
    .then((response) => {
      if (!response.ok) throw new Error(`sqlite3: ${PROGRAM} did not load`);
      return response.text();
    })
    .catch((err) => {
      program = null;
      throw err;
    });
  return program;
};

function splitStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  for (const c of sql) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    }
    current += c;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export async function sqliteBuiltin(argv, cwd = '/workspace') {
  const [file, ...sql] = argv;
  if (!file || sql.length === 0) throw new Error('sqlite3 <database> <sql>');
  const path = posix.resolve(cwd, file);
  const args = JSON.stringify({ path, statements: splitStatements(sql.join(' ')) });
  const { output, status } = await runTjs(`const args = ${args};\n${await programText()}`, cwd);
  if (status !== 0) throw new Error(output.trimEnd());
  return output.trimEnd();
}
