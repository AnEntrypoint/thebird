import { Database } from 'tjs:sqlite';

const cell = (value) => (value === null ? '' : String(value));
const db = new Database(args.path);
try {
  for (const sql of args.statements) {
    const stmt = db.prepare(sql);
    try {
      const rows = stmt.all();
      if (rows.length) console.log(rows.map((row) => Object.values(row).map(cell).join('|')).join('\n'));
    } finally {
      stmt.finalize();
    }
  }
} finally {
  db.close();
}
