import { EventEmitter } from './node-events-shim.js';
import './bun-shim.js';
import { createClient as plugkitCreateClient } from '../../lib/sqlite-shim-libsql-client-adapter.js';

// Use the locally-vendored plugkit.wasm (docs/vendor/gm/plugkit.wasm), not
// github.com release downloads. release.tag URLs are CORS-blocked from
// gh-pages origins (no Access-Control-Allow-Origin header), so cross-origin
// fetch from https://anentrypoint.github.io fails with net::ERR_FAILED,
// halting validate.html harness at iframe-gm-load forever. Vendored copy
// sits next to the bundle and serves with correct content-type.
const PLUGKIT_WASM_URL = new URL('../gm/plugkit.wasm', import.meta.url).href;

let _plugkitBootPromise = null;

function findExistingGm() {
    if (typeof window === 'undefined') return null;
    let w = window;
    for (let i = 0; i < 10; i++) {
        try { if (w.__debug && w.__debug.gm && typeof w.__debug.gm.dispatch === 'function') return w.__debug.gm; } catch {}
        if (!w.parent || w.parent === w) break;
        w = w.parent;
    }
    return null;
}

function makeWasiShim(getMemory) {
    const BADF = 8;
    const ok = () => 0;
    const fd_write = (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
        try {
            const dv = new DataView(getMemory());
            let total = 0;
            const chunks = [];
            for (let i = 0; i < iovs_len; i++) {
                const base = iovs_ptr + i * 8;
                const ptr = dv.getUint32(base, true);
                const len = dv.getUint32(base + 4, true);
                if (len > 0) { chunks.push(new Uint8Array(getMemory(), ptr, len).slice()); total += len; }
            }
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.length; }
            const text = new TextDecoder('utf-8').decode(merged);
            try { (fd === 2 ? console.warn : console.log)('[plugkit-wasm]', text); } catch {}
            new DataView(getMemory()).setUint32(nwritten_ptr, total, true);
            return 0;
        } catch { return 28; }
    };
    const random_get = (buf_ptr, buf_len) => {
        try { crypto.getRandomValues(new Uint8Array(getMemory(), buf_ptr, buf_len)); return 0; } catch { return 28; }
    };
    const clock_time_get = (_id, _prec, time_ptr) => {
        try { new DataView(getMemory()).setBigUint64(time_ptr, BigInt(Date.now()) * 1000000n, true); return 0; } catch { return 28; }
    };
    const fd_seek = (_fd, _o_lo, _o_hi, _w, newoffset_ptr) => {
        try { new DataView(getMemory()).setBigUint64(newoffset_ptr, 0n, true); } catch {}
        return 0;
    };
    const fd_read = (_fd, _iovs, _iovs_len, nread_ptr) => {
        try { new DataView(getMemory()).setUint32(nread_ptr, 0, true); } catch {}
        return 0;
    };
    const proc_exit = (code) => { throw new Error('plugkit.wasm proc_exit(' + code + ')'); };
    const table = {
        proc_exit, fd_write, fd_read, random_get, clock_time_get, fd_seek,
        fd_close: ok, fd_fdstat_get: ok, fd_fdstat_set_flags: ok, fd_filestat_get: ok,
        environ_get: ok, environ_sizes_get: ok,
        fd_prestat_get: () => BADF, fd_prestat_dir_name: () => BADF,
        path_open: () => BADF, path_filestat_get: () => BADF,
        poll_oneoff: ok, sched_yield: ok,
    };
    return new Proxy(table, { get(t, k) { return (k in t) ? t[k] : (() => 0); } });
}

function bootPlugkitFromCdn() {
    if (_plugkitBootPromise) return _plugkitBootPromise;
    _plugkitBootPromise = (async () => {
        const existing = findExistingGm();
        if (existing) return existing;
        if (typeof WebAssembly === 'undefined' || typeof fetch !== 'function') {
            throw new Error('busybase/embedded: plugkit bootstrap requires WebAssembly + fetch (browser env)');
        }
        const instanceRef = { value: null };
        const getMemory = () => instanceRef.value.exports.memory.buffer;
        const wasi = makeWasiShim(getMemory);
        const host_random_fill = (buf_ptr, buf_len) => {
            try { crypto.getRandomValues(new Uint8Array(getMemory(), buf_ptr, buf_len)); return 0; } catch { return 1; }
        };
        const envProxy = new Proxy({ host_random_fill }, {
            get(t, prop) {
                if (prop in t) return t[prop];
                if (typeof prop !== 'string') return undefined;
                const stub = () => 0n;
                t[prop] = stub;
                return stub;
            },
        });
        const imports = { wasi_snapshot_preview1: wasi, env: envProxy };
        const { instance } = await WebAssembly.instantiateStreaming(fetch(PLUGKIT_WASM_URL), imports);
        instanceRef.value = instance;
        try {
            if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
            else if (typeof instance.exports._start === 'function') instance.exports._start();
        } catch {}
        const exp = instance.exports;
        if (!exp.memory || !exp.plugkit_alloc || typeof exp.dispatch_verb !== 'function') {
            throw new Error('busybase/embedded: plugkit.wasm missing required exports (memory/plugkit_alloc/dispatch_verb)');
        }
        const dispatch = (verb, body) => {
            const enc = new TextEncoder();
            const vb = enc.encode(String(verb || ''));
            const bb = enc.encode(JSON.stringify(body || {}));
            const vp = exp.plugkit_alloc(vb.length);
            const bp = exp.plugkit_alloc(bb.length);
            new Uint8Array(exp.memory.buffer, vp, vb.length).set(vb);
            new Uint8Array(exp.memory.buffer, bp, bb.length).set(bb);
            let packed;
            try { packed = exp.dispatch_verb(vp, vb.length, bp, bb.length); }
            finally {
                try { exp.plugkit_free(vp, vb.length); } catch {}
                try { exp.plugkit_free(bp, bb.length); } catch {}
            }
            const bi = typeof packed === 'bigint' ? packed : BigInt(packed);
            const p = Number(bi & 0xffffffffn);
            const l = Number((bi >> 32n) & 0xffffffffn);
            if (!p || !l) return null;
            const txt = new TextDecoder().decode(new Uint8Array(exp.memory.buffer, p, l));
            try { return JSON.parse(txt); } catch { return { raw: txt }; }
        };
        const gm = { exports: Object.keys(exp), dispatch };
        if (typeof window !== 'undefined') {
            window.__debug = window.__debug || {};
            if (!window.__debug.gm) window.__debug.gm = gm;
            else if (typeof window.__debug.gm.dispatch !== 'function') Object.assign(window.__debug.gm, gm);
        }
        return gm;
    })();
    return _plugkitBootPromise;
}

const lazyBackends = {
    plugkit: async () => {
        await bootPlugkitFromCdn();
        return (cfg) => plugkitCreateClient({ url: cfg.url });
    },
};
const backends = {
    libsql: () => { throw new Error("backend 'libsql' requires @libsql/client (Node only). In-browser use backend: 'plugkit'."); },
};
export const registerBackend = (name, factory) => { backends[name] = factory; };
const resolveClient = async (backend, url) => {
    let f = backends[backend];
    if (!f && lazyBackends[backend]) {
        f = await lazyBackends[backend]();
        backends[backend] = f;
    }
    if (!f) throw new Error(`busybase: unknown backend '${backend}'. Registered: ${[...Object.keys(backends), ...Object.keys(lazyBackends)].join(', ')}`);
    return await f({ url });
};

const esc = (s) => String(s).replace(/'/g, "''");
const validId = (s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s !== '_users' && s !== '_sessions';
const clean = (rows) => rows.map(({ pw, pubkey: _pk, ...r }) => r);
const makeUser = (u) => ({ id: u.id, email: u.email || null, role: u.role || 'authenticated', user_metadata: JSON.parse(u.meta || '{}'), app_metadata: JSON.parse(u.app_meta || '{}'), identities: [], aud: 'authenticated', created_at: u.created, updated_at: u.updated || u.created, last_sign_in_at: u.last_sign_in || u.created, email_confirmed_at: u.email ? u.created : null });
const makeSession = (token, refresh, exp, user) => ({ access_token: token, refresh_token: refresh, token_type: 'bearer', expires_in: 604800, expires_at: Math.floor(exp / 1000), user });
const ok = (data, count) => count !== undefined ? { data, error: null, count } : { data, error: null };
const err = (message, code = 400) => ({ data: null, error: { message, code } });

export const createEmbedded = async (config = {}) => {
    const dir = config.dir || 'busybase_data';
    const hooks = config.hooks || {};
    const backend = config.backend || 'plugkit';
    const url = config.url || `file:${dir}/db.sqlite`;
    const db = await resolveClient(backend, url);
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    const nonces = new Map();
    const resetTokens = new Map();

    const tblExists = async (n) => (await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [n] })).rows.length > 0;
    const ensureCols = async (n, row) => { const info = await db.execute(`PRAGMA table_info(${n})`); const ex = new Set(info.rows.map(r => r.name)); for (const k of Object.keys(row)) if (!ex.has(k)) await db.execute(`ALTER TABLE ${n} ADD COLUMN ${k} TEXT`); };
    const mkTbl = async (n, row) => { await db.execute(`CREATE TABLE IF NOT EXISTS ${n} (${Object.keys(row).map(k => k + ' TEXT').join(', ')})`); };
    const getRows = async (n, where) => { if (!(await tblExists(n))) return []; return (await db.execute(`SELECT * FROM ${n} WHERE ${where}`)).rows.map(r => ({ ...r })); };
    const getAllRows = async (n) => { if (!(await tblExists(n))) return []; return (await db.execute(`SELECT * FROM ${n}`)).rows.map(r => ({ ...r })); };
    const insertRow = async (n, row) => { const keys = Object.keys(row); await db.execute({ sql: `INSERT INTO ${n} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, args: keys.map(k => row[k] == null ? null : String(row[k])) }); };
    const updateRow = async (n, data, where) => { const keys = Object.keys(data).filter(k => k !== 'id'); if (!keys.length) return; await db.execute({ sql: `UPDATE ${n} SET ${keys.map(k => k + '=?').join(',')} WHERE ${where}`, args: keys.map(k => data[k] == null ? null : String(data[k])) }); };
    const deleteRow = async (n, where) => { await db.execute(`DELETE FROM ${n} WHERE ${where}`); };
    const broadcast = (table, ev, nw, old) => { const p = { event: ev, table, eventType: ev, new: nw ?? null, old: old ?? null }; bus.emit(`table:${table}`, p); bus.emit('*', p); };

    await db.execute('CREATE TABLE IF NOT EXISTS _users (id TEXT, email TEXT, pw TEXT, pubkey TEXT, role TEXT, meta TEXT, app_meta TEXT, created TEXT, updated TEXT, last_sign_in TEXT)');
    await db.execute('CREATE TABLE IF NOT EXISTS _sessions (token TEXT, refresh TEXT, uid TEXT, exp INTEGER)');

    const fireHook = async (name, ...args) => { const fn = hooks[name]; if (!fn) return null; try { const r = await fn(...args); if (r === false) return 'Access denied'; if (r && typeof r === 'object' && typeof r.error === 'string') return r.error; } catch (e) { return (e && e.message) || String(e); } return null; };
    const pipeHook = async (name, value, ...args) => { const fn = hooks[name]; if (!fn) return value; try { const r = await fn(value, ...args); if (r && typeof r === 'object' && !r.error) return r; } catch {} return value; };

    const issueSession = async (uid) => { const token = crypto.randomUUID(), refresh = crypto.randomUUID(), exp = Date.now() + 7 * 24 * 60 * 60 * 1000; await db.execute({ sql: 'INSERT INTO _sessions (token,refresh,uid,exp) VALUES (?,?,?,?)', args: [token, refresh, uid, exp] }); return { token, refresh, exp }; };
    const getSessionUser = async (t) => { if (!t) return null; const s = (await db.execute({ sql: 'SELECT * FROM _sessions WHERE token=? AND exp>?', args: [t, Date.now()] })).rows[0]; if (!s) return null; const u = (await getRows('_users', `id='${esc(s.uid)}'`))[0]; return u ? makeUser(u) : null; };

    const toFilter = (filters) => { const parts = []; for (const f of filters) { if (f.startsWith('or=')) { const orP = f.slice(3).split(',').map(c => { const d1 = c.indexOf('.'), d2 = c.indexOf('.', d1 + 1); if (d1 < 0 || d2 < 0) return null; const col = c.slice(0, d1), op = c.slice(d1 + 1, d2), v = esc(c.slice(d2 + 1)); if (!validId(col)) return null; const s = op === 'eq' ? '=' : op === 'neq' ? '!=' : op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : op === 'lte' ? '<=' : null; return s ? `${col} ${s} '${v}'` : null; }).filter(Boolean); if (orP.length) parts.push(`(${orP.join(' OR ')})`); continue; } const dot = f.indexOf('.'); if (dot < 0) continue; const op = f.slice(0, dot), rest = f.slice(dot + 1); if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'].includes(op)) { const eq = rest.indexOf('='); if (eq < 0) continue; const col = rest.slice(0, eq), val = rest.slice(eq + 1); if (!validId(col)) continue; const s = op === 'eq' ? '=' : op === 'neq' ? '!=' : op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : op === 'lte' ? '<=' : op === 'like' ? null : null; if (op === 'like') parts.push(`${col} LIKE '${esc(val)}'`); else if (op === 'ilike') parts.push(`LOWER(${col}) LIKE LOWER('${esc(val)}')`); else if (s) parts.push(`${col} ${s} '${esc(val)}'`); } else if (op === 'is') { const eq = rest.indexOf('='); if (eq < 0) continue; const col = rest.slice(0, eq), val = rest.slice(eq + 1).trim().toUpperCase(); if (!validId(col) || !['NULL', 'TRUE', 'FALSE'].includes(val)) continue; parts.push(`${col} IS ${val}`); } else if (op === 'in') { const eq = rest.indexOf('='); if (eq < 0) continue; const col = rest.slice(0, eq), val = rest.slice(eq + 1); if (!validId(col)) continue; parts.push(`${col} IN (${val.split(',').map(v => `'${esc(v)}'`).join(',')})`); } else if (op === 'not') { const dp = rest.indexOf('.'); if (dp < 0) continue; const col = rest.slice(0, dp), after = rest.slice(dp + 1), eq = after.indexOf('='); if (eq < 0) continue; const sub = after.slice(0, eq), val = after.slice(eq + 1); if (!validId(col)) continue; const s = sub === 'eq' ? '=' : sub === 'neq' ? '!=' : sub === 'gt' ? '>' : sub === 'gte' ? '>=' : sub === 'lt' ? '<' : '<='; parts.push(`NOT (${col} ${s} '${esc(val)}')`); } } return parts.join(' AND '); };

    setInterval(async () => { const now = Date.now(); for (const [k, v] of nonces) if (v < now) nonces.delete(k); for (const [k, v] of resetTokens) if (v.exp < now) resetTokens.delete(k); await db.execute({ sql: 'DELETE FROM _sessions WHERE exp<?', args: [now] }).catch(() => {}); }, 5 * 60_000);

    const Q = (table, method, body) => {
        const q = { filters: [], order: '', limit: 0, offset: 0, select: '*', count: '' };
        let _single = false, _maybe = false;
        const resolve = async () => {
            if (hooks.canAccess) { const d = await fireHook('canAccess', { user: null, table, method: method || 'GET' }); if (d) return err(d, 403); }
            if (method === 'PATCH' || method === 'PUT') { const f = toFilter(q.filters); if (!f) return err('No filter provided'); if (!(await tblExists(table))) return err('Table not found', 404); const data = Array.isArray(body) ? body[0] : body; let ex = await getRows(table, f); if (!ex.length) return ok([]); const pe = await fireHook('beforeUpdate', table, ex, data); if (pe) return err(pe); await updateRow(table, data, f); let up = ex.map(r => ({ ...r, ...data })); up = await pipeHook('afterUpdate', up, table); for (let i = 0; i < up.length; i++) broadcast(table, 'UPDATE', clean([up[i]])[0], clean([ex[i]])[0]); return ok(clean(up)); }
            if (method === 'DELETE') { const f = toFilter(q.filters); if (!f) return err('No filter provided'); if (!(await tblExists(table))) return err('Table not found', 404); const td = await getRows(table, f); const pe = await fireHook('beforeDelete', table, td); if (pe) return err(pe); await deleteRow(table, f); await fireHook('afterDelete', table, td); for (const r of clean(td)) broadcast(table, 'DELETE', null, r); return ok([]); }
            const ph = await pipeHook('beforeSelect', q.filters, table);
            const f = toFilter(Array.isArray(ph) ? ph : q.filters);
            let rows = f ? await getRows(table, f) : await getAllRows(table);
            rows = await pipeHook('afterSelect', rows, table);
            if (q.select && q.select !== '*') { const cols = q.select.split(',').filter(c => validId(c)); rows = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]]))); }
            if (q.order) { const [col, dir] = q.order.split('.'); if (validId(col)) rows.sort((a, b) => dir === 'desc' ? (b[col] > a[col] ? 1 : -1) : (a[col] > b[col] ? 1 : -1)); }
            const lim = Math.max(0, q.limit || 1000), off = Math.max(0, q.offset || 0), page = clean(rows).slice(off, off + lim);
            if (_single) { if (!page.length) return err('JSON object requested, multiple (or no) rows returned', 406); return ok(page[0]); }
            if (_maybe) return ok(page[0] ?? null);
            return ok(page, q.count === 'exact' ? rows.length : undefined);
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
            not: (c, op, v) => (q.filters.push(`not.${c}.${op}=${v}`), b),
            or: (cl) => (q.filters.push(`or=${cl}`), b),
            filter: (c, op, v) => (q.filters.push(`${op}.${c}=${v}`), b),
            order: (c, { ascending = true } = {}) => (q.order = `${c}.${ascending ? 'asc' : 'desc'}`, b),
            limit: (n) => (q.limit = n, b),
            offset: (n) => (q.offset = n, b),
            range: (from, to) => (q.offset = from, q.limit = to - from + 1, b),
            count: (t = 'exact') => (q.count = t, b),
            single: () => (_single = true, b),
            maybeSingle: () => (_maybe = true, b),
            then: (res, rej) => resolve().then(res, rej),
        };
        return b;
    };

    const from = (table) => ({
        select: (cols = '*') => Q(table).select(cols),
        insert: async (data) => { if (!validId(table)) return err('Invalid table name'); let rows = Array.isArray(data) ? data : [data]; if (!rows.length || !Object.keys(rows[0]).length) return err('Empty body'); const pe = await fireHook('beforeInsert', table, rows); if (pe) return err(pe); rows = await pipeHook('afterInsert', rows.map(r => ({ id: r.id ?? crypto.randomUUID(), ...r })), table); if (!(await tblExists(table))) await mkTbl(table, rows[0]); else await ensureCols(table, rows[0]); for (const row of rows) await insertRow(table, row); const c = clean(rows); for (const row of c) broadcast(table, 'INSERT', row, null); return ok(c); },
        upsert: async (data) => { const rows = (Array.isArray(data) ? data : [data]).map(r => ({ ...r, id: r.id ?? crypto.randomUUID() })); const results = await Promise.all(rows.map(async r => { const ex = await getRows(table, `id='${esc(r.id)}'`); if (ex.length) { await updateRow(table, r, `id='${esc(r.id)}'`); const up = { ...ex[0], ...r }; broadcast(table, 'UPDATE', clean([up])[0], clean([ex[0]])[0]); return ok(clean([up])); } return from(table).insert(r); })); return ok(results.flatMap(r => r?.data ?? [])); },
        update: (data) => Q(table, 'PATCH', data),
        delete: () => Q(table, 'DELETE', null),
    });

    let currentToken = null, currentSession = null;
    const authListeners = [];
    const emitAuth = (e, s) => authListeners.forEach(cb => cb(e, s));

    const auth = {
        signUp: async ({ email, password, options }) => { const el = email.toLowerCase(); if ((await getRows('_users', `email='${esc(el)}'`)).length) return err('User already registered'); const now = new Date().toISOString(); const u = { id: crypto.randomUUID(), email: el, pw: await Bun.password.hash(password), pubkey: '', role: 'authenticated', meta: JSON.stringify(options?.data || {}), app_meta: '{}', created: now, updated: now, last_sign_in: now }; await insertRow('_users', u); const he = await fireHook('onSignup', makeUser(u)); if (he) return err(he); return ok({ user: makeUser(u), session: null }); },
        signInWithPassword: async ({ email, password }) => { const el = email.toLowerCase(); const u = (await getRows('_users', `email='${esc(el)}'`))[0]; if (!u || !await Bun.password.verify(password, u.pw)) return err('Invalid login credentials'); const now = new Date().toISOString(); await updateRow('_users', { last_sign_in: now, updated: now }, `id='${esc(u.id)}'`); const { token, refresh, exp } = await issueSession(u.id); const user = makeUser({ ...u, last_sign_in: now }); currentToken = token; currentSession = makeSession(token, refresh, exp, user); await fireHook('onIssueSession', user); await fireHook('onSignin', user); emitAuth('SIGNED_IN', currentSession); return ok({ user, session: currentSession }); },
        signIn: async () => { const { token, refresh, exp } = await issueSession(crypto.randomUUID()); currentToken = token; currentSession = makeSession(token, refresh, exp, { id: 'anon', role: 'anon' }); emitAuth('SIGNED_IN', currentSession); return ok({ session: currentSession }); },
        signOut: async () => { const user = currentToken ? await getSessionUser(currentToken) : null; if (currentToken) await db.execute({ sql: 'DELETE FROM _sessions WHERE token=?', args: [currentToken] }).catch(() => {}); if (user) await fireHook('onSignout', user); currentToken = null; currentSession = null; emitAuth('SIGNED_OUT', null); return ok({}); },
        getUser: async () => { const u = await getSessionUser(currentToken); if (!u) return err('Not authenticated', 401); return ok({ user: u }); },
        getSession: () => Promise.resolve(ok({ session: currentSession })),
        updateUser: async (attrs) => { const u = await getSessionUser(currentToken); if (!u) return err('Not authenticated', 401); const ex = (await getRows('_users', `id='${esc(u.id)}'`))[0]; if (!ex) return err('User not found', 404); const now = new Date().toISOString(); const newEmail = attrs.email ? attrs.email.toLowerCase() : ex.email; if (attrs.email && newEmail !== ex.email) { const taken = await getRows('_users', `email='${esc(newEmail)}'`); if (taken.length) return err('Email already in use'); const emailHookErr = await fireHook('onEmailChange', makeUser(ex), newEmail); if (emailHookErr) return err(emailHookErr); } const merged = { email: newEmail, pw: attrs.password ? await Bun.password.hash(attrs.password) : ex.pw, meta: JSON.stringify({ ...JSON.parse(ex.meta || '{}'), ...(attrs.data || {}) }), updated: now }; await updateRow('_users', merged, `id='${esc(u.id)}'`); await fireHook('onUserUpdate', makeUser({ ...ex, ...merged }), { email: attrs.email, password: !!attrs.password, data: attrs.data, app_metadata: attrs.app_metadata }); emitAuth('USER_UPDATED', currentSession); return ok({ user: makeUser({ ...ex, ...merged }) }); },
        setSession: (s) => { currentToken = s.access_token; currentSession = s; return Promise.resolve(ok({ session: s })); },
        resetPasswordForEmail: (_) => Promise.resolve(ok({})),
        onAuthStateChange: (cb) => { authListeners.push(cb); cb('INITIAL_SESSION', currentSession); return { data: { subscription: { unsubscribe: () => { const i = authListeners.indexOf(cb); if (i > -1) authListeners.splice(i, 1); } } } }; },
        keypair: { signIn: async () => ok({}), restore: async () => ok({}), export: () => ({}) },
    };

    const channels = new Map();
    const channel = (name) => {
        const handlers = [];
        const ch = {
            on: (type, opts, cb) => { const listener = (p) => { if (opts.event === '*' || opts.event === p.eventType) cb(p); }; handlers.push({ ...opts, cb, listener }); return ch; },
            subscribe: (statusCb) => { for (const h of handlers) bus.on(`table:${h.table}`, h.listener); statusCb && statusCb('SUBSCRIBED'); channels.set(name, ch); return ch; },
            unsubscribe: () => { for (const h of handlers) bus.off(`table:${h.table}`, h.listener); channels.delete(name); },
        };
        return ch;
    };

    return { from, auth, channel, removeAllChannels: () => { for (const ch of channels.values()) ch.unsubscribe(); }, _bus: bus };
};

export default { createEmbedded, registerBackend };
