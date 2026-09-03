// thebird sqlite-wasm shim — exposes the @libsql/libsql-wasm-experimental /
// @sqlite.org/sqlite-wasm surface on top of the libsql already bundled into
// plugkit.wasm. Public apps that `import 'sqlite3-wasm'` or call
// `await sqlite3InitModule()` get a Database/PreparedStatement backed by
// plugkit dispatch instead of loading their own ~1MB sqlite-wasm.
//
// API mirrors the canonical OO1 layer:
//   const sqlite3 = await sqlite3InitModule();
//   const db = new sqlite3.oo1.DB();
//   db.exec("CREATE TABLE t(x)");
//   db.exec({ sql: "INSERT INTO t VALUES (?)", bind: [1] });
//   const rows = db.exec({ sql: "SELECT * FROM t", rowMode: "object", returnValue: "resultRows" });
//   db.close();

import { shortUid } from '../vendor/uid.js';

const SQLITE_OK = 0;
const SQLITE_ROW = 100;
const SQLITE_DONE = 101;

const noopFn = () => {};

function findGm() {
    // Look in current window, then any reachable parent frame (apps loaded inside an
    // iframe under thebird inherit the parent's plugkit boot).
    if (typeof window === 'undefined') return null;
    let w = window;
    for (let i = 0; i < 10; i++) {
        try {
            if (w.__debug && w.__debug.gm && typeof w.__debug.gm.dispatch === 'function') return w.__debug.gm;
        } catch { /* swallow: cross-origin frame, __debug is unreachable */ }
        if (!w.parent || w.parent === w) break;
        w = w.parent;
    }
    return null;
}

// 180s, not 30s: plugkit.wasm is ~149MB and cold-loads over the CDN in tens of
// seconds to a couple of minutes on a first visit. A 30s wait threw 'gm not
// available' (the waitForGm error seen in chat) while plugkit was still legitimately
// loading. 180s covers the cold-load; gm resolves the instant plugkit is ready.
//
// Event-driven, not polled: docs/freddie-host.js dispatches window 'freddie:gm-ready'
// (with 'freddie:gm-error'/'freddie:gm-degraded' on failure) on the SAME window
// findGm() searches, immediately after window.__debug.gm is assigned (see
// freddie-host.js ~L772-789, ~L1373). We race that event against a short poll
// (covers: gm already ready before this module loaded — the common case, since
// there's no "ready" event to listen for retroactively — and non-freddie-host boot
// paths, e.g. docs/vendor/busybase/embedded.js also assigns window.__debug.gm
// directly with no accompanying event) and a hard timeout. This eliminates the
// up-to-100ms post-ready latency and the steady-state 10/sec timer in the common
// case where freddie-host.js is the boot path, while staying correct when it isn't.
async function waitForGm(timeoutMs = 180000) {
    // Fast path: gm may already be present (e.g. this module loaded after boot).
    const immediate = findGm();
    if (immediate) return immediate;

    let settled = false;
    return new Promise((resolve, reject) => {
        const finish = (fn, val) => { if (settled) return; settled = true; cleanup(); fn(val); };
        const onReady = () => { const gm = findGm(); if (gm) finish(resolve, gm); };
        const onError = (e) => {
            // gm-error/gm-degraded means freddie-host gave up — no point continuing to
            // wait on the event; fall through to the poll below until timeout so a
            // gm that appears via a different path (e.g. busybase's direct assignment)
            // still resolves.
        };
        let win = (typeof window !== 'undefined') ? window : null;
        const listenTargets = [];
        if (win) {
            for (let w = win, i = 0; i < 10; i++) {
                try {
                    listenTargets.push(w);
                    if (!w.parent || w.parent === w) break;
                    w = w.parent;
                } catch { break; }
            }
        }
        for (const w of listenTargets) {
            try {
                w.addEventListener('freddie:gm-ready', onReady);
                w.addEventListener('freddie:gm-error', onError);
                w.addEventListener('freddie:gm-degraded', onReady); // degraded still sets __debug.gm
            } catch { /* swallow: cross-origin frame, cannot attach listeners on it */ }
        }
        // Poll fallback: catches boot paths with no ready event (busybase embedded.js
        // direct assignment) and closes the race-condition window where gm becomes
        // ready between the immediate check above and the listeners being attached.
        const pollInterval = setInterval(() => {
            const gm = findGm();
            if (gm) finish(resolve, gm);
        }, 100);
        const timer = setTimeout(() => {
            finish(reject, new Error('sqlite-shim: gm not available in this window or any parent frame within ' + timeoutMs + 'ms. Open this app inside thebird (os.html) so plugkit is loaded, or load freddie-host.js first.'));
        }, timeoutMs);
        function cleanup() {
            clearInterval(pollInterval);
            clearTimeout(timer);
            for (const w of listenTargets) {
                try {
                    w.removeEventListener('freddie:gm-ready', onReady);
                    w.removeEventListener('freddie:gm-error', onError);
                    w.removeEventListener('freddie:gm-degraded', onReady);
                } catch { /* swallow: cross-origin frame or already torn down, listener cleanup is best-effort */ }
            }
        }
    });
}

// NOTE: plugkit's sql_query/sql_exec dispatch verbs (docs/lib/freddie-host-plugkit.js)
// take a single opaque `sql` string body — there is no bind-parameter array in the
// wasm ABI to route real parameters through. This is TEXTUAL SUBSTITUTION, not
// parameterized binding: bindParams()/sqlLiteral() below quote-escape each bound
// value and splice it into the SQL text before it ever reaches wasm. Callers must
// never build identifiers, table/column names, or ORDER BY/LIMIT clauses from
// untrusted input through bind() — only literal value positions are safe here.
function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Uint8Array || v instanceof ArrayBuffer || (typeof Int8Array !== 'undefined' && v instanceof Int8Array)) {
        const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer || v);
        let hex = '';
        for (const b of bytes) hex += b.toString(16).padStart(2, '0');
        return "X'" + hex + "'";
    }
    const s = String(v);
    if (s.indexOf('\u0000') !== -1) {
        throw new SQLite3Error('sqlite-shim: bound string value contains an embedded NUL byte, which is not representable through text-substitution binding', 1);
    }
    return "'" + s.replace(/'/g, "''") + "'";
}

// Substitute ?/?N/:foo/$foo/@foo placeholders before dispatching to wasm.
function bindParams(sql, bind) {
    if (!bind || (Array.isArray(bind) && bind.length === 0)) return sql;
    const isArray = Array.isArray(bind);
    let out = '';
    let posIdx = 0;
    let inSingle = false;
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        if (ch === "'") { inSingle = !inSingle; out += ch; i++; continue; }
        if (inSingle) { out += ch; i++; continue; }
        if (ch === '?') {
            // Match ?, ?123 (positional)
            let j = i + 1;
            while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j++;
            if (j > i + 1) {
                const n = parseInt(sql.slice(i + 1, j), 10) - 1;
                if (isArray && (n < 0 || n >= bind.length)) throw new SQLite3Error('sqlite-shim: positional parameter ?' + (n + 1) + ' out of range (only ' + bind.length + ' bind arguments provided)', 1);
                out += sqlLiteral(isArray ? bind[n] : bind[String(n + 1)]);
            } else if (isArray) {
                out += sqlLiteral(bind[posIdx++]);
            } else {
                throw new SQLite3Error('sqlite-shim: bare ? placeholder not allowed with named bind object (use :name/$name/@name)', 1);
            }
            i = j;
            continue;
        }
        if ((ch === ':' || ch === '$' || ch === '@') && i + 1 < sql.length && /[a-zA-Z_]/.test(sql[i + 1])) {
            let j = i + 1;
            while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++;
            const name = sql.slice(i + 1, j);
            const key = isArray ? null : (bind[ch + name] !== undefined ? ch + name : (bind[name] !== undefined ? name : null));
            if (!isArray && key === null) throw new SQLite3Error('sqlite-shim: named parameter ' + ch + name + ' not found in bind object', 1);
            const val = isArray ? undefined : bind[key];
            out += sqlLiteral(val);
            i = j;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

class SQLite3Error extends Error {
    constructor(message, rc) {
        super(message);
        this.name = 'SQLite3Error';
        this.resultCode = rc || 0;
    }
}

function dispatchOnce(gm, verb, body) {
    try { return gm.dispatch(verb, body); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function dispatchOrThrow(gm, verb, body) {
    let r = dispatchOnce(gm, verb, body);
    if ((!r || r.ok === false) && verb === 'sql_open') {
        // Boot race: gm wrapper exists but plugkit's libsql subsystem hasn't finished init.
        // Synchronous retry burst (200ms wall budget) before bubbling.
        const t0 = Date.now();
        while ((!r || r.ok === false) && Date.now() - t0 < 200) {
            r = dispatchOnce(gm, verb, body);
        }
    }
    if (!r || r.ok === false) {
        const why = (r && (r.error || r.error_code || r.reason)) || JSON.stringify(r || null);
        const ctx = ' body=' + JSON.stringify(body);
        // Self-heal: persistent sql_open failure on the live page is almost always a stale
        // Service Worker holding an old shim/wasm pair. Unregister all SWs + clear caches +
        // reload — once. We gate on sessionStorage so we don't loop.
        if (verb === 'sql_open' && typeof navigator !== 'undefined' && navigator.serviceWorker) {
            try {
                if (!sessionStorage.getItem('sqlite-shim-self-heal')) {
                    sessionStorage.setItem('sqlite-shim-self-heal', '1');
                    Promise.resolve().then(async () => {
                        try {
                            const regs = await navigator.serviceWorker.getRegistrations();
                            await Promise.all(regs.map(r => r.unregister()));
                            if (typeof caches !== 'undefined') {
                                const keys = await caches.keys();
                                await Promise.all(keys.map(k => caches.delete(k)));
                            }
                        } catch { /* swallow: self-heal cleanup (SW unregister/cache clear) failed, reload anyway as last resort */ }
                        location.reload();
                    });
                }
            } catch { /* swallow: self-heal gate check/set on sessionStorage failed, fall through to throwing the original error */ }
        }
        throw new SQLite3Error('sqlite-shim ' + verb + ' failed: ' + why + ctx, 1);
    }
    return r;
}

// Tracks how many live Database instances share a given db_name so close()
// can free the plugkit-side handle only when the last owner releases it.
const dbRefCounts = new Map();

function parseSelectColumns(sql) {
    // Returns the list of result-column names in SELECT-clause order, or null
    // if the SQL doesn't have a parseable SELECT (e.g. `SELECT *`, EXPLAIN, etc.).
    const m = /^\s*SELECT\s+(?:DISTINCT\s+|ALL\s+)?([\s\S]*?)\s+FROM\s/i.exec(sql);
    if (!m) return null;
    const list = m[1];
    if (/^\s*\*\s*$/.test(list)) return null; // can't know order from *
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
        // Look for AS alias
        const asM = /\s+AS\s+["`]?([A-Za-z_][\w]*)["`]?\s*$/i.exec(expr);
        if (asM) return asM[1];
        // Plain identifier (possibly qualified)
        const idM = /([A-Za-z_][\w]*)\s*$/.exec(expr);
        if (idM) return idM[1];
        // Expression with implicit alias — fall back to the raw expression
        return expr.trim();
    });
}

class PreparedStatement {
    constructor(db, sql) {
        this._db = db;
        this._sql = sql;
        this._bindings = null;
        this._cachedRows = null;
        this._stepIndex = 0;
        this._columns = null;
        this._columnsRecovered = false; // true only when SELECT-clause order was parsed (not the alphabetical Object.keys fallback)
        this._finalized = false;
        this.parameterCount = (sql.match(/[?:$@]/g) || []).length;
        this.columnCount = 0;
    }
    bind(spec) {
        if (this._finalized) throw new SQLite3Error('statement finalized');
        this._bindings = spec;
        this._cachedRows = null;
        this._stepIndex = 0;
        return this;
    }
    clearBindings() { this._bindings = null; this._cachedRows = null; this._stepIndex = 0; return this; }
    reset(clearBindings) {
        this._cachedRows = null;
        this._stepIndex = 0;
        if (clearBindings) this._bindings = null;
        return this;
    }
    _ensureRun() {
        if (this._db._closed) throw new SQLite3Error('database is closed');
        if (this._cachedRows !== null) return;
        const bound = bindParams(this._sql, this._bindings);
        const trimmed = bound.trim().toUpperCase();
        const isQuery = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH') || trimmed.startsWith('EXPLAIN');
        if (isQuery) {
            const r = dispatchOrThrow(this._db._gm, 'sql_query', { sql: bound, path: ':memory:', db_name: this._db._db_name });
            const rawRows = (r.data && r.data.rows) || [];
            // Plugkit returns rows as plain objects without preserving SELECT column order
            // (Object.keys is alphabetical). Parse the SELECT clause to recover query order
            // so positional access (row[0], etc.) matches SQL expectations. parseSelectColumns
            // returns null for SELECT */JOIN/CTE/EXPLAIN — in that case the Object.keys fallback
            // is ALPHABETICAL, not SQL order, so positional access would be wrong: we mark
            // _columnsRecovered=false and throw on positional access (object mode is unaffected).
            const recovered = parseSelectColumns(bound);
            let columnsRecovered = recovered !== null;
            if (columnsRecovered && rawRows.length) {
                const rowKeys = Object.keys(rawRows[0]);
                columnsRecovered = recovered.length === rowKeys.length && recovered.every(name => rowKeys.includes(name));
            }
            this._columnsRecovered = columnsRecovered;
            this._columns = (columnsRecovered ? recovered : null) || (rawRows.length ? Object.keys(rawRows[0]) : []);
            this._cachedRows = rawRows;
            this.columnCount = this._columns.length;
        } else {
            dispatchOrThrow(this._db._gm, 'sql_exec', { sql: bound, path: ':memory:', db_name: this._db._db_name });
            this._cachedRows = [];
            this._columns = [];
            this.columnCount = 0;
        }
    }
    // Positional column access (by index) is only sound when SELECT-clause order was
    // recovered. For SELECT */JOIN/CTE/EXPLAIN the order is alphabetical, so by-index
    // reads would silently return the wrong column — fail loudly instead.
    _assertPositional() {
        if (!this._columnsRecovered) throw new SQLite3Error("sqlite-shim: positional column access not supported for SELECT */JOINs/CTEs/EXPLAIN (column order is not recoverable); use rowMode:'object' or explicit column names");
    }
    step() {
        if (this._finalized) throw new SQLite3Error('statement finalized');
        this._ensureRun();
        return this._stepIndex++ < this._cachedRows.length;
    }
    get(target) {
        if (this._cachedRows === null) this._ensureRun();
        if (this._stepIndex === 0 || this._stepIndex > this._cachedRows.length) return undefined;
        const row = this._cachedRows[this._stepIndex - 1];
        if (target === undefined) return row;
        if (Array.isArray(target)) {
            this._assertPositional();
            for (let i = 0; i < this._columns.length; i++) target[i] = row[this._columns[i]];
            return target;
        }
        if (typeof target === 'object' && target !== null) {
            for (const c of this._columns) target[c] = row[c];
            return target;
        }
        if (typeof target === 'number') { this._assertPositional(); return row[this._columns[target]]; }
        return row;
    }
    getString(col) { this._db.affirmOpen(); this._assertPositional(); return String(this._cachedRows[this._stepIndex - 1][this._columns[col]] ?? ''); }
    getInt(col) { this._db.affirmOpen(); this._assertPositional(); return Number(this._cachedRows[this._stepIndex - 1][this._columns[col]] || 0); }
    getFloat(col) { this._db.affirmOpen(); this._assertPositional(); return Number(this._cachedRows[this._stepIndex - 1][this._columns[col]] || 0); }
    getBlob(col) { this._db.affirmOpen(); this._assertPositional(); return this._cachedRows[this._stepIndex - 1][this._columns[col]] ?? null; }
    getJSON(col) {
        this._db.affirmOpen();
        this._assertPositional();
        const raw = this._cachedRows[this._stepIndex - 1][this._columns[col]];
        return raw == null ? null : JSON.parse(String(raw));
    }
    getColumnName(i) { this._ensureRun(); return this._columns[i]; }
    getColumnNames(target) { this._ensureRun(); target = target || []; for (const c of (this._columns || [])) target.push(c); return target; }
    getParamIndex(name) {
        const m = this._sql.match(new RegExp('[?:$@]' + name + '\\b'));
        return m ? 1 : 0;
    }
    finalize() { this._finalized = true; this._cachedRows = null; return undefined; }
    free() { return this.finalize(); }
    stepFinalize() { const more = this.step(); this.finalize(); return more; }
    stepReset() { const more = this.step(); this.reset(false); return more; }
}

// Derive a stable db_name from a filename. ':memory:' becomes a hash-tagged unique name
// so two `new oo1.DB(':memory:')` calls in different apps get different DBs by default.
// Filenames like 'file:foo.db' or '/tmp/foo' produce 'foo' so persistence keys are stable
// across reloads.
let _memCounter = 0;
function dbNameFromFilename(filename) {
    if (!filename || filename === ':memory:' || filename === 'file::memory:') {
        return 'mem_' + (++_memCounter).toString(36) + '_' + shortUid(4);
    }
    // Use the full path (including dir) so two `file:dirA/db.sqlite` and
    // `file:dirB/db.sqlite` derive different db_names. Strip leading 'file:' /
    // 'file://' and any leading slashes, then map all non-id chars to '_'.
    let s = String(filename).replace(/^file:\/?\/?/, '').replace(/\\/g, '/');
    s = s.replace(/^\/+/, '').replace(/\.[^.]+$/, '');
    return 'app_' + s.replace(/[^a-zA-Z0-9_]/g, '_');
}

class Database {
    constructor(filename, flags, vfs) {
        if (typeof filename === 'object' && filename !== null) {
            const opts = filename;
            filename = opts.filename;
            flags = opts.flags;
            vfs = opts.vfs;
        }
        this.filename = filename || ':memory:';
        this.flags = flags || 'c';
        this.vfsName = vfs || 'plugkit';
        this._db_name = dbNameFromFilename(this.filename);
        this._closed = false;
        this._inTransaction = false;
        this._gm = null;
        this._openStatements = 0;
        this._spCounter = 0;
        // Constructor is sync in OO1 — we lazy-init on first use.
        const earlyGm = findGm();
        if (earlyGm) {
            this._gm = earlyGm;
            this._init();
        }
        this.pointer = 1; // OO1 sometimes inspects truthiness; non-zero is "open"
        this.onclose = noopFn;
    }
    _init() {
        if (!this._gm) throw new SQLite3Error('sqlite-shim: plugkit gm not ready — call await sqlite3InitModule() first');
        // Browser has no real fs; every plugkit DB is :memory:. The filename is only used to
        // derive a stable db_name (isolation key + persistence snapshot key). Actual
        // persistence is opt-in via sql_serialize/IDB.
        dispatchOrThrow(this._gm, 'sql_open', { path: ':memory:', db_name: this._db_name });
        dbRefCounts.set(this._db_name, (dbRefCounts.get(this._db_name) || 0) + 1);
    }
    get dbName() { return this._db_name; }
    isOpen() { return !this._closed; }
    affirmOpen() { if (this._closed) throw new SQLite3Error('database is closed'); return this; }
    dbFilename() { return this.filename; }
    dbName() { return 'main'; }
    dbVfsName() { return this.vfsName; }
    openStatementCount() { return this._openStatements; }
    changes() { return 0; } // plugkit doesn't surface change count yet
    getRowsModified() { return this.changes(); }
    export() {
        this.affirmOpen();
        // sql.js-compatible: return the DB as a Uint8Array via plugkit sql_serialize.
        const r = this._gm.dispatch('sql_serialize', { path: ':memory:', db_name: this._db_name });
        const b64 = r && r.data && r.data.bytes_base64;
        if (!b64) return new Uint8Array();
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    lastInsertRowid() {
        this.affirmOpen();
        const r = this._gm.dispatch('sql_query', { sql: 'SELECT last_insert_rowid() AS i', path: ':memory:', db_name: this._db_name });
        const rows = (r && r.data && r.data.rows) || [];
        return rows.length ? BigInt(rows[0].i) : 0n;
    }
    getAutocommit() { return 1; }
    checkRc(rc) { if (rc !== SQLITE_OK) throw new SQLite3Error('rc=' + rc, rc); return this; }

    // exec has many overloads — normalize to {sql, bind?, rowMode?, returnValue?, resultRows?, callback?}
    exec(sqlOrOpts, opts) {
        this.affirmOpen();
        if (!this._gm) this._gm = findGm();
        if (!this._gm) throw new SQLite3Error('sqlite-shim: plugkit gm not ready');
        let sql, bind, rowMode = 'array', returnValue = 'this', resultRows = null, callback = null, columnNames = null;
        if (typeof sqlOrOpts === 'string' || sqlOrOpts instanceof ArrayBuffer || sqlOrOpts instanceof Uint8Array) {
            sql = typeof sqlOrOpts === 'string' ? sqlOrOpts : new TextDecoder().decode(sqlOrOpts);
            if (opts && typeof opts === 'object') ({ bind, rowMode = 'array', returnValue = 'this', resultRows = null, callback = null, columnNames = null } = opts);
        } else if (typeof sqlOrOpts === 'object' && sqlOrOpts !== null) {
            ({ sql, bind, rowMode = 'array', returnValue = 'this', resultRows = null, callback = null, columnNames = null } = sqlOrOpts);
            if (typeof sql !== 'string') sql = new TextDecoder().decode(sql);
        } else {
            throw new SQLite3Error('exec: sql required');
        }
        // Split sql on top-level semicolons (best-effort — ignores semicolons inside quoted strings).
        const statements = splitStatements(sql);
        const collected = resultRows || [];
        for (const stmt of statements) {
            if (!stmt.trim()) continue;
            const bound = bindParams(stmt, bind);
            const trimmed = bound.trim().toUpperCase();
            const isQuery = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH') || trimmed.startsWith('EXPLAIN');
            if (isQuery) {
                const r = dispatchOrThrow(this._gm, 'sql_query', { sql: bound, path: ':memory:', db_name: this._db_name });
                const rawRows = (r.data && r.data.rows) || [];
                // parseSelectColumns returns null for SELECT */JOIN/CTE/EXPLAIN; the Object.keys
                // fallback is ALPHABETICAL, not SQL order. Positional row modes (array / numeric)
                // would then read the wrong column, so fail loudly. Name-based modes (object / $name)
                // are unaffected and keep working.
                const recovered = parseSelectColumns(bound);
                const cols = recovered || (rawRows.length ? Object.keys(rawRows[0]) : []);
                const positional = rowMode === 'array' || typeof rowMode === 'number';
                if (positional && recovered === null) throw new SQLite3Error("sqlite-shim: positional rowMode (" + JSON.stringify(rowMode) + ") not supported for SELECT */JOINs/CTEs/EXPLAIN (column order is not recoverable); use rowMode:'object' or explicit column names");
                if (columnNames && recovered === null && rawRows.length) console.warn('[sqlite-shim] columnNames populated with alphabetical fallback order (SELECT column order not recoverable for complex query); do not rely on metadata order');
                if (columnNames) for (const c of cols) columnNames.push(c);
                for (const row of rawRows) {
                    let shaped;
                    if (rowMode === 'object') shaped = row;
                    else if (rowMode === 'array') shaped = cols.map(c => row[c]);
                    else if (typeof rowMode === 'number') shaped = row[cols[rowMode]];
                    else if (typeof rowMode === 'string' && rowMode.startsWith('$')) shaped = row[rowMode.slice(1)];
                    else shaped = row;
                    if (callback) callback(shaped);
                    if (returnValue === 'resultRows') collected.push(shaped);
                }
            } else {
                dispatchOrThrow(this._gm, 'sql_exec', { sql: bound, path: ':memory:', db_name: this._db_name });
            }
        }
        if (returnValue === 'resultRows') return collected;
        if (returnValue === 'saveSql') return statements;
        return this;
    }

    prepare(sql) {
        this.affirmOpen();
        if (!this._gm) this._gm = findGm();
        if (!this._gm) throw new SQLite3Error('sqlite-shim: plugkit gm not ready');
        this._openStatements++;
        const stmt = new PreparedStatement(this, sql);
        const origFinalize = stmt.finalize.bind(stmt);
        stmt.finalize = () => { this._openStatements--; return origFinalize(); };
        return stmt;
    }

    selectArray(sql, bind) {
        const rows = this.exec({ sql, bind, rowMode: 'array', returnValue: 'resultRows' });
        return rows[0];
    }
    selectArrays(sql, bind) {
        return this.exec({ sql, bind, rowMode: 'array', returnValue: 'resultRows' });
    }
    selectObject(sql, bind) {
        const rows = this.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });
        return rows[0];
    }
    selectObjects(sql, bind) {
        return this.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });
    }
    selectValue(sql, bind) {
        const rows = this.exec({ sql, bind, rowMode: 'array', returnValue: 'resultRows' });
        return rows[0] ? rows[0][0] : undefined;
    }
    selectValues(sql, bind) {
        const rows = this.exec({ sql, bind, rowMode: 'array', returnValue: 'resultRows' });
        return rows.map(r => r[0]);
    }

    transaction(cb) {
        this.exec('BEGIN');
        this._inTransaction = true;
        let cleanExit = false;
        try {
            const r = cb(this); this.exec('COMMIT'); cleanExit = true; return r;
        } catch (e) {
            try { this.exec('ROLLBACK'); cleanExit = true; } catch (rbErr) {
                // ROLLBACK failed: plugkit transaction state is unknown.
                // Leave _inTransaction=true so subsequent exec/close detect the corrupted state.
                const err = new SQLite3Error('transaction rollback failed: ' + rbErr.message + ' (database may be in undefined state)', rbErr.resultCode || 1);
                err.cause = e;
                throw err;
            }
            throw e;
        } finally {
            if (cleanExit) this._inTransaction = false;
        }
    }
    savepoint(cb) {
        const name = 'sp_' + (++this._spCounter);
        this.exec('SAVEPOINT ' + name);
        try { const r = cb(this); this.exec('RELEASE ' + name); return r; }
        catch (e) {
            try { this.exec('ROLLBACK TO ' + name); this.exec('RELEASE ' + name); }
            catch (cleanupErr) { throw new Error('savepoint cleanup failed: ' + cleanupErr.message + ' (savepoint ' + name + ' may be orphaned)', { cause: e }); }
            throw e;
        }
    }

    createFunction() {
        // Not supported via dispatch surface — fail loudly so apps know.
        throw new SQLite3Error('sqlite-shim: createFunction not supported (plugkit dispatch does not expose sqlite3_create_function)');
    }

    close() {
        if (this._closed) return;
        if (this._inTransaction) throw new SQLite3Error('sqlite-shim: cannot close database while a transaction is active');
        this._closed = true;
        this.pointer = 0;
        // Multiple page-side Database instances may share the same db_name (e.g.
        // successive createClient() calls in libsql-sqljs that close between
        // operations), so only free the plugkit-side handle once the last
        // referencing instance for this db_name has closed.
        const remaining = (dbRefCounts.get(this._db_name) || 1) - 1;
        if (remaining <= 0) {
            dbRefCounts.delete(this._db_name);
            try { if (this._gm) this._gm.dispatch('sql_close', { path: ':memory:', db_name: this._db_name }); } catch { /* swallow: plugkit-side close failed, page-side handle is already marked closed */ }
        } else {
            dbRefCounts.set(this._db_name, remaining);
        }
        try { if (typeof this.onclose === 'function') this.onclose({ db: this }); } catch { /* swallow: user-supplied onclose callback threw, close() must not fail because of it */ }
    }
}

function splitStatements(sql) {
    const out = [];
    let buf = '';
    let inSingle = false, inDouble = false, inBracket = false, inBacktick = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'" && !inDouble && !inBracket && !inBacktick) inSingle = !inSingle;
        else if (ch === '"' && !inSingle && !inBracket && !inBacktick) inDouble = !inDouble;
        else if (ch === '[' && !inSingle && !inDouble && !inBacktick) inBracket = true;
        else if (ch === ']' && inBracket) inBracket = false;
        else if (ch === '`' && !inSingle && !inDouble && !inBracket) inBacktick = !inBacktick;
        if (ch === ';' && !inSingle && !inDouble && !inBracket && !inBacktick) {
            out.push(buf);
            buf = '';
            continue;
        }
        buf += ch;
    }
    if (buf.trim()) out.push(buf);
    return out;
}

// Build the sqlite3 namespace shape the official wasm package exposes.
function buildSqlite3Namespace(gm) {
    const oo1 = {
        DB: Database,
        OpfsDb: Database,
        JsStorageDb: Database,
        OpfsSAHPoolDatabase: Database,
    };
    return {
        version: { libVersion: 'plugkit-libsql', sourceId: 'thebird-sqlite-shim' },
        oo1,
        capi: {
            sqlite3_libversion: () => 'plugkit-libsql',
            sqlite3_sourceid: () => 'thebird-sqlite-shim',
        },
        wasm: {},
        config: { useStdAlloc: false },
        vfs: { installVfs: () => {}, getVfsList: () => ['plugkit'] },
        SQLite3Error,
        WasmAllocError: class WasmAllocError extends Error {},
        // installOpfsSAHPoolVfs is what apps probe for OPFS support — we return a fake stub.
        installOpfsSAHPoolVfs: async () => ({
            OpfsSAHPoolUtil: class {},
            sqlite3: null,
            removeVfs: () => {},
        }),
        __thebirdPlugkitBacked: true,
    };
}

// Fallback path: plugkit never became available (waitForGm threw/timed out). Try
// loading the OFFICIAL @sqlite.org/sqlite-wasm package from esm.sh — same CDN +
// ?bundle&target=es2022 pattern used by docs/shell-npm.js's installOne() — as a
// genuine alternate backend so apps depending on this shim still work without
// plugkit (e.g. plugkit.wasm cold-load pathologically slow, or gm unavailable in
// this deployment entirely).
//
// Completeness: @sqlite.org/sqlite-wasm's sqlite3InitModule() returns the SAME
// upstream oo1.DB/PreparedStatement/capi shape this shim was written to mirror
// (see file header), so when the CDN load + init succeeds this is a fully working
// alternate backend for the exec/prepare/bind/step/close path already implemented
// here — not a stub. What it does NOT do: translate plugkit-specific extensions
// (sql_serialize-backed export()/persistence semantics, the self-heal SW-clear
// logic, the parseSelectColumns column-order recovery which the real wasm build
// doesn't need since it returns real result-set metadata) — those are simply
// unnecessary against a real sqlite3 engine, so callers get the genuine upstream
// object, not our shim's DB class, once this path is taken.
async function loadOfficialSqliteWasmFallback() {
    const CDN_URL = 'https://esm.sh/@sqlite.org/sqlite-wasm@latest?bundle&target=es2022';
    const RETRIES = 3;
    const TIMEOUTS = [10000, 15000, 20000];
    let lastErr;
    for (let i = 0; i < RETRIES; i++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUTS[i]);
        try {
            // Dynamic import doesn't take an AbortSignal directly; race it against the
            // same timeout budget used elsewhere in this codebase for CDN fetches.
            const mod = await Promise.race([
                import(/* @vite-ignore */ CDN_URL),
                new Promise((_, rej) => { ctrl.signal.addEventListener('abort', () => rej(new Error('timed out loading @sqlite.org/sqlite-wasm from esm.sh'))); }),
            ]);
            clearTimeout(t);
            const init = mod.default || mod.sqlite3InitModule || mod;
            if (typeof init !== 'function') throw new Error('esm.sh module for @sqlite.org/sqlite-wasm has no callable sqlite3InitModule export');
            const ns = await init({});
            if (!ns || !ns.oo1 || typeof ns.oo1.DB !== 'function') throw new Error('@sqlite.org/sqlite-wasm loaded but did not return the expected oo1.DB API shape');
            return ns;
        } catch (e) {
            clearTimeout(t);
            lastErr = e;
        }
    }
    throw lastErr;
}

let _initPromise = null;
export default async function sqlite3InitModule(_opts) {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        let gm;
        try {
            gm = await waitForGm();
        } catch (plugkitErr) {
            let fallback;
            try {
                fallback = await loadOfficialSqliteWasmFallback();
            } catch (fallbackErr) {
                // Both paths genuinely failed — say so explicitly rather than picking one
                // error to surface, so the caller knows plugkit AND the CDN fallback were
                // both tried.
                throw new Error(
                    'sqlite-shim: no working sqlite backend. plugkit path failed: ' + (plugkitErr && plugkitErr.message || plugkitErr) +
                    ' | @sqlite.org/sqlite-wasm CDN fallback also failed: ' + (fallbackErr && fallbackErr.message || fallbackErr)
                );
            }
            console.warn('[sqlite-shim] plugkit gm unavailable (' + (plugkitErr && plugkitErr.message || plugkitErr) + '); using @sqlite.org/sqlite-wasm CDN fallback instead. Note: this is the REAL upstream sqlite3 namespace, not plugkit-backed — persistence/self-heal behavior specific to the plugkit path does not apply.');
            if (typeof globalThis !== 'undefined') globalThis.sqlite3 = fallback;
            return fallback;
        }
        const ns = buildSqlite3Namespace(gm);
        if (typeof globalThis !== 'undefined') globalThis.sqlite3 = ns;
        return ns;
    })();
    return _initPromise;
}

export { Database, PreparedStatement, SQLite3Error, sqlite3InitModule };
