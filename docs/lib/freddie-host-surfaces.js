// freddie-host data surfaces: config, projects, sessions, cron, env, gateway,
// profiles, batch. Split out of docs/freddie-host.js (pure move, no behavior
// change).
import { createClient } from './sqlite-shim-libsql-client-adapter.js';
import { FREDDIE_DEFAULT_CONFIG, FREDDIE_ENV_KEYS, FREDDIE_GATEWAY_PLATFORMS, deepMerge, clone, setDot, getDot } from './freddie-host-config.js';
import { shortUid } from '../vendor/uid.js';
import { validateCronExpr } from './cron-scheduler.js';

export function makeConfigSurface(fs) {
    const path = '/etc/freddie/freddie.json';
    function load() {
        const raw = fs.readJson(path, null);
        if (!raw) { const seeded = clone(FREDDIE_DEFAULT_CONFIG); fs.writeJson(path, seeded); return seeded; }
        return deepMerge(clone(FREDDIE_DEFAULT_CONFIG), raw);
    }
    function save(cfg) { fs.writeJson(path, cfg); return cfg; }
    function saveValue(dotpath, value) { const cfg = load(); setDot(cfg, dotpath, value); return save(cfg); }
    function getValue(dotpath, fallback) { return getDot(load(), dotpath, fallback); }
    return { path, load, save, saveValue, getValue };
}

export function makeProjectsSurface(fs) {
    const path = '/etc/freddie/projects.json';
    function load() {
        const raw = fs.readJson(path, null);
        if (!raw) {
            const seeded = { active: 'default', projects: [{ name: 'default', path: '/', created: Date.now() }] };
            fs.writeJson(path, seeded);
            return seeded;
        }
        return raw;
    }
    return {
        path,
        list: () => load().projects,
        active: () => { const s = load(); return s.projects.find(p => p.name === s.active) || null; },
        create({ name, path: projectPath }) {
            if (!name) throw new Error('name required');
            const s = load();
            if (s.projects.find(p => p.name === name)) throw new Error('project exists: ' + name);
            const created = { name, path: projectPath || ('/projects/' + name), created: Date.now() };
            s.projects.push(created);
            fs.writeJson(path, s);
            return created;
        },
        remove(name) {
            if (name === 'default') throw new Error('cannot remove default');
            const s = load();
            s.projects = s.projects.filter(p => p.name !== name);
            if (s.active === name) s.active = 'default';
            fs.writeJson(path, s);
            return { ok: true };
        },
        setActive(name) {
            const s = load();
            if (!s.projects.find(p => p.name === name)) throw new Error('unknown project: ' + name);
            s.active = name;
            fs.writeJson(path, s);
            return { ok: true, active: s.projects.find(p => p.name === name) };
        },
    };
}

export async function getDb(fs, ns) {
    const cli = await createClient({ url: 'file:freddie-' + ns + '-' + fs.instanceId });
    return cli;
}

// `getDb` opens a `file:...` URL, which sqlite-shim maps to an in-memory
// wasm-side DB keyed by db_name (no on-disk file: the ':memory:' path is
// literal, see sqlite-shim.js Database constructor). Closing the LAST
// reference to a db_name (db.close()) destroys the schema+rows -- there is
// nothing to reopen from, unlike a real file. The original code opened a
// fresh connection and closed it again on every single operation (list,
// create, messages, append, search all had their own getDb()...close()
// cycle), so every call after the first started from a brand-new empty DB --
// "no such table" on any read after any earlier call had run (which always
// closed first). Folding CREATE TABLE into each op's own open/close cycle
// (an earlier attempt at this fix) was NOT enough: it still closed after
// every call, still wiping the DB each time. The actual fix: hold ONE
// connection open for the lifetime of this host/tab and never close it after
// an operation -- only a real page/instance teardown should close it.
export const SESSIONS_SCHEMA = [
    'CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, title TEXT, platform TEXT, model TEXT, created_at INTEGER, updated_at INTEGER, turn_count INTEGER DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, ts INTEGER)',
];
// Real chat activity is recorded by docs/lib/chat.js's transcriptStore into
// /chat-db/conversations.json on fs (per-instance-fs-backed, written on every
// chat turn) -- a DIFFERENT store from this module's libsql-backed
// SESSIONS_SCHEMA table, which nothing in the chat flow ever INSERTs into
// (dashboard/CLI-only sessions.create()/append() call sites, never wired to
// freddie-chat.js's actual message pipeline). That gap made the home-stats
// "sessions" KPI and the sessions dashboard page both read the permanently-
// empty libsql table, showing "0 sessions" even after real chat activity.
// Folding transcriptStore's conversations into list() here (both pages in
// docs/vendor/kits/os/freddie/pages-core.js read list() through this one
// surface) makes the count reflect real chat activity without requiring every
// call site to also learn about a second sessions store.
function chatDbConversations(fs) {
    if (!fs || typeof fs.readJson !== 'function') return [];
    const conversations = fs.readJson('/chat-db/conversations.json', null) || {};
    const sessions = fs.readJson('/chat-db/sessions.json', null) || {};
    const bySessionConv = Object.values(sessions).reduce((a, s) => { if (s && s.conversationId) (a[s.conversationId] = a[s.conversationId] || []).push(s); return a; }, {});
    return Object.values(conversations).map(c => {
        const its = bySessionConv[c.id] || [];
        const updated_at = its.reduce((max, s) => Math.max(max, s.startedAt || 0), c.createdAt || 0);
        return { id: c.id, title: c.title || c.id, platform: 'browser', model: '', created_at: c.createdAt || 0, updated_at, turn_count: its.length };
    });
}
export function makeSessionsSurface(fs) {
    let dbPromise = null;
    async function db() {
        if (!dbPromise) {
            dbPromise = getDb(fs, 'sessions').then(async (cli) => {
                for (const stmt of SESSIONS_SCHEMA) await cli.execute(stmt);
                return cli;
            });
        }
        return dbPromise;
    }
    return {
        async list() {
            const cli = await db();
            const r = await cli.execute('SELECT id, title, platform, model, created_at, updated_at, turn_count FROM sessions ORDER BY updated_at DESC');
            const dbRows = r.rows.map(row => ({ id: row[0], title: row[1], platform: row[2], model: row[3], created_at: row[4], updated_at: row[5], turn_count: row[6] }));
            const dbIds = new Set(dbRows.map(row => row.id));
            const chatRows = chatDbConversations(fs).filter(row => !dbIds.has(row.id));
            return [...dbRows, ...chatRows].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        },
        async create({ id, title = '', platform = 'browser', model = '' }) {
            const cli = await db();
            const sid = id || ('s_' + Date.now() + '_' + shortUid(6));
            const ts = Date.now();
            // OR IGNORE: callers (e.g. freddie-chat.js) reuse a stable per-instance
            // sessionId as the row id and may call create() again after a reload
            // or from a second chat surface in the same instance -- a plain INSERT
            // would throw on the id PRIMARY KEY collision instead of just reusing
            // the existing row.
            await cli.execute({ sql: 'INSERT OR IGNORE INTO sessions(id,title,platform,model,created_at,updated_at,turn_count) VALUES(?,?,?,?,?,?,0)', args: [sid, title, platform, model, ts, ts] });
            return { id: sid, title, platform, model, created_at: ts, updated_at: ts, turn_count: 0 };
        },
        async messages(id) {
            const cli = await db();
            const r = await cli.execute({ sql: 'SELECT role, content, tool_call_id, ts FROM messages WHERE session_id=? ORDER BY id ASC', args: [id] });
            return r.rows.map(row => ({ role: row[0], content: row[1], tool_call_id: row[2], time: new Date(row[3]).toLocaleTimeString() }));
        },
        async append(sid, msg) {
            const cli = await db();
            await cli.execute({ sql: 'INSERT INTO messages(session_id,role,content,tool_call_id,ts) VALUES(?,?,?,?,?)', args: [sid, msg.role, typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content), msg.tool_call_id || null, Date.now()] });
            await cli.execute({ sql: 'UPDATE sessions SET updated_at=?, turn_count=turn_count+1 WHERE id=?', args: [Date.now(), sid] });
            return { ok: true };
        },
        async search(q) {
            if (typeof q !== 'string' || !q) return [];
            const cli = await db();
            const r = await cli.execute({ sql: "SELECT session_id, content FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT 50", args: ['%' + String(q).replace(/[%_]/g, '') + '%'] });
            return r.rows.map(row => ({ session_id: row[0], content: row[1] }));
        },
    };
}

export function makeCronSurface(fs) {
    // Same fix as makeSessionsSurface above: a single connection held open for
    // the lifetime of this host, never closed after an operation. Closing an
    // in-memory (':memory:') wasm-side DB destroys it -- there is no file to
    // reopen from -- so an open-per-call/close-per-call pattern silently
    // wipes the jobs table on every single call after the very first.
    let dbPromise = null;
    async function db() {
        if (!dbPromise) {
            dbPromise = getDb(fs, 'cron').then(async (cli) => {
                await cli.execute('CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, cron TEXT, prompt TEXT, model TEXT, enabled INTEGER DEFAULT 1, created INTEGER, last_run INTEGER)');
                // Additive migration for DBs created before last_run existed --
                // ALTER TABLE ADD COLUMN is a no-op error (column already exists)
                // on every boot after the first, so swallow it.
                try { await cli.execute('ALTER TABLE jobs ADD COLUMN last_run INTEGER'); } catch { /* swallow: column already exists from a prior migration, ALTER TABLE ADD COLUMN has no IF NOT EXISTS in this SQL dialect */ }
                return cli;
            });
        }
        return dbPromise;
    }
    return {
        async list() {
            const cli = await db();
            const r = await cli.execute('SELECT id, cron, prompt, model, enabled, created, last_run FROM jobs ORDER BY id DESC');
            return r.rows.map(row => ({ id: row[0], cron: row[1], prompt: row[2], model: row[3], enabled: !!row[4], created: row[5], last_run: row[6] != null ? Number(row[6]) : null }));
        },
        async markRun(id, minuteBucket) {
            const numId = Number(id);
            if (!Number.isInteger(numId)) return { ok: false, error: 'invalid job id' };
            const cli = await db();
            const exists = await cli.execute({ sql: 'SELECT id FROM jobs WHERE id=?', args: [numId] });
            if (!exists.rows.length) return { ok: false, error: 'job not found' };
            await cli.execute({ sql: 'UPDATE jobs SET last_run=? WHERE id=?', args: [minuteBucket, numId] });
            return { ok: true };
        },
        async create({ cron, prompt, model = null }) {
            if (!cron || !prompt) throw new Error('cron and prompt required');
            if (typeof cron !== 'string' || typeof prompt !== 'string') throw new Error('cron and prompt must be strings');
            if (model != null && typeof model !== 'string') throw new Error('model must be a string');
            const validationError = validateCronExpr(cron);
            if (validationError) throw new Error(`invalid cron expression: ${validationError}`);
            const cli = await db();
            const r = await cli.execute({ sql: 'INSERT INTO jobs(cron,prompt,model,enabled,created) VALUES(?,?,?,1,?)', args: [cron, prompt, model, Date.now()] });
            return { id: Number(r.lastInsertRowid) };
        },
        async remove(id) {
            const numId = Number(id);
            if (!Number.isInteger(numId)) return { ok: false, error: 'invalid job id' };
            const cli = await db();
            const exists = await cli.execute({ sql: 'SELECT id FROM jobs WHERE id=?', args: [numId] });
            if (!exists.rows.length) return { ok: false, error: 'job not found' };
            await cli.execute({ sql: 'DELETE FROM jobs WHERE id=?', args: [numId] });
            return { ok: true };
        },
        async toggle(id, enabled) {
            const numId = Number(id);
            if (!Number.isInteger(numId)) return { ok: false, error: 'invalid job id' };
            const cli = await db();
            const exists = await cli.execute({ sql: 'SELECT id FROM jobs WHERE id=?', args: [numId] });
            if (!exists.rows.length) return { ok: false, error: 'job not found' };
            await cli.execute({ sql: 'UPDATE jobs SET enabled=? WHERE id=?', args: [enabled ? 1 : 0, numId] });
            return { ok: true };
        },
    };
}

export function makeEnvSurface(fs) {
    return {
        keys: () => FREDDIE_ENV_KEYS.slice(),
        list() {
            const cfg = fs.getConfig();
            const env = (cfg && cfg.env) || {};
            return FREDDIE_ENV_KEYS.map(k => ({ key: k, set: !!(env[k] || fs.getApiKey(k.toLowerCase().replace(/_api_key$/i, ''))) }));
        },
        get(k) { const cfg = fs.getConfig(); return (cfg.env && cfg.env[k]) || null; },
        set(k, v) {
            const cfg = fs.getConfig();
            cfg.env = cfg.env || {};
            if (v == null || v === '') delete cfg.env[k]; else cfg.env[k] = v;
            fs.setConfig(cfg);
            return { ok: true };
        },
    };
}

export function makeGatewaySurface() {
    return {
        platforms: () => FREDDIE_GATEWAY_PLATFORMS.map(name => ({ name, enabled: false, note: 'browser-only — start gateway via freddie CLI on host node' })),
    };
}

export function makeProfilesSurface(fs) {
    const path = '/etc/freddie/profiles.json';
    return {
        list() { const raw = fs.readJson(path, null); return raw && raw.profiles || []; },
        save(name, body) {
            const raw = fs.readJson(path, null) || { profiles: [] };
            const idx = raw.profiles.findIndex(p => p.name === name);
            const entry = { name, body, updated: Date.now() };
            if (idx >= 0) raw.profiles[idx] = entry; else raw.profiles.push(entry);
            fs.writeJson(path, raw);
            return entry;
        },
    };
}

export function makeBatchSurface(getChatTool) {
    return {
        async run({ prompts = [], concurrency = 4 }) {
            if (!Array.isArray(prompts) || !prompts.length) throw new Error('prompts required');
            const chat = getChatTool();
            const results = new Array(prompts.length);
            const queue = prompts.map((prompt, index) => ({ prompt, index }));
            const workers = Math.max(1, Math.min(concurrency, prompts.length));
            async function worker() {
                while (queue.length) {
                    const { prompt: p, index: i } = queue.shift();
                    try { const r = await chat.run({ prompt: p }); results[i] = { prompt: p, output: r.content || '', error: r.error || null }; }
                    catch (e) { results[i] = { prompt: p, error: String(e.message || e) }; }
                }
            }
            await Promise.all(Array.from({ length: workers }, worker));
            return { results, count: results.length };
        },
    };
}
