// freddie-host <-> plugkit.wasm host import bridge (env imports satisfying
// the wasm module's `env` namespace: fs, kv, vec search, fetch, browser exec,
// git shim, etc). Split out of docs/freddie-host.js (pure move, no behavior
// change).
import { vecSearch } from './freddie-host-search.js';
import { makeGitBuiltin } from '../shell-git.js';
import { shortUid } from '../vendor/uid.js';

// Per-directory serialization for host_git: two overlapping dispatches on the
// SAME dir (e.g. gm firing `init` then `status` in quick succession) must not
// let the second's synchronous hasRepo check race the first's still-in-flight
// runGitArgv -- the second would see no .git/ yet and return a false-negative
// "not a git repository" even though the first op is about to create it. Each
// dir gets one promise chain; every host_git call for that dir (hasRepo check
// included) is appended to it and only runs once the prior one has settled.
const gitDirQueues = new Map();
function queueGitOp(dir, fn) {
    const key = dir || '/';
    const prev = gitDirQueues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    // Keep the map from pinning stale/rejected closures forever once this
    // link settles -- swap in a bare resolved tail so later callers on the
    // same dir chain off a clean promise, not an old rejection.
    gitDirQueues.set(key, next.then(() => {}, () => {}));
    return next;
}

// One git argv through the OS terminal's own git builtin (docs/shell-git.js:
// isomorphic-git over the same live per-instance fs the terminal uses), with
// the term swapped for a capture buffer -- gm's host_git and the user's `git`
// command share ONE engine, ONE fs, ONE behavior. Everything the builtin
// prints becomes stdout (exit_code 0) or stderr (nonzero), matching real
// git's stream split for the consumers rs-plugkit's git verbs actually read.
async function runGitArgv(argv, dir, holder) {
    // makeIdbFs (shell-git-auth.js) binds window.__debug.idbSnapshot at
    // makeGitBuiltin-construction time; guarantee it is THIS instance's live
    // store even when no terminal has opened yet to wire it (os-shell.js /
    // terminal-app.js do that wiring on their own boot paths).
    if (typeof window !== 'undefined' && holder.fs && holder.fs.snapshot) {
        window.__debug = window.__debug || {};
        if (!window.__debug.idbSnapshot) window.__debug.idbSnapshot = holder.fs.snapshot;
    }
    const cfgEnv = (holder.fs && holder.fs.getConfig && holder.fs.getConfig().env) || {};
    // Commit authorship falls back the same way shell-git's own pull path does
    // (thebird/thebird@localhost) so a gm git_commit works without a prior
    // `git auth login` while still honoring an explicitly configured identity.
    const env = {
        GIT_AUTHOR_NAME: 'thebird',
        GIT_AUTHOR_EMAIL: 'thebird@localhost',
        ...cfgEnv,
    };
    let buf = '';
    const ctx = { term: { write: (s) => { buf += s; } }, cwd: dir, env, lastExitCode: 0 };
    await makeGitBuiltin(ctx)(argv);
    const text = buf.replace(/\r\n/g, '\n');
    const code = ctx.lastExitCode || 0;
    return code === 0
        ? { stdout: text, stderr: '', exit_code: 0 }
        : { stdout: '', stderr: text, exit_code: code };
}

export function makeGmEnvImports(holder) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const memBuf = () => holder.exp.memory.buffer;
    // wasm function params declared i64 arrive in JS host imports as BigInt; Uint8Array(buffer,
    // offset, length) REQUIRES Number offsets and throws "Cannot convert a BigInt value to a
    // number" on a BigInt. codeinsight_index drives the host_fs_* callbacks hardest, so this is
    // where the BigInt crash surfaced. Coerce every pointer/length to Number at the chokepoint.
    const n = (x) => typeof x === 'bigint' ? Number(x) : x;
    const readStr = (ptr, len) => {
        ptr = n(ptr); len = n(len);
        if (!ptr || !len) return '';
        return dec.decode(new Uint8Array(memBuf(), ptr, len));
    };
    const readBytes = (ptr, len) => {
        ptr = n(ptr); len = n(len);
        if (!ptr || !len) return new Uint8Array(0);
        return new Uint8Array(memBuf(), ptr, len).slice();
    };
    const packResult = (data) => {
        if (data == null) return 0n;
        const buf = typeof data === 'string' ? enc.encode(data) : data;
        if (!buf.length) return 0n;
        const ptr = n(holder.exp.plugkit_alloc(buf.length));
        new Uint8Array(memBuf(), ptr, buf.length).set(buf);
        return BigInt(ptr) | (BigInt(buf.length) << 32n);
    };
    const packJson = (obj) => packResult(JSON.stringify(obj));
    const log = (...a) => {
        try {
            if (typeof window !== 'undefined') {
                window.__debug = window.__debug || {};
                window.__debug.gm = window.__debug.gm || {};
                window.__debug.gm.logs = window.__debug.gm.logs || [];
                window.__debug.gm.logs.push({ ts: Date.now(), msg: a.join(' ') });
                if (window.__debug.gm.logs.length > 500) window.__debug.gm.logs.shift();
            }
        } catch {
            // swallow: window.__debug logging is best-effort telemetry, non-fatal
        }
    };

    const persistKv = (ns, key, val) => {
        if (!holder.db) return;
        try {
            const tx = holder.db.transaction(['kv'], 'readwrite');
            tx.objectStore('kv').put(val, ns + '\x00' + key);
        } catch (e) { log('persist err', e && e.message); }
    };

    const persistEmb = (ns, key, arr) => {
        if (!holder.db) return;
        try {
            const tx = holder.db.transaction(['embeddings'], 'readwrite');
            tx.objectStore('embeddings').put(arr, ns + '\x00' + key);
        } catch (e) { log('persist emb err', e && e.message); }
    };

    const sessions = new Map();
    let nextSid = 1;
    const sessionsRoot = () => {
        let root = document.getElementById('gm-browser-pool');
        if (!root) {
            root = document.createElement('div');
            root.id = 'gm-browser-pool';
            // Functional (not visual) positioning: the pool is a headless
            // browser substrate for gm's host_browser_exec — it must sit
            // off-screen at a fixed 1024x768 viewport and never be visible.
            // Inlined here (thebird ships no design CSS).
            root.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1024px;height:768px;visibility:hidden;';
            document.body.appendChild(root);
        }
        return root;
    };
    // Bound holder.map.browser_exec growth: each host_browser_exec call mints a fresh
    // token that is never explicitly deleted once the caller has read the pending/final
    // result (no ack/delete round-trip exists in the wasm ABI). Cap the bucket by evicting
    // oldest-by-ts entries past a fixed ceiling so a long chat/automation session cannot
    // grow this in-memory (and potentially persisted) map without bound.
    const BROWSER_EXEC_MAP_CAP = 200;
    const pruneBrowserExecMap = (map) => {
        const keys = Object.keys(map);
        if (keys.length <= BROWSER_EXEC_MAP_CAP) return;
        keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
        for (let i = 0; i < keys.length - BROWSER_EXEC_MAP_CAP; i++) delete map[keys[i]];
    };
    // Keyed-by-string session map for host_browser_exec (playwriter semantics).
    // Distinct from the numeric `sessions` map used by legacy host_browser_spawn/eval/close.
    const getOrCreateBrowserSession = (sid) => {
        if (sessions.has(sid)) return sessions.get(sid);
        const iframe = document.createElement('iframe');
        iframe.src = 'about:blank';
        // Functional fixed viewport for the headless browser substrate.
        iframe.style.cssText = 'width:1024px;height:768px;border:0;';
        iframe.dataset.gmSid = sid;
        sessionsRoot().appendChild(iframe);
        const sess = { iframe, state: {}, url: 'about:blank' };
        sessions.set(sid, sess);
        return sess;
    };
    // Loopback-gated probe for the playwriter companion bridge (scripts/playwriter-bridge.mjs,
    // default :4801), mirroring freddie-host-gateway.js's checkAcptoapi/_isLoopback/
    // _pageOnLoopback shape exactly: a page served from GH Pages (or any non-loopback
    // origin) must never attempt a loopback fetch (it hangs under Chrome's private-network
    // rules), so the probe short-circuits false there without ever issuing the request.
    // Cached with a short TTL so a repeated browser/cdp dispatch in the same page session
    // doesn't re-probe on every call, but a bridge that comes up mid-session is picked up
    // within one cache window instead of being permanently marked absent from the first miss.
    const PLAYWRITER_BRIDGE_URL = 'http://127.0.0.1:4801';
    const PLAYWRITER_PROBE_TTL_MS = 15000;
    let playwriterProbeCache = null; // { ok, ts }
    const pageOnLoopback = () => {
        try {
            const h = (typeof location !== 'undefined' && location.hostname || '').toLowerCase();
            return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '::1';
        } catch { return true; }
    };
    async function probePlaywriterBridge() {
        if (!pageOnLoopback()) return false;
        const now = Date.now();
        if (playwriterProbeCache && (now - playwriterProbeCache.ts) < PLAYWRITER_PROBE_TTL_MS) return playwriterProbeCache.ok;
        let ok = false;
        try {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 2000);
            const r = await fetch(PLAYWRITER_BRIDGE_URL + '/health', { signal: ac.signal });
            clearTimeout(t);
            if (r.ok) { const j = await r.json().catch(() => null); ok = !!(j && j.ok && j.relayReachable); }
        } catch {
            ok = false;
        }
        playwriterProbeCache = { ok, ts: now };
        return ok;
    }
    // gm session_id -> playwriter bridge state, so repeated browser/cdp dispatches within
    // the same gm session reuse one playwriter session instead of minting a fresh Chrome
    // tab per call (matches getOrCreateBrowserSession's per-sid iframe reuse below).
    const playwriterSessionsByGmSid = new Map();
    async function execViaPlaywriterBridge(code, timeoutMs, gmSid) {
        const r = await fetch(PLAYWRITER_BRIDGE_URL + '/exec', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: gmSid, code, timeout: timeoutMs }),
        });
        const j = await r.json().catch(() => ({ ok: false, error: 'bridge returned non-JSON response' }));
        playwriterSessionsByGmSid.set(gmSid, true);
        if (!r.ok || j.ok === false) {
            return { ok: false, stdout: '', stderr: String((j && (j.error || j.text)) || ('bridge http ' + r.status)), exit_code: 1, session_id: gmSid };
        }
        const text = typeof j.text === 'string' ? j.text : '';
        return { ok: !j.isError, stdout: text, stderr: j.isError ? text : '', exit_code: j.isError ? 1 : 0, session_id: gmSid, images: j.images, screenshots: j.screenshots };
    }

    // playwriter-shaped page shim against thebird's iframe browser. Same-origin only
    // (cross-origin frames can't be reached from contentWindow). Mirrors the subset of
    // playwright Page API that gm verbs actually call.
    const makePageShim = (sess) => ({
        url: () => sess.url,
        async goto(url, opts = {}) {
            return new Promise((resolve, reject) => {
                const timeout = (opts && opts.timeout) || 30000;
                const t = setTimeout(() => { sess.iframe.removeEventListener('load', onLoad); reject(new Error('goto timeout: ' + url)); }, timeout);
                const onLoad = () => { clearTimeout(t); sess.iframe.removeEventListener('load', onLoad); sess.url = url; resolve({ url }); };
                sess.iframe.addEventListener('load', onLoad);
                try { sess.iframe.src = url; } catch (e) { clearTimeout(t); reject(e); }
            });
        },
        async evaluate(fn, ...args) {
            const win = sess.iframe.contentWindow;
            if (!win) throw new Error('evaluate: cross-origin iframe (no contentWindow)');
            const src = typeof fn === 'function' ? '(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')' : String(fn);
            const inner = win.Function('return (' + src + ');');
            const v = inner();
            return await Promise.resolve(v);
        },
        async content() {
            const doc = sess.iframe.contentDocument;
            if (!doc) throw new Error('content: cross-origin iframe');
            return doc.documentElement ? doc.documentElement.outerHTML : '';
        },
        async title() {
            try { return sess.iframe.contentDocument && sess.iframe.contentDocument.title || ''; }
            catch { return ''; }
        },
        async waitForSelector(selector, opts = {}) {
            const timeout = (opts && opts.timeout) || 5000;
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                try {
                    const doc = sess.iframe.contentDocument;
                    if (doc) { const el = doc.querySelector(selector); if (el) return { selector }; }
                } catch {
                    // swallow: cross-origin/not-yet-loaded iframe document — keep polling until timeout
                }
                await new Promise(r => setTimeout(r, 100));
            }
            throw new Error('waitForSelector timeout: ' + selector);
        },
        on(_event, _cb) { /* console/pageerror listeners no-op in iframe shim */ },
    });

    // Runs `body` against the same-origin iframe shim for gm session `sid`, writing the
    // settled result into holder.map.browser_exec[token]. Shared by the direct iframe-shim
    // call path and the playwriter-bridge-unreachable fallback path so both produce the
    // identical result shape under the identical token the caller already holds.
    function runViaIframeShim(sid, body, token) {
        const sess = getOrCreateBrowserSession(sid);
        const stdout = [];
        const stderr = [];
        try {
            const page = makePageShim(sess);
            const fn = new Function('page', 'state', 'console', 'return (async () => { ' + body + ' })();');
            const captureConsole = {
                log: (...a) => stdout.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
                error: (...a) => stderr.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
                warn: (...a) => stderr.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
            };
            return Promise.resolve()
                .then(() => fn(page, sess.state, captureConsole))
                .then(v => { holder.map.browser_exec[token] = { ok: true, stdout: stdout.join('\n') + (v !== undefined ? '\n[return value] ' + JSON.stringify(v) : ''), stderr: stderr.join('\n'), exit_code: 0, session_id: sid, value: v, ts: Date.now() }; })
                .catch(e => { holder.map.browser_exec[token] = { ok: false, stdout: stdout.join('\n'), stderr: (stderr.join('\n') + '\n' + String(e && e.message || e)).trim(), exit_code: 1, session_id: sid, ts: Date.now() }; });
        } catch (e) {
            holder.map.browser_exec[token] = { ok: false, stdout: '', stderr: String(e && e.message || e), exit_code: 1, session_id: sid, ts: Date.now() };
            return Promise.resolve();
        }
    }

    return {
        host_now_ms: () => BigInt(Date.now()),
        host_log: (level, ptr, len) => { log('[wasm]', readStr(ptr, len)); return 0; },
        host_random_fill: (ptr, len) => {
            try {
                ptr = n(ptr); len = n(len);
                const mem = new Uint8Array(holder.exp.memory.buffer, ptr, len);
                if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                    const chunk = 65536;
                    for (let off = 0; off < len; off += chunk) {
                        crypto.getRandomValues(mem.subarray(off, Math.min(off + chunk, len)));
                    }
                } else {
                    for (let i = 0; i < len; i++) mem[i] = (Math.random() * 256) | 0;
                }
                return 0;
            } catch { return 1; }
        },

        host_fs_read: (pp, pl) => {
            const path = readStr(pp, pl);
            const fs = holder.fs;
            if (!fs || !fs.exists(path)) return 0n;
            try { return packResult(fs.readFile(path)); } catch { return 0n; }
        },
        host_fs_write: (pp, pl, dp, dl) => {
            const path = readStr(pp, pl);
            const data = readStr(dp, dl);
            const fs = holder.fs;
            if (!fs) return 1;
            try { fs.writeFile(path, data); fs.flush && fs.flush(); return 0; } catch { return 1; }
        },
        host_fs_readdir: (pp, pl) => {
            const path = readStr(pp, pl);
            const fs = holder.fs;
            if (!fs) return 0n;
            try { return packJson(fs.list(path) || []); } catch { return 0n; }
        },
        host_fs_stat: (pp, pl) => {
            const path = readStr(pp, pl);
            const fs = holder.fs;
            if (!fs || !fs.exists(path)) return 0n;
            const content = fs.readFile(path);
            return packJson({ kind: 'file', size: content.length, mtime: Date.now() });
        },

        host_fetch: (up, ul, op, ol) => {
            const url = readStr(up, ul);
            const optsRaw = readStr(op, ol);
            const opts = optsRaw ? (() => { try { return JSON.parse(optsRaw); } catch { return {}; } })() : {};
            const token = 'fetch-' + Date.now() + '-' + shortUid(6);
            (async () => {
                try {
                    const r = await fetch(url, opts);
                    const body = await r.text();
                    const result = { status: r.status, headers: Object.fromEntries(r.headers), body };
                    persistKv('outbox', token, JSON.stringify(result));
                    if (!holder.map.outbox) holder.map.outbox = {};
                    holder.map.outbox[token] = JSON.stringify(result);
                } catch (e) {
                    const result = { error: String(e && e.message || e) };
                    persistKv('outbox', token, JSON.stringify(result));
                    if (!holder.map.outbox) holder.map.outbox = {};
                    holder.map.outbox[token] = JSON.stringify(result);
                }
            })();
            return packJson({ pending: true, token });
        },

        // thebird's per-instance fs is root-anchored (no shell-style cwd
        // concept -- every path is absolute from '/'), so the wasm side's
        // notion of "current directory" is always the fs root.
        host_cwd: () => packResult('/'),

        host_env_get: (kp, kl) => {
            const key = readStr(kp, kl);
            const short = key.toLowerCase().replace(/_api_key$/, '');
            try {
                const ak = holder.agentKeysCache || {};
                if (ak[short]) return packResult(ak[short]);
            } catch {
                // swallow: agentKeysCache read failed — fall through to fs config env lookup below
            }
            const fs = holder.fs;
            if (fs && fs.getConfig) {
                const env = (fs.getConfig() || {}).env || {};
                if (env[key]) return packResult(env[key]);
            }
            return 0n;
        },

        host_kv_get: (np, nl, kp, kl) => {
            const ns = readStr(np, nl);
            const key = readStr(kp, kl);
            const v = holder.map[ns] && holder.map[ns][key];
            // 'outbox' is a one-shot completion mailbox (host_fetch/host_git/
            // host_browser_exec post a token's result exactly once; the wasm
            // side reads it exactly once via git_poll/outbox-poll) -- unlike
            // every other kv namespace, which is queried/read repeatedly and
            // must NOT be mutated on read. Deleting the token here, at its
            // sole consumption point, is what actually bounds holder.map.outbox
            // and the persisted IDB 'kv' store; nothing else in this file ever
            // consumes an outbox token, so no other call site can do this
            // cleanup without guessing at consumption that hasn't happened yet.
            if (ns === 'outbox' && v != null) {
                delete holder.map[ns][key];
                if (holder.db) {
                    try {
                        const tx = holder.db.transaction(['kv'], 'readwrite');
                        tx.objectStore('kv').delete(ns + '\x00' + key);
                    } catch (e) { log('persist del err', e && e.message); }
                }
            }
            return v == null ? 0n : packResult(typeof v === 'string' ? v : new Uint8Array(v));
        },
        host_kv_put: (np, nl, kp, kl, vp, vl) => {
            const ns = readStr(np, nl);
            const key = readStr(kp, kl);
            const val = readStr(vp, vl);
            if (!holder.map[ns]) holder.map[ns] = {};
            holder.map[ns][key] = val;
            persistKv(ns, key, val);
            return 1;
        },
        host_kv_query: (np, nl, qp, ql) => {
            const ns = readStr(np, nl);
            const query = readStr(qp, ql);
            const bucket = holder.map[ns] || {};
            const keys = Object.keys(bucket);
            const matches = query
                ? keys.filter(k => k.includes(query) || String(bucket[k]).includes(query))
                : keys;
            const rows = matches.slice(0, 64).map(k => ({ key: k, value: bucket[k] }));
            return packJson(rows);
        },
        // Real kv delete -- mirrors the reference wrapper's host_kv_delete
        // (plugkit-wasm-wrapper.js): the key lives in BOTH the text namespace
        // and its vector twin. MUST return a JS number (the wasm declares this
        // import i32-returning) -- the generic unknown-import Proxy stub
        // returns 0n, and a BigInt hitting an i32 return slot throws
        // "Cannot convert a BigInt value to a number" AT the wasm boundary,
        // which is what crashed codeinsight_index out of dispatch_verb (it
        // clears stale index entries via host_kv_delete exactly once per run).
        host_kv_delete: (np, nl, kp, kl) => {
            const ns = readStr(np, nl);
            const key = readStr(kp, kl);
            if (!ns || !key) return 0;
            let removed = 0;
            for (const baseNs of [ns, ns + '-vec']) {
                if (holder.map[baseNs] && key in holder.map[baseNs]) { delete holder.map[baseNs][key]; removed++; }
                if (holder.embeddings && holder.embeddings[baseNs] && key in holder.embeddings[baseNs]) { delete holder.embeddings[baseNs][key]; removed++; }
                if (holder.db) {
                    try {
                        for (const store of ['kv', 'embeddings']) {
                            const tx = holder.db.transaction([store], 'readwrite');
                            tx.objectStore(store).delete(baseNs + '\x00' + key);
                        }
                    } catch (e) { log('persist del err', e && e.message); }
                }
            }
            return removed > 0 ? 1 : 0;
        },
        // Real embedder wired via agentplug-bert (see freddie-host-bert.js) -- a
        // SEPARATE wasm instance with its own linear memory, so the returned
        // Float32Array must be copied into THIS module's (plugkit's) memory at
        // outPtr, not bert's. bert.wasm loads asynchronously in the background
        // after plugkit boots (holder.bertEmbedder is set once ready); calls
        // that land before it's ready degrade to -1, exactly like the old
        // stub, so plugkit's own probe_host_embed()/try_host_embed() fallback
        // behavior (bm25-only search, no crash) is unchanged during that window.
        host_vec_embed: (textPtr, textLen, outPtr, outLen) => {
            const bert = holder.bertEmbedder;
            if (!bert || !bert.ok) return -1;
            const text = readStr(textPtr, textLen);
            if (!text) return -1;
            const vec = bert.embed(text);
            if (!vec || vec.length !== bert.dim || n(outLen) < bert.dim) return -1;
            new Float32Array(memBuf(), n(outPtr), bert.dim).set(vec);
            return bert.dim;
        },
        // Generic shared-plugin dispatch. plugkit's dispatch_verb routes many
        // verbs (sql_open/sql_exec/... via the "libsql" plugin, memorize's
        // rerank/summary path via other plugins in the family) through
        // call_plugin(plugin_name, verb, body) on the wasm side, which lowers
        // to this ONE host import -- distinct from host_vec_embed, which is
        // its own dedicated import used only by the embed fast-path. Missing
        // this entirely (as it was until this fix) makes every libsql-backed
        // verb fail: found live 2026-07-30, sql_open throwing SQLite3Error on
        // GH Pages after the slim-wasm swap dropped the fat wasm's bundled
        // libsql, with no host_plugin_call wired to route to the standalone
        // libsql.wasm plugin (see freddie-host-libsql-plugin.js) that replaces
        // it. Currently routes "bert" (embed/embed_batch) and "libsql" (open/
        // close/exec/query/serialize/deserialize/...) by plugin name; an
        // unknown plugin name or a plugin whose loader hasn't resolved yet
        // returns a {ok:false} JSON response (not a wasm trap), matching how
        // plugkit's own call_plugin() callers already handle a plugin_ok()
        // check on every response.
        host_plugin_call: (pluginPtr, pluginLen, verbPtr, verbLen, bodyPtr, bodyLen) => {
            const plugin = readStr(pluginPtr, pluginLen);
            const verb = readStr(verbPtr, verbLen);
            const bodyStr = readStr(bodyPtr, bodyLen);
            let body;
            try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch { body = {}; }
            const inst = plugin === 'bert' ? holder.bertEmbedder
                : plugin === 'libsql' ? holder.libsqlPlugin
                : plugin === 'oxibrowser' ? holder.oxibrowserPlugin
                : null;
            if (!inst || !inst.ok || typeof inst.call !== 'function') {
                return packJson({ ok: false, error: plugin + ' plugin not loaded (call_plugin unavailable this early in boot, or an unknown plugin name)' });
            }
            let result;
            try { result = inst.call(verb, body); } catch (e) {
                return packJson({ ok: false, error: 'host_plugin_call(' + plugin + ',' + verb + ') threw: ' + (e && e.message || e) });
            }
            return packJson(result == null ? { ok: false, error: plugin + '.' + verb + ' returned no result' } : result);
        },
        host_vec_search: (qp, ql, k) => {
            const qJson = readStr(qp, ql);
            // k arrives as BigInt when the wasm declares it i64 — Array.slice(0, k)
            // inside vecSearch/bm25Search THROWS "Cannot convert a BigInt value to
            // a number" on a BigInt, taking down any dispatch that reaches a
            // vector search (observed live: codeinsight_index crashing out of
            // dispatch_verb). Coerce at the chokepoint like every pointer above.
            const top = vecSearch(holder, qJson, n(k) || 8);
            return packJson(top);
        },

        host_browser_spawn: (up, ul) => {
            const url = readStr(up, ul);
            const sid = nextSid++;
            const iframe = document.createElement('iframe');
            iframe.src = url || 'about:blank';
            iframe.style.cssText = 'width:1024px;height:768px;border:0';
            iframe.dataset.gmSid = String(sid);
            sessionsRoot().appendChild(iframe);
            sessions.set(sid, { iframe, url });
            return BigInt(sid);
        },
        host_browser_eval: (sid, cp, cl) => {
            const s = sessions.get(Number(sid));
            if (!s) return 0n;
            const code = readStr(cp, cl);
            try {
                const result = s.iframe.contentWindow.eval(code);
                return packJson({ ok: true, result: typeof result === 'object' ? result : String(result) });
            } catch (e) {
                return packJson({ ok: false, error: String(e && e.message || e) });
            }
        },
        host_browser_close: (sid) => {
            const s = sessions.get(Number(sid));
            if (!s) return 1;
            try { s.iframe.remove(); } catch {
                // swallow: iframe may already be detached — removal is idempotent cleanup
            }
            sessions.delete(Number(sid));
            return 0;
        },

        host_git: (ap, al, cp, cl) => {
            const args = readStr(ap, al);
            // plugkit sends argv as a JSON array via git_call_argv (a multi-word
            // commit message must survive intact) or as a plain string via
            // git_call; the CLI wrapper (plugkit-wasm-wrapper.js host_git)
            // accepts both shapes, so the browser host must too -- previously
            // it only whitespace-split, shattering quoted messages.
            let argv;
            const trimmed = args.trim();
            if (trimmed.startsWith('[')) {
                try { argv = JSON.parse(trimmed); } catch { argv = trimmed.split(/\s+/); }
                if (!Array.isArray(argv)) argv = String(argv).split(/\s+/);
            } else {
                argv = trimmed ? trimmed.split(/\s+/) : [];
            }
            // Whether a repository even exists at the requested cwd is answered
            // synchronously and truthfully (holder.fs IS the per-instance fs the
            // terminal builtin works on), matching real git's own failure shape
            // -- this needs no async engine work, so it never parks. Repo-
            // CREATING ops (init, clone) are exempt: their whole point is that
            // no .git exists at cwd yet.
            const dir = (readStr(cp, cl) || '/').replace(/\/+$/, '');
            const fs = holder.fs;
            const createsRepo = argv[0] === 'init' || argv[0] === 'clone';
            // Pending-token protocol, the exact shape host_fetch above already
            // implements and rs-plugkit's git_call_async/git_poll now consume:
            // host_git is a SYNCHRONOUS wasm import and the browser git engine
            // (isomorphic-git via docs/shell-git.js) is promise-based end to
            // end, and no promise can resolve while the main thread is parked
            // inside this sync wasm call -- so the op is parked, driven right
            // after this call returns, and the terminal
            // {stdout,stderr,exit_code} JSON string is posted to kv ns 'outbox'
            // under the token (in-memory map + persisted kv, same dual post as
            // host_fetch). The wasm side observes completion on a LATER
            // dispatch (git_poll {token}), never by waiting inside this one.
            const token = 'git-' + Date.now() + '-' + shortUid(6);
            // Outbox-post guarantee: the token must reach a terminal state no
            // matter how the op ends. A rejected op posts its error shape via
            // the catch; an op whose promise NEVER settles (hung fs promise on
            // a corrupt .git, a wedged transport) would otherwise pend the
            // wasm-side git_poll loop forever -- bound it with a host-side
            // timeout that posts a truthful failure. settled guards the late
            // completion from overwriting an already-consumed token.
            const GIT_OP_HOST_TIMEOUT_MS = 120000;
            queueGitOp(dir, async () => {
                let settled = false;
                const post = (result) => {
                    if (settled) return;
                    settled = true;
                    const posted = JSON.stringify(result);
                    persistKv('outbox', token, posted);
                    if (!holder.map.outbox) holder.map.outbox = {};
                    holder.map.outbox[token] = posted;
                };
                // hasRepo is (re-)checked HERE, inside this dir's queued slot,
                // not synchronously at dispatch time -- so a `status` queued
                // right after an in-flight `init` for the same dir sees the
                // repo exactly as it will be once its turn actually runs,
                // never a stale pre-init snapshot.
                const hasRepo = !!(fs && fs.list(dir + '/.git/').length);
                if (!createsRepo && !hasRepo) {
                    post({ stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git', exit_code: 128 });
                    return;
                }
                const timer = setTimeout(() => post({ stdout: '', stderr: 'git ' + (argv[0] || 'op') + ' timed out host-side after ' + (GIT_OP_HOST_TIMEOUT_MS / 1000) + 's: the browser git engine never settled (a hung fs promise or wedged transport) -- failing the step truthfully instead of pending forever', exit_code: 1 }), GIT_OP_HOST_TIMEOUT_MS);
                try { post(await runGitArgv(argv, dir || '/', holder)); }
                catch (e) { post({ stdout: '', stderr: String(e && e.message || e), exit_code: 1 }); }
                finally { clearTimeout(timer); }
            });
            return packJson({ pending: true, token });
        },

        // host_browser_exec: satisfies gm's browser/cdp verbs (rs-plugkit host_abi.rs's
        // 8-param shape: code, cwd, session_id, and a separate small opts JSON string
        // carrying {timeoutMs,engine} -- code itself is always raw JS, never JSON-wrapped,
        // matching host_exec_js's already-established two-buffer convention).
        //
        // opts.engine names which CDP-family engine rs-plugkit's browser (engine:"lightpanda")
        // or cdp (engine:"chrome") verb wants. On a native agentplug-runner host that spawns a
        // real OS process (browser_engine.rs's select_engine); thebird has no such process
        // spawn capability at all (a browser tab's JS sandbox cannot fork lightpanda or
        // Chrome). When engine is lightpanda/chrome AND a companion playwriter bridge
        // (scripts/playwriter-bridge.mjs, default :4801 -> playwriter relay :19988) answers
        // its /health probe, this drives a REAL separate Chrome tab via playwriter's own
        // Playwright-snippet sandbox -- a genuine cross-origin-capable CDP session, unlike
        // the iframe shim below. Falls back unchanged to the same-origin iframe shim when the
        // bridge is unreachable (no companion process running, or a non-loopback page origin
        // such as GH Pages) -- zero behavior change for every existing serp/iframe-shim caller.
        // The bridge call is a real network round trip and cannot block this synchronous wasm
        // import, so it uses the same pending-token/outbox-poll pattern host_fetch/host_git
        // already establish: this call returns {pending:true,token} immediately, and a later
        // dispatch reads holder.map.browser_exec[token] once the async work settles.
        host_browser_exec: (bp, bl, cp, cl, sp, sl, op, ol) => {
            try {
                const body = readStr(bp, bl);
                const cwd = readStr(cp, cl);
                const sid = readStr(sp, sl) || 'default';
                const optsRaw = op !== undefined ? readStr(op, ol) : '';
                let opts = {};
                try {
                    const parsed = optsRaw ? JSON.parse(optsRaw) : {};
                    // JSON.parse succeeds on non-object top-level values ('null', '42', '"x"',
                    // arrays) that would then throw reading .engine/.timeoutMs below -- only a
                    // genuine plain object is usable as opts, anything else degrades to {}.
                    opts = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
                } catch { opts = {}; }
                const engine = typeof opts.engine === 'string' ? opts.engine : '';
                const timeoutMs = Number(opts.timeoutMs) || 30000;

                // Special: "session new" / "session list" / "session close <id>"
                if (body.startsWith('session ')) {
                    const parts = body.slice(8).trim().split(/\s+/);
                    const sub = parts[0];
                    if (sub === 'new') {
                        const nsid = 'gm-' + Date.now().toString(36) + '-' + shortUid(4);
                        getOrCreateBrowserSession(nsid);
                        return packJson({ ok: true, stdout: `Session ${nsid} created.\n`, stderr: '', exit_code: 0, session_id: nsid });
                    }
                    if (sub === 'list') {
                        const ids = [...sessions.keys()];
                        return packJson({ ok: true, stdout: ids.join('\n') + '\n', stderr: '', exit_code: 0 });
                    }
                    if (sub === 'close') {
                        const target = parts[1];
                        const s = sessions.get(target);
                        if (s) { try { s.iframe.remove(); } catch {
                            // swallow: iframe may already be detached — removal is idempotent cleanup
                        } sessions.delete(target); }
                        if (playwriterSessionsByGmSid.has(target)) {
                            playwriterSessionsByGmSid.delete(target);
                            fetch(PLAYWRITER_BRIDGE_URL + '/session-close', {
                                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: target }),
                            }).catch(() => {});
                        }
                        return packJson({ ok: true, stdout: `Session ${target} closed.\n`, stderr: '', exit_code: 0 });
                    }
                    return packJson({ ok: false, stderr: 'unknown session subcommand: ' + sub, exit_code: 2 });
                }

                // Real-CDP path: engine explicitly requested AND the companion bridge is up.
                // Async (network round trip), so it uses the SAME pending-token protocol the
                // iframe path below already returns -- callers never need to know which path
                // answered a given token.
                if ((engine === 'lightpanda' || engine === 'chrome')) {
                    const token = 'bx-' + Date.now().toString(36) + '-' + shortUid(4);
                    if (!holder.map.browser_exec) holder.map.browser_exec = {};
                    holder.map.browser_exec[token] = { pending: true, ts: Date.now() };
                    pruneBrowserExecMap(holder.map.browser_exec);
                    probePlaywriterBridge().then((bridgeUp) => {
                        if (!bridgeUp) {
                            // Fall through to the iframe shim, synchronously, from inside this
                            // async continuation -- same token, so the caller's poll loop sees
                            // one coherent result regardless of which path actually answered.
                            return runViaIframeShim(sid, body, token);
                        }
                        return execViaPlaywriterBridge(body, timeoutMs, sid)
                            .then((r) => { holder.map.browser_exec[token] = { ...r, ts: Date.now() }; })
                            .catch((e) => { holder.map.browser_exec[token] = { ok: false, stdout: '', stderr: String(e && e.message || e), exit_code: 1, session_id: sid, ts: Date.now() }; });
                    });
                    return packJson({ pending: true, token, session_id: sid });
                }

                // Sync return: caller can't await a Promise across the wasm boundary.
                // Stash a pending token; caller calls again (or polls holder.map.browser_exec)
                // to read the settled result once runViaIframeShim's promise resolves.
                const token = 'bx-' + Date.now() + '-' + shortUid(4);
                if (!holder.map.browser_exec) holder.map.browser_exec = {};
                holder.map.browser_exec[token] = { pending: true, ts: Date.now() };
                pruneBrowserExecMap(holder.map.browser_exec);
                runViaIframeShim(sid, body, token);
                return packJson({ pending: true, token, session_id: sid });
            } catch (e) { return packJson({ ok: false, error: String(e && e.message || e) }); }
        },

        host_exec_js: (cp, cl, op, ol) => {
            const code = readStr(cp, cl);
            const optsRaw = readStr(op, ol);
            const opts = optsRaw ? (() => { try { return JSON.parse(optsRaw); } catch { return {}; } })() : {};
            try {
                const fn = new Function('opts', code);
                const out = fn(opts);
                return packJson({ ok: true, stdout: typeof out === 'string' ? out : JSON.stringify(out), exitCode: 0 });
            } catch (e) {
                return packJson({ ok: false, stderr: String(e && e.message || e), exitCode: 1 });
            }
        },
    };
}
