// freddie-host builtin tool registry (read/write/edit/grep/list/memory/chat/
// delegate/web_search). Split out of docs/freddie-host.js (pure move, no
// behavior change).
import { createClient } from './sqlite-shim-libsql-client-adapter.js';
import { t } from '../vendor/i18n.js';
import { snap as idbSnap, persist as idbPersist } from '../shell-idb.js';
import { formatAgo } from './freddie-host-gateway.js';
import { kvGet as idbKvGet, kvPut as idbKvPut } from './idb-kv.js';

export function makeBuiltinTools(fs) {
    // Resolve a tool-supplied path/prefix against the configured working folder
    // (cfg.agent.cwd, set via the chat config surface). Absolute paths ('/x')
    // bypass the cwd; relative paths are joined under it.
    const resolveCwd = (p) => {
        const cwd = ((fs.getConfig && fs.getConfig().agent) || {}).cwd || '';
        if (!cwd) return p || '';
        if (typeof p === 'string' && p.startsWith('/')) return p;
        const base = cwd.replace(/^\/+|\/+$/g, '');
        const rel = (p || '').replace(/^\/+/, '');
        return base ? (rel ? base + '/' + rel : base) : rel;
    };
    // Held open for this host's lifetime, never closed after an op: closing
    // the last reference to an in-memory (':memory:') wasm-side DB destroys
    // it (nothing to reopen from), so a per-call open+close pattern silently
    // wipes the kv table between calls -- exactly what broke the sessions/cron
    // surfaces this same session (freddie-host.js makeSessionsSurface /
    // makeCronSurface). The 'memory' tool's own description claims
    // "Persistent key/value memory" -- a per-call close made that false.
    // sqlite-shim's `file:` URLs are an in-page isolation key, not durable
    // storage -- plugkit's own sql_open always targets ':memory:' underneath
    // (see sqlite-shim.js's Database ctor comment), so this table is wiped on
    // every reload unless restored/persisted through IDB explicitly here, the
    // same way freddie-host-persistence.js does for the separate 'gm' db.
    // A dedicated DB name (distinct from freddie-host-persistence.js's
    // 'plugkit-libsql') -- idb-kv.js's openDb() always requests version 1, so
    // reusing an existing DB name whose schema lacks this store would never
    // trigger onupgradeneeded and the store would silently never get created.
    const IDB_DB_NAME = 'thebird-memory-tool';
    const IDB_STORE = 'kv-snapshots';
    const idbKey = 'freddie-memory-' + fs.instanceId;
    let memoryDbPromise = null;
    async function memoryDb() {
        if (!memoryDbPromise) {
            // createClient() is synchronous (returns the client object directly,
            // not a Promise) -- see getDb()/sqlite-shim-libsql-client-adapter.js.
            memoryDbPromise = (async () => {
                const cli = createClient({ url: 'file:freddie-memory-' + fs.instanceId });
                await cli.execute('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)');
                try {
                    const rows = await idbKvGet(IDB_DB_NAME, IDB_STORE, idbKey);
                    if (Array.isArray(rows)) {
                        for (const [k, v] of rows) await cli.execute({ sql: 'INSERT OR REPLACE INTO kv VALUES (?, ?)', args: [k, v] });
                    }
                } catch { /* restore is best-effort: absent/corrupt snapshot just starts empty */ }
                return cli;
            })();
        }
        return memoryDbPromise;
    }
    async function persistMemoryDb(cli) {
        try {
            const r = await cli.execute('SELECT k, v FROM kv');
            await idbKvPut(IDB_DB_NAME, IDB_STORE, idbKey, r.rows.map(row => [row[0], row[1]]));
        } catch { /* persist is best-effort: a failed snapshot write doesn't fail the caller's set */ }
    }
    const tools = {
        read: {
            name: 'read', description: 'Read a file from the per-instance fs (relative paths resolve under the configured working folder)',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            async run({ path }) { try { return { content: fs.readFile(resolveCwd(path)) }; } catch (e) { return { error: e.message }; } },
        },
        write: {
            name: 'write', description: 'Write a file to the per-instance fs (relative paths resolve under the configured working folder). '
                + 'If you write code the user should see run, after your last write end your reply with two lines: '
                + '"FILE: <path>" naming the one file to execute, and "RUN: <command>" naming the exact shell command '
                + '(e.g. "RUN: node reverse.test.js", "RUN: npx cowsay hi", "RUN: npm test"). If a real npm dependency '
                + 'is needed, write a package.json declaring it under "dependencies" first - it is installed for real '
                + 'before your RUN: command executes. Omit FILE:/RUN: entirely for writes that are not meant to be run '
                + '(config files, notes, non-executable text).',
            inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
            async run({ path, content }) { const p = resolveCwd(path); fs.writeFile(p, content); await fs.flush(); return { ok: true, path: '/' + p.replace(/^\/+/, ''), bytes: content.length }; },
        },
        edit: {
            name: 'edit', description: 'Replace old_str with new_str in a file',
            inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] },
            async run({ path, old_str, new_str }) {
                const p = resolveCwd(path);
                let body;
                try { body = fs.readFile(p); } catch (e) { return { error: e.message }; }
                if (!body.includes(old_str)) return { error: 'old_str not found' };
                const count = body.split(old_str).length - 1;
                if (count > 1) return { error: `old_str matches ${count} times; provide a more specific old_str with unique surrounding context` };
                fs.writeFile(p, body.replace(old_str, new_str));
                await fs.flush();
                return { ok: true };
            },
        },
        grep: {
            name: 'grep', description: 'Find lines matching pattern across all fs files',
            inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, prefix: { type: 'string' } }, required: ['pattern'] },
            async run({ pattern, prefix = '' }) {
                // Reject nested-quantifier shapes ((a+)+, (a*)*, (a+)*, (.*)*, (a{1,}){1,} etc.) that are
                // the classic catastrophic-backtracking triggers -- a single re.test() call on a matching
                // engine can itself block the thread indefinitely, so this must happen BEFORE compiling,
                // not as a runtime budget around it (a per-line deadline check can never fire mid-test()).
                if (/\([^)]*[+*]\)[^)]*[+*{]|\([^)]*\{\d*,\}[^)]*[+*{]/.test(pattern)) {
                    return { error: 'pattern rejected: nested quantifiers (e.g. (a+)+, (.*)* ) can cause catastrophic backtracking and are not allowed' };
                }
                let re;
                try { re = new RegExp(pattern); } catch (e) { return { error: 'invalid pattern: ' + e.message }; }
                const LIMIT = 200;
                const MAX_LINE_LEN = 2000;
                const DEADLINE_MS = 2000;
                const deadline = Date.now() + DEADLINE_MS;
                const resolvedPrefix = resolveCwd(prefix);
                const keys = fs.list(resolvedPrefix);
                const out = [];
                let total = 0;
                let timedOut = false;
                outer:
                for (const k of keys) {
                    const v = fs.snapshot[k];
                    if (typeof v !== 'string') continue;
                    const lines = v.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        // Check the deadline before every single test() call -- a coarser (every-N-lines)
                        // check cannot bound the case where one line's test() itself hangs.
                        if (Date.now() > deadline) { timedOut = true; break outer; }
                        const line = lines[i].length > MAX_LINE_LEN ? lines[i].slice(0, MAX_LINE_LEN) : lines[i];
                        if (!re.test(line)) continue;
                        total++;
                        if (out.length < LIMIT) out.push({ path: '/' + k, line: i + 1, text: line });
                    }
                }
                const result = total > LIMIT ? { matches: out, truncated: true, total } : { matches: out };
                if (timedOut) { result.truncated = true; result.timedOut = true; result.error = 'grep timed out after ' + DEADLINE_MS + 'ms; narrow the pattern or prefix'; }
                if (keys.length === 0 && resolvedPrefix) result.prefixExists = fs.list('').some(k => k.startsWith(resolvedPrefix));
                return result;
            },
        },
        list: {
            name: 'list', description: 'List files under a path prefix (relative resolves under the configured working folder)',
            inputSchema: { type: 'object', properties: { prefix: { type: 'string' } } },
            async run({ prefix = '' }) {
                const resolvedPrefix = resolveCwd(prefix);
                const keys = fs.list(resolvedPrefix);
                const result = { paths: keys.map(k => '/' + k) };
                if (keys.length === 0 && resolvedPrefix) result.prefixExists = fs.list('').some(k => k.startsWith(resolvedPrefix));
                return result;
            },
        },
        memory: {
            name: 'memory', description: 'Persistent key/value memory in plugkit-backed libsql DB',
            inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['get', 'set', 'list', 'delete'] }, key: { type: 'string' }, value: { type: 'string' }, prefix: { type: 'string' }, includeValues: { type: 'boolean' } }, required: ['action'] },
            async run({ action, key, value, prefix, includeValues }) {
                if ((action === 'get' || action === 'set' || action === 'delete') && (typeof key !== 'string' || key.length === 0)) {
                    return { error: 'key required for action ' + action };
                }
                const cli = await memoryDb();
                if (action === 'set') { await cli.execute({ sql: 'INSERT OR REPLACE INTO kv VALUES (?, ?)', args: [key, value] }); await persistMemoryDb(cli); return { ok: true }; }
                if (action === 'get') { const r = await cli.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: [key] }); return { value: r.rows[0] ? r.rows[0][0] : null }; }
                if (action === 'delete') { await cli.execute({ sql: 'DELETE FROM kv WHERE k=?', args: [key] }); await persistMemoryDb(cli); return { ok: true }; }
                if (action === 'list') {
                    const cols = includeValues ? 'k, v' : 'k';
                    const sql = prefix ? `SELECT ${cols} FROM kv WHERE k LIKE ? || '%'` : `SELECT ${cols} FROM kv`;
                    const args = prefix ? [prefix] : [];
                    const r = await cli.execute({ sql, args });
                    if (includeValues) return { entries: r.rows.map(row => ({ key: row[0], value: row[1] })) };
                    return { keys: r.rows.map(row => row[0]) };
                }
                return { error: 'unknown action ' + action };
            },
        },
        chat: {
            name: 'chat', description: 'Call configured LLM via never-reject failover chain: acptoapi (localhost:4800) -> user-added OpenAI-compat gateways -> freddie (localhost:3030). Always returns {content} — even on total failure surfaces a friendly "all providers offline" message rather than throwing.',
            inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
            async run({ prompt }) {
                const CACHE_KEY = 'thebird:last-good-chat-state';
                const CACHE_MAX = 5;
                function readChatCache() {
                    try {
                        const raw = idbSnap()[CACHE_KEY];
                        if (!raw) return [];
                        const arr = JSON.parse(raw);
                        return Array.isArray(arr) ? arr : [];
                    } catch { return []; }
                }
                function writeChatCache(entry) {
                    try {
                        const s = idbSnap();
                        const list = readChatCache();
                        list.push(entry);
                        while (list.length > CACHE_MAX) list.shift();
                        s[CACHE_KEY] = JSON.stringify(list);
                        idbPersist();
                    } catch (e) { /* cache write is best-effort, never blocks chat */ }
                }
                const cfg = fs.getConfig();
                const primary = (cfg.providers && cfg.providers.openai && cfg.providers.openai.baseUrl) || 'http://localhost:4800';
                const chainCfg = Array.isArray(cfg.gatewayChain) && cfg.gatewayChain.length ? cfg.gatewayChain : [primary];
                // De-dupe while preserving order; ensure primary leads (surfaced in the
                // offline-friendly message below; the actual gateway iteration/model
                // resolution now happens inside buildBrowserCallLLM, see below).
                const seen = new Set();
                const chain = [];
                for (const u of [primary, ...chainCfg]) {
                    const n = String(u || '').replace(/\/$/, '');
                    if (!n || seen.has(n)) continue;
                    seen.add(n); chain.push(n);
                }
                const tried = [];
                // 1. Delegate the actual "call an LLM via acptoapi/gateway-chain" work to
                // buildBrowserCallLLM (freddie-chat.js) — the SAME implementation that
                // drives the live agent-turn loop (runAgentTurn). This tool used to carry
                // an independent reimplementation of that concern (a direct acptoapiFallback
                // loop) that had drifted behind it: no text-format tool-call recovery, no
                // direct-provider-key fallback, no Anthropic response-shape handling.
                // Dynamic import (not a static one) deliberately avoids a module cycle:
                // freddie-chat.js -> freddie-loader.js -> freddie-host.js -> this file
                // already exists statically, so a static import here (this file ->
                // freddie-chat.js) would close that cycle at module-eval time; a
                // call-time dynamic import does not participate in that static graph.
                try {
                    const { buildBrowserCallLLM } = await import('../freddie-chat.js');
                    // buildBrowserCallLLM only reads host.fs and (for its direct-provider-key
                    // fallback) host.agentKeysCache; the chat tool has no access to the full
                    // host object built later in bootHost, but getEnv() already falls back to
                    // fs.getApiKey() first, so an absent agentKeysCache here just means that
                    // one extra fallback source is unavailable — never a hard failure.
                    const callLLM = buildBrowserCallLLM({ fs, agentKeysCache: null });
                    const r = await callLLM({ messages: [{ role: 'user', content: prompt }] });
                    // buildBrowserCallLLM never rejects: when its OWN gateway+direct-provider
                    // chain is exhausted it resolves a friendly "No LLM backend reachable..."
                    // string with raw.provider==='offline-friendly'. That must NOT be treated
                    // as a real answer here — this tool has its own further fallbacks (freddie
                    // node API, then its own offline-cache-aware diagnosis) that would
                    // otherwise never run.
                    const isRealAnswer = r && r.content && !(r.raw && r.raw.provider === 'offline-friendly');
                    if (isRealAnswer) {
                        writeChatCache({ prompt, content: r.content, provider: (r.raw && (r.raw.baseUrl || r.raw.provider)) || 'gateway', at: Date.now() });
                        return { content: r.content, _gateway: r.raw && (r.raw.baseUrl || r.raw.provider) };
                    }
                    tried.push('gateway-chain (' + (r && r.raw && r.raw.provider === 'offline-friendly' ? 'no backend reachable' : 'no content') + ')');
                } catch (e) { tried.push('gateway-chain (' + (e && e.message || e) + ')'); }
                // 2. freddie node API fallback.
                const cfgUrl = cfg.providers && cfg.providers.freddie && cfg.providers.freddie.baseUrl;
                const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
                const ls = typeof localStorage !== 'undefined' ? localStorage : null;
                const freddieUrl = cfgUrl || (q && q.get('freddie')) || (ls && ls.getItem('freddie.baseUrl')) || 'http://localhost:3030';
                try {
                    const r = await fetch(freddieUrl.replace(/\/$/, '') + '/api/chat', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ prompt }),
                    });
                    if (r.ok) {
                        const j = await r.json();
                        const content = j.content || j.text || JSON.stringify(j);
                        writeChatCache({ prompt, content, provider: 'freddie', at: Date.now() });
                        return { content, _provider: 'freddie' };
                    }
                    tried.push('freddie (' + r.status + ')');
                } catch (e) { tried.push('freddie (' + (e && e.message || e) + ')'); }
                // 3. Total failure -> friendly message, NEVER throw. Direct browser->provider
                // fetches (bypassing acptoapi/freddie) were removed here: the layered-stack
                // contract requires thebird never fetch LLM providers directly (freddie is
                // the sole LLM-facing API); a direct-fetch fallback silently crossed that
                // boundary on every acptoapi+freddie outage instead of surfacing the real
                // fix (start acptoapi, or fix freddie).
                //
                // acptoapi/freddie are loopback services, reachable with no internet, so a
                // browser-offline check here CANNOT gate/short-circuit the chain above --
                // that would break the legitimate local-only-network use case. What IS
                // reachable: telling the user WHICH failure mode they hit, since "no
                // internet" and "acptoapi/freddie processes aren't running" need different
                // fixes and previously produced an identical, undifferentiated message.
                const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
                const diagnosis = isOffline
                    ? t('host.offlineDiagnosis', 'Your browser reports no network connection (navigator.onLine=false). Loopback services (acptoapi/freddie on localhost) do not need internet, so check they are actually running rather than your connection.\n\n')
                    : '';
                // Genuinely offline (navigator.onLine===false, not just a loopback-service
                // outage): surface the last cached good response additively, alongside the
                // existing error text, rather than leaving the user with a bare error.
                let cachedNote = '';
                let cachedEntry = null;
                if (isOffline) {
                    const cached = readChatCache();
                    cachedEntry = cached.length ? cached[cached.length - 1] : null;
                    if (cachedEntry) {
                        cachedNote = '\n\n' + t('offline.cachedStateLabel', 'Showing cached state (offline)') + ':\n' +
                            t('offline.cachedResponseFor', 'Last response (to a previous prompt, {ago}):', { ago: formatAgo(cachedEntry.at) }) +
                            '\n' + cachedEntry.content;
                    }
                }
                return {
                    content: diagnosis + t('host.allProvidersOffline', 'All LLM providers are currently offline. To get a real response, either:\n' +
                        '- start acptoapi locally (`cd C:\\dev\\acptoapi && node index.js`) — it will be tried first at {chain0}\n' +
                        '- or check the freddie fallback at {freddieUrl}\n\n' +
                        'Tried: {tried}', { chain0: chain[0], freddieUrl, tried: tried.join('; ') || '(none)' }) + cachedNote,
                    _provider: 'offline-friendly',
                    _offline: isOffline,
                    _tried: tried,
                    _cached: cachedEntry ? { prompt: cachedEntry.prompt, content: cachedEntry.content, provider: cachedEntry.provider, at: cachedEntry.at } : null,
                    // Machine-checkable failure signal: an autonomous caller (delegate,
                    // or any agent chaining through this tool) must be able to branch on
                    // this without string-matching the localized `content` message above.
                    ok: false,
                    offline: true,
                };
            },
        },
        delegate: {
            // No recursion guard: delegate only ever calls chat.run once, and chat
            // has no path back into delegate, so there is no cycle to bound here.
            // If delegate/chat ever become mutually recursive, add real depth
            // threading through dispatchTool's ctx at that point.
            name: 'delegate', description: 'Delegate sub-task to chat tool',
            inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
            async run({ task }) {
                const r = await tools.chat.run({ prompt: 'Subtask: ' + task });
                // Surface the chat tool's total-failure signal distinctly rather than
                // returning it verbatim as if it were the subtask's real answer.
                if (r && r.ok === false && r.offline) {
                    return { ...r, error: true, delegateFailed: true };
                }
                return r;
            },
        },
        web_search: {
            name: 'web_search', description: 'Search the web (DuckDuckGo Instant Answer API)',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            async run({ query }) {
                try {
                    const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_redirect=1&no_html=1&skip_disambig=1', { mode: 'cors' });
                    if (!r.ok) return { error: 'HTTP ' + r.status };
                    const j = await r.json();
                    return { abstract: j.AbstractText, related: (j.RelatedTopics || []).slice(0, 5).map(t => t.Text).filter(Boolean) };
                } catch (e) { return { error: e.message }; }
            },
        },
    };
    return tools;
}
