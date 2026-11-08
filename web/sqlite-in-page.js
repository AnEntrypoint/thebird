import { runTjs } from './txiki-in-page.js';
import { posix } from './shims/path.js';

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

const moduleSource = (path, statements) => `import { Database } from 'tjs:sqlite';
const cell = (value) => (value === null ? '' : String(value));
const db = new Database(${JSON.stringify(path)});
try {
  for (const sql of ${JSON.stringify(statements)}) {
    const stmt = db.prepare(sql);
    try {
      const rows = stmt.all();
      if (rows.length) console.log(rows.map((row) => Object.values(row).map(cell).join('|')).join('\\n'));
    } finally {
      stmt.finalize();
    }
  }
} finally {
  db.close();
}
`;

export async function sqliteBuiltin(argv, cwd = '/workspace') {
  const [file, ...sql] = argv;
  if (!file || sql.length === 0) throw new Error('sqlite3 <database> <sql>');
  const path = posix.resolve(cwd, file);
  const { output, status } = await runTjs(moduleSource(path, splitStatements(sql.join(' '))), cwd);
  if (status !== 0) throw new Error(output.trimEnd());
  return output.trimEnd();
}
