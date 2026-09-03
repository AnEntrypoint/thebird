// busybase-browser — minimal in-browser port of busybase's embedded mode that runs
// against thebird's plugkit-backed sqlite shim. Exposes the same Supabase-shaped
// from(table).select()/insert()/update()/delete()/eq()/etc. surface that public
// busybase apps use. Auth + realtime omitted (require Bun.password / EventEmitter);
// CRUD + filtering is full-fidelity.

import sqlite3InitModule from './sqlite-shim.js';

const validId = (s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
const qid = (s) => '`' + String(s).replace(/`/g, '``') + '`';
const ok = (data, count) => count !== undefined ? { data, error: null, count } : { data, error: null };
const err = (message, code = 400) => ({ data: null, error: { message, code } });

// Returns {sql, bind} where sql is a parameterized WHERE fragment and bind is the values array.
function toFilter(filters) {
    const parts = [];
    const bind = [];
    let rejected = 0;
    for (const f of filters) {
        if (f.startsWith('or=')) {
            const sub = f.slice(3).split(',');
            const orParts = [];
            for (const c of sub) {
                const d1 = c.indexOf('.'), d2 = c.indexOf('.', d1 + 1);
                if (d1 < 0 || d2 < 0) { rejected++; continue; }
                const col = c.slice(0, d1), op = c.slice(d1 + 1, d2), v = c.slice(d2 + 1);
                if (!validId(col)) { rejected++; continue; }
                const s = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
                if (!s) { rejected++; continue; }
                orParts.push(`${col} ${s} ?`);
                bind.push(v);
            }
            if (orParts.length) parts.push(`(${orParts.join(' OR ')})`);
            continue;
        }
        const dot = f.indexOf('.');
        if (dot < 0) { rejected++; continue; }
        const op = f.slice(0, dot), rest = f.slice(dot + 1);
        if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'].includes(op)) {
            const eq = rest.indexOf('=');
            if (eq < 0) { rejected++; continue; }
            const col = rest.slice(0, eq), val = rest.slice(eq + 1);
            if (!validId(col)) { rejected++; continue; }
            if (op === 'like') { parts.push(`${col} LIKE ?`); bind.push(val); }
            else if (op === 'ilike') { parts.push(`LOWER(${col}) LIKE LOWER(?)`); bind.push(val); }
            else {
                const s = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
                parts.push(`${col} ${s} ?`);
                bind.push(val);
            }
        } else if (op === 'is') {
            const eq = rest.indexOf('=');
            if (eq < 0) { rejected++; continue; }
            const col = rest.slice(0, eq), val = rest.slice(eq + 1).trim().toUpperCase();
            if (!validId(col) || !['NULL', 'TRUE', 'FALSE'].includes(val)) { rejected++; continue; }
            parts.push(`${col} IS ${val}`);
        } else if (op === 'in') {
            const eq = rest.indexOf('=');
            if (eq < 0) { rejected++; continue; }
            const col = rest.slice(0, eq), val = rest.slice(eq + 1);
            if (!validId(col)) { rejected++; continue; }
            const vals = val.split(',');
            parts.push(`${col} IN (${vals.map(() => '?').join(',')})`);
            bind.push(...vals);
        } else {
            rejected++;
        }
    }
    if (rejected > 0) throw new Error(`busybase: ${rejected} filter clause(s) rejected - check column names and filter format`);
    return { sql: parts.join(' AND '), bind };
}

const listeners = new Map(); // table -> Set<cb>
function emit(table, ev) {
    const set = listeners.get(table);
    if (set) for (const cb of set) try { cb(ev); } catch { /* swallow: a misbehaving subscriber must not block delivery to other listeners */ }
    const wild = listeners.get('*');
    if (wild) for (const cb of wild) try { cb(ev); } catch { /* swallow: a misbehaving wildcard subscriber must not block delivery to other listeners */ }
}

export async function createBusybase(opts = {}) {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(opts.url || ':memory:');
    const prefix = opts.tablePrefix || '';
    if (prefix && !validId(prefix)) throw new Error('busybase: invalid tablePrefix ' + prefix);
    const tbl = (name) => prefix + name;

    function tblExists(n) {
        const rows = db.exec({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", bind: [tbl(n)], rowMode: 'object', returnValue: 'resultRows' });
        return rows.length > 0;
    }
    function ensureCols(n, row) {
        const info = db.exec({ sql: `PRAGMA table_info(${tbl(n)})`, rowMode: 'object', returnValue: 'resultRows' });
        const existing = new Set(info.map(r => r.name));
        for (const k of Object.keys(row)) if (!existing.has(k)) db.exec(`ALTER TABLE ${tbl(n)} ADD COLUMN ${qid(k)}`);
    }
    function mkTbl(n, row) {
        const cols = Object.keys(row).map(k => qid(k)).join(', ');
        db.exec(`CREATE TABLE IF NOT EXISTS ${tbl(n)} (${cols})`);
    }
    function bindVal(v) {
        if (v == null) return null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (typeof v === 'number' || typeof v === 'string') return v;
        return String(v);
    }
    function getRows(n, where) {
        if (!tblExists(n)) return [];
        const { sql, bind } = where;
        return db.exec({ sql: `SELECT * FROM ${tbl(n)} WHERE ${sql}`, bind, rowMode: 'object', returnValue: 'resultRows' });
    }
    function getAllRows(n) {
        if (!tblExists(n)) return [];
        return db.exec({ sql: `SELECT * FROM ${tbl(n)}`, rowMode: 'object', returnValue: 'resultRows' });
    }
    function insertRow(n, row) {
        const keys = Object.keys(row);
        const ph = keys.map(() => '?').join(',');
        db.exec({ sql: `INSERT INTO ${tbl(n)} (${keys.map(qid).join(',')}) VALUES (${ph})`, bind: keys.map(k => bindVal(row[k])) });
    }
    function updateRow(n, data, where) {
        const keys = Object.keys(data).filter(k => k !== 'id');
        if (!keys.length) return;
        const { sql, bind: wBind } = where;
        db.exec({ sql: `UPDATE ${tbl(n)} SET ${keys.map(k => `${qid(k)}=?`).join(',')} WHERE ${sql}`, bind: [...keys.map(k => bindVal(data[k])), ...wBind] });
    }
    function deleteRow(n, where) {
        const { sql, bind } = where;
        db.exec({ sql: `DELETE FROM ${tbl(n)} WHERE ${sql}`, bind });
    }

    function Q(table, method, body) {
        const q = { filters: [], order: '', limit: 0, offset: 0, select: '*' };
        let _single = false, _maybe = false;
        const resolve = async () => {
            if (method === 'PATCH' || method === 'PUT') {
                const f = toFilter(q.filters);
                if (!f.sql) return err('No filter provided');
                if (!tblExists(table)) return err('Table not found', 404);
                const data = Array.isArray(body) ? body[0] : body;
                let ex = getRows(table, f);
                if (!ex.length) return ok([]);
                updateRow(table, data, f);
                let up = ex.map(r => ({ ...r, ...data }));
                for (let i = 0; i < up.length; i++) emit(table, { eventType: 'UPDATE', new: up[i], old: ex[i] });
                return ok(up);
            }
            if (method === 'DELETE') {
                const f = toFilter(q.filters);
                if (!f.sql) return err('No filter provided');
                if (!tblExists(table)) return err('Table not found', 404);
                const td = getRows(table, f);
                deleteRow(table, f);
                for (const r of td) emit(table, { eventType: 'DELETE', new: null, old: r });
                return ok([]);
            }
            const f = toFilter(q.filters);
            let rows = f.sql ? getRows(table, f) : getAllRows(table);
            if (q.select && q.select !== '*') {
                const cols = q.select.split(',').filter(c => validId(c.trim())).map(c => c.trim());
                rows = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
            }
            if (q.order) {
                const [col, dir] = q.order.split('.');
                if (validId(col)) rows.sort((a, b) => {
                    const av = a[col], bv = b[col];
                    const cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : (av > bv ? 1 : av < bv ? -1 : 0);
                    return dir === 'desc' ? -cmp : cmp;
                });
            }
            const lim = Math.max(0, q.limit || 1000), off = Math.max(0, q.offset || 0);
            const page = rows.slice(off, off + lim);
            if (_single) return page.length === 1 ? ok(page[0]) : err('JSON object requested, multiple (or no) rows returned', 406);
            if (_maybe) return ok(page[0] ?? null);
            return ok(page);
        };
        const b = {
            select: (c = '*') => (q.select = c, b),
            eq: (c, v) => (q.filters.push(`eq.${c}=${v}`), b),
            neq: (c, v) => (q.filters.push(`neq.${c}=${v}`), b),
            gt: (c, v) => (q.filters.push(`gt.${c}=${v}`), b),
            gte: (c, v) => (q.filters.push(`gte.${c}=${v}`), b),
            lt: (c, v) => (q.filters.push(`lt.${c}=${v}`), b),
            lte: (c, v) => (q.filters.push(`lte.${c}=${v}`), b),
            like: (c, v) => (q.filters.push(`like.${c}=${v}`), b),
            ilike: (c, v) => (q.filters.push(`ilike.${c}=${v}`), b),
            is: (c, v) => (q.filters.push(`is.${c}=${v}`), b),
            in: (c, vs) => (q.filters.push(`in.${c}=${vs.join(',')}`), b),
            or: (cl) => (q.filters.push(`or=${cl}`), b),
            order: (c, { ascending = true } = {}) => (q.order = `${c}.${ascending ? 'asc' : 'desc'}`, b),
            limit: (n) => (q.limit = n, b),
            offset: (n) => (q.offset = n, b),
            range: (from, to) => (q.offset = from, q.limit = to - from + 1, b),
            single: () => (_single = true, b),
            maybeSingle: () => (_maybe = true, b),
            then: (res, rej) => resolve().then(res, rej),
        };
        return b;
    }

    function from(table) {
        if (!validId(table)) throw new Error('busybase: invalid table name ' + table);
        return {
            select: (cols = '*') => Q(table).select(cols),
            insert: async (data) => {
                const rows = (Array.isArray(data) ? data : [data]).map(r => ({ id: r.id ?? crypto.randomUUID(), ...r }));
                if (!rows.length || !Object.keys(rows[0]).length) return err('Empty body');
                if (!tblExists(table)) mkTbl(table, rows[0]);
                for (const row of rows) ensureCols(table, row);
                db.transaction(() => {
                    for (const row of rows) insertRow(table, row);
                });
                for (const row of rows) emit(table, { eventType: 'INSERT', new: row, old: null });
                return ok(rows);
            },
            update: (data) => Q(table, 'PATCH', data),
            delete: () => Q(table, 'DELETE', null),
            upsert: async (data) => {
                const rows = (Array.isArray(data) ? data : [data]).map(r => ({ id: r.id ?? crypto.randomUUID(), ...r }));
                if (!tblExists(table)) mkTbl(table, rows[0]); else ensureCols(table, rows[0]);
                const emits = [];
                db.transaction(() => {
                    for (const r of rows) {
                        const idFilter = { sql: 'id=?', bind: [r.id] };
                        const ex = getRows(table, idFilter);
                        if (ex.length) {
                            updateRow(table, r, idFilter);
                            emits.push({ eventType: 'UPDATE', new: { ...ex[0], ...r }, old: ex[0] });
                        } else {
                            insertRow(table, r);
                            emits.push({ eventType: 'INSERT', new: r, old: null });
                        }
                    }
                });
                for (const e of emits) emit(table, e);
                return ok(rows);
            },
        };
    }

    function channel(name) {
        const handlers = [];
        const ch = {
            on: (type, opts, cb) => {
                handlers.push({ table: opts.table || '*', event: opts.event || '*', cb });
                return ch;
            },
            subscribe: (statusCb) => {
                for (const h of handlers) {
                    if (!listeners.has(h.table)) listeners.set(h.table, new Set());
                    const wrap = (ev) => { if (h.event === '*' || h.event === ev.eventType) h.cb(ev); };
                    listeners.get(h.table).add(wrap);
                    h._wrap = wrap;
                }
                if (statusCb) statusCb('SUBSCRIBED');
                return ch;
            },
            unsubscribe: () => {
                for (const h of handlers) {
                    const set = listeners.get(h.table);
                    if (set) set.delete(h._wrap);
                }
            },
        };
        return ch;
    }

    return { from, channel, _db: db, _sqlite3: sqlite3 };
}

export default { createBusybase };
