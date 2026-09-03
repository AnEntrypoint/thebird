// Bridges thebird's sqlite-shim (oo1.DB) to the @libsql/client Client shape that
// busybase's embedded.js expects: { execute({sql,args}|sql) -> {rows, columns, rowsAffected, lastInsertRowid} }.
// Note: rowsAffected delegates to db.changes() which returns 0 until plugkit surfaces sql_changes().

import sqlite3InitModule from './sqlite-shim.js';

function bindLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
        const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v;
        let hex = '';
        for (const b of bytes) hex += b.toString(16).padStart(2, '0');
        return `X'${hex}'`;
    }
    return `'${String(v).replace(/'/g, "''")}'`;
}

function parseSelectColumns(sql) {
    const m = /^\s*SELECT\s+(?:DISTINCT\s+|ALL\s+)?([\s\S]*?)\s+FROM\s/i.exec(sql);
    if (!m) return null;
    const list = m[1];
    if (/^\s*\*\s*$/.test(list)) return null;
    const out = [];
    let depth = 0, buf = '', inSingle = false, inDouble = false;
    for (let i = 0; i < list.length; i++) {
        const ch = list[i];
        if (!inSingle && !inDouble && ch === '(') { depth++; buf += ch; continue; }
        if (!inSingle && !inDouble && ch === ')') { depth--; buf += ch; continue; }
        if (!inDouble && ch === "'") { inSingle = !inSingle; buf += ch; continue; }
        if (!inSingle && ch === '"') { inDouble = !inDouble; buf += ch; continue; }
        if (ch === ',' && depth === 0 && !inSingle && !inDouble) {
            out.push(buf.trim()); buf = '';
        } else buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.map(expr => {
        const asM = /\s+AS\s+["`]?([A-Za-z_][\w]*)["`]?\s*$/i.exec(expr);
        if (asM) return asM[1];
        const idM = /([A-Za-z_][\w]*)\s*$/.exec(expr);
        if (idM) return idM[1];
        return expr.trim();
    });
}

function orderedColumns(sql, out) {
    const parsed = parseSelectColumns(typeof sql === 'string' ? sql : String(sql));
    if (parsed && out.length && parsed.every(c => Object.prototype.hasOwnProperty.call(out[0], c))) {
        return { cols: parsed, reliable: true };
    }
    return { cols: out.length ? Object.keys(out[0]) : [], reliable: false };
}

function bindSql(sql, args) {
    if (!args || (Array.isArray(args) && args.length === 0)) return sql;
    if (!Array.isArray(args)) {
        // Named args — let sqlite-shim handle via its own bindParams pipeline
        return { _named: true, sql, args };
    }
    let out = '', i = 0, inSingle = false, posIdx = 0;
    while (i < sql.length) {
        const ch = sql[i];
        if (ch === "'") { inSingle = !inSingle; out += ch; i++; continue; }
        if (inSingle) { out += ch; i++; continue; }
        if (ch === '?') {
            let j = i + 1;
            while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j++;
            if (j > i + 1) {
                const n = parseInt(sql.slice(i + 1, j), 10) - 1;
                if (n < 0 || n >= args.length) throw new Error('bindSql: positional parameter ?' + (n + 1) + ' out of range (only ' + args.length + ' bind arguments provided)');
                out += bindLiteral(args[n]);
            } else {
                if (posIdx >= args.length) throw new Error('bindSql: positional parameter ?' + (posIdx + 1) + ' out of range (only ' + args.length + ' bind arguments provided)');
                out += bindLiteral(args[posIdx++]);
            }
            i = j; continue;
        }
        out += ch; i++;
    }
    return out;
}

export function createClient({ url } = {}) {
    let _db = null;
    let _readyPromise = null;
    let _closed = false;
    const ensure = async () => {
        if (_closed) throw new Error('client is closed');
        if (_db) return _db;
        if (_readyPromise) return _readyPromise;
        _readyPromise = (async () => {
            try {
                const sqlite3 = await sqlite3InitModule();
                _db = new sqlite3.oo1.DB(url || ':memory:');
                return _db;
            } catch (e) {
                _readyPromise = null;
                throw e;
            }
        })();
        return _readyPromise;
    };

    async function execute(stmt) {
        const db = await ensure();
        let sql, args;
        if (typeof stmt === 'string') { sql = stmt; args = []; }
        else if (stmt && typeof stmt === 'object') { sql = stmt.sql; args = stmt.args || []; }
        else throw new Error('execute: missing sql');
        const bound = bindSql(sql, args);
        if (bound && typeof bound === 'object' && bound._named) {
            // Named bindings — pass through to shim's exec which handles them
            const out = db.exec({ sql: bound.sql, bind: bound.args, rowMode: 'object', returnValue: 'resultRows' });
            const { cols, reliable } = orderedColumns(bound.sql, out);
            const rows = reliable ? out.map(row => { const arr = cols.map(c => row[c]); for (const c of cols) arr[c] = row[c]; return arr; }) : out;
            // rowsAffected: db.changes() returns 0 until plugkit surfaces sql_changes()
            return { rows, columns: cols, rowsAffected: 0, lastInsertRowid: undefined, toJSON() { return { rows: out, columns: cols, rowsAffected: 0 }; } };
        }
        const trimmed = bound.trim().toUpperCase();
        const isQuery = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH') || trimmed.startsWith('EXPLAIN');
        if (isQuery) {
            const out = db.exec({ sql: bound, rowMode: 'object', returnValue: 'resultRows' });
            const { cols, reliable } = orderedColumns(bound, out);
            const rows = reliable ? out.map(row => { const arr = cols.map(c => row[c]); for (const c of cols) arr[c] = row[c]; return arr; }) : out;
            return { rows, columns: cols, rowsAffected: 0, lastInsertRowid: undefined, toJSON() { return { rows: out, columns: cols, rowsAffected: 0 }; } };
        }
        db.exec(bound);
        let lastInsertRowid;
        try { const rid = db.lastInsertRowid && db.lastInsertRowid(); lastInsertRowid = typeof rid === 'bigint' ? rid : (rid != null ? BigInt(rid) : undefined); } catch { lastInsertRowid = undefined; }
        // rowsAffected: db.changes() returns 0 until plugkit surfaces sql_changes()
        let rowsAffected = 0;
        try { rowsAffected = db.changes ? db.changes() : 0; } catch { /* swallow: db.changes() unsupported/failed on this shim, report 0 affected rows */ }
        return { rows: [], columns: [], rowsAffected, lastInsertRowid, toJSON() { return { rows: [], columns: [], rowsAffected }; } };
    }

    return {
        execute,
        async batch(stmts) { const out = []; for (const s of stmts) out.push(await execute(s)); return out; },
        async transaction() {
            await execute('BEGIN');
            let done = false;
            return {
                execute,
                async commit() { if (done) return; done = true; await execute('COMMIT'); },
                async rollback() { if (done) return; done = true; await execute('ROLLBACK'); },
                async close() { if (done) return; try { await execute('ROLLBACK'); } finally { done = true; } },
            };
        },
        async sync() {},
        close() { if (_closed) return; _closed = true; if (_db) { try { _db.close(); } catch { /* swallow: underlying shim db already closed/errored, client-level close is idempotent */ } } },
        get closed() { return _closed; },
        get protocol() { return 'plugkit-via-sqlite-shim'; },
    };
}

export default { createClient };
