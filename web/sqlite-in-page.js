import * as fsp from './shims/fs-promises.js';
import { posix } from './shims/path.js';

const DIR = '/workspace';
const SQLJS_DIR = new URL('./vendor/sqljs', import.meta.url).href;

let sqlJs;
const loadSqlJs = () => {
  sqlJs ??= (async () => {
    const source = await (await fetch(`${SQLJS_DIR}/sql-wasm-browser.js`)).text();
    const module = { exports: {} };
    new Function('module', 'exports', source)(module, module.exports);
    return module.exports({ locateFile: (file) => `${SQLJS_DIR}/${file}` });
  })();
  return sqlJs;
};

const cell = (value) => (value === null ? '' : String(value));

export async function sqliteBuiltin(argv) {
  const [file, ...statements] = argv;
  if (!file || statements.length === 0) throw new Error('sqlite3 <database> <sql>');
  const SQL = await loadSqlJs();
  const path = posix.resolve(DIR, file);
  let bytes = null;
  try {
    bytes = await fsp.readFile(path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  try {
    const results = db.exec(statements.join(' '));
    const output = results
      .map(({ values }) => values.map((row) => row.map(cell).join('|')).join('\n'))
      .filter(Boolean)
      .join('\n');
    await fsp.writeFile(path, db.export());
    return output;
  } finally {
    db.close();
  }
}
