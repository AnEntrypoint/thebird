// freddie-host gm/plugkit.wasm loader: fetch+verify+instantiate plugkit.wasm,
// wire dispatch/callHook, register the `gm` tool, and the WASI stub used when
// the real shim is unavailable. Split out of docs/freddie-host.js (pure
// move, no behavior change).
import { makeGmEnvImports } from './freddie-host-gm-bridge.js';
import { loadGmKvStore, makeLibsqlPersistence } from './freddie-host-persistence.js';
import { acptoapiFallback } from './freddie-host-gateway.js';
import { bm25Search } from './freddie-host-search.js';
import { loadBertEmbedder } from './freddie-host-bert.js';
import { loadLibsqlPlugin } from './freddie-host-libsql-plugin.js';
import { loadOxibrowserPlugin } from './freddie-host-oxibrowser-plugin.js';

export async function loadGmSkillPlugin({ ctx, host, sw }) {
    // Progress-signaled readiness: manual witness/debug probes poll this stage
    // global instead of blind-polling __debug.gm.dispatch for minutes with no
    // idea WHERE boot is stuck (the "gm.dispatch never ready" flake class).
    // Terminal stages: 'ready' | 'degraded' | 'error'.
    const setStage = (stage, detail) => {
        try {
            if (typeof globalThis !== 'undefined') globalThis.__GM_BOOT_STAGE__ = { stage, detail: detail || null, at: Date.now() };
        } catch {
            // swallow: stage reporting is best-effort telemetry, non-fatal
        }
    };
    setStage('plugkit-fetch');
    const localUrl = new URL('../vendor/gm/plugkit.wasm', import.meta.url).href;
    // plugkit.wasm is the SLIM variant (~3.6MB, no bundled bge-small embedder
    // weights — see scripts/refresh-gm.mjs and embed-onnx-browser-bge-small in
    // rs-learn). At this size it fits GitHub's 100MB single-file cap and is
    // committed straight into docs/vendor/gm/, served same-origin like every
    // other vendored kit — no Cloudflare Worker proxy, no cross-origin Release
    // fetch, no dual-URL fallback. (Historical: the OLD fat ~150MB plugkit.wasm
    // needed a Worker-proxied Release-asset fetch because a raw GitHub Release
    // download has no CORS and every free CDN refuses a file that large; that
    // whole path — infra/plugkit-wasm-proxy/ — is retired now that the
    // artifact fits same-origin. See retire-plugkit-wasm-proxy-worker.)
    // Real vector-embedding capability (host_vec_embed) comes from a SEPARATE
    // wasm instance, agentplug-bert's bert.wasm — see freddie-host-bert.js.
    let bytes;
    // sha256 integrity guard: CI/refresh-gm.mjs records the vendored wasm's own
    // hash into the same-origin ./vendor/gm/plugkit.wasm.sha256. Read it once so
    // the fetch below can reject a truncated/corrupted body that still passes
    // the weak magic-byte + size heuristic. Unreadable .sha256 => skip (degraded,
    // not fatal).
    // Kicked off in parallel with the wasm body fetch below (no data
    // dependency until the sha is actually checked against the downloaded
    // bytes) so the two same-origin round-trips overlap instead of serializing.
    let expectedSha = null;
    const shaPromise = (async () => {
        try {
            const shaUrl = new URL('../vendor/gm/plugkit.wasm.sha256', import.meta.url).href;
            const sr = await fetch(shaUrl, { cache: 'force-cache' });
            if (sr.ok) {
                const m = (await sr.text()).trim().match(/[0-9a-f]{64}/i);
                if (m) return m[0].toLowerCase();
            }
        } catch {
            // swallow: .sha256 file unreadable — degrade to no integrity check, not fatal
        }
        return null;
    })();
    // plugkit.wasm download can be aborted mid-flight when a per-instance
    // Service Worker claims the page (clients.claim()) or the page navigates
    // during boot. A single fetch with no retry surfaced as
    // "[freddie-host] gm-skill: fetch: The operation was aborted." and left
    // gm unloaded so the freddie GUI never fully rendered. Retry on abort,
    // and use force-cache so a second attempt hits the HTTP cache instantly.
    let lastErr;
    for (let attempt = 0; attempt < 4 && !bytes; attempt++) {
        // Bound each attempt so a stalled connection (no bytes flowing) aborts
        // and the retry loop tries again instead of hanging boot forever.
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(new Error('plugkit.wasm fetch timeout')), 30000);
        try {
            const r = await fetch(localUrl, { cache: 'force-cache', signal: ac.signal });
            if (!r.ok) { lastErr = new Error('plugkit.wasm fetch ' + r.status + ' from ' + localUrl); continue; }
            const buf = await r.arrayBuffer();
            // Integrity guard: a real plugkit.wasm starts with the wasm magic
            // (00 61 73 6d == "\0asm"). A non-empty body that is an HTML error
            // page or a truncated response would otherwise reach
            // WebAssembly.instantiate and throw a cryptic CompileError. Reject
            // those here and let the loop retry instead.
            const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
            const magicOk = head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
            if (buf && buf.byteLength > 1_000_000 && magicOk) {
                if (expectedSha === null) expectedSha = await shaPromise;
                if (expectedSha && typeof crypto !== 'undefined' && crypto.subtle) {
                    try {
                        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
                        let gotSha = '';
                        for (let i = 0; i < digest.length; i++) gotSha += digest[i].toString(16).padStart(2, '0');
                        if (gotSha !== expectedSha) {
                            lastErr = new Error('plugkit.wasm sha256 mismatch (got=' + gotSha.slice(0, 12) + ' want=' + expectedSha.slice(0, 12) + ')');
                            continue;
                        }
                    } catch (he) { lastErr = he; continue; }
                }
                bytes = buf; break;
            }
            lastErr = new Error('plugkit.wasm bad body (len=' + (buf ? buf.byteLength : 0) + ' magicOk=' + magicOk + ')');
        } catch (e) {
            lastErr = e;
        } finally {
            clearTimeout(tid);
        }
        // Brief backoff before retrying — gives SW claim / navigation a
        // moment to settle so the retry runs against a stable client.
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    // Degraded (not fatal): gm verbs are unavailable, but freddie's non-gm tools
    // (read/write/edit/grep/list/chat/...) still work. The marker lets the chat
    // surface say so instead of treating this as a total runtime failure.
    if (!bytes || bytes.byteLength === 0) { setStage('degraded', 'plugkit.wasm: ' + (lastErr && lastErr.message || lastErr || 'no bytes')); return { error: 'fetch: ' + (lastErr && lastErr.message || lastErr || 'no bytes after 4 attempts'), degraded: true }; }

    // Fire the ~136MB bert.wasm fetch NOW, in parallel with plugkit's own
    // compile/instantiate below, so it has the maximum possible head start
    // before the first embed-capable gm verb (memorize/recall/codesearch)
    // needs it (see the await point right before ctx.registerTool below).
    const bertEmbedderPromise = loadBertEmbedder();
    // Same treatment for libsql.wasm (~1MB, far cheaper than bert -- fired in
    // parallel purely for consistency, not because it needs the head start).
    // EVERY sql_open/sql_exec/sql_query/sql_serialize/sql_deserialize call
    // routes through host_plugin_call("libsql", ...) -- including
    // libsqlPersist.restore()'s own sql_open, called unconditionally during
    // this same boot sequence below -- so this MUST be ready before that
    // call, not just before the gm tool registers (unlike bert, whose only
    // consumer is the lazily-probed host_vec_embed).
    const libsqlPluginPromise = loadLibsqlPlugin();
    // oxibrowser.wasm (~8MB): a headless-browser plugin, not on gm's own
    // dispatch_verb critical path like bert/libsql -- fired in parallel here
    // purely so it's ready by the time anything first calls
    // host_plugin_call("oxibrowser", ...), same head-start rationale as bert.
    const oxibrowserPluginPromise = loadOxibrowserPlugin();

    const { db: kvDb, map: kvMap, embeddings: kvEmb } = await loadGmKvStore();
    const holder = { exp: null, fs: host && host.fs, db: kvDb, map: kvMap, embeddings: kvEmb || {}, sw, agentKeysCache: {}, bertEmbedder: null, libsqlPlugin: null, oxibrowserPlugin: null };
    if (sw && typeof sw.call === 'function') {
        try { holder.agentKeysCache = (await sw.call('keys-get')) || {}; } catch {
            // swallow: SW keys-get unavailable this early in boot — agentKeysCache stays {}
        }
        const refresh = async () => { try { holder.agentKeysCache = (await sw.call('keys-get')) || {}; } catch {
            // swallow: SW call failed on agent-keys-change refresh — cache keeps its last value
        } };
        if (typeof window !== 'undefined') window.addEventListener('agent-keys-change', refresh);
    }

    let instance;
    try {
        const mod = await WebAssembly.compile(bytes);
        let wasi = null;
        let wasiImports;
        try {
            const wasiUrl = new URL('../vendor/browser-wasi-shim/index.mjs', import.meta.url).href;
            const m = await import(wasiUrl);
            wasi = new m.WASI([], [], []);
            wasiImports = { wasi_snapshot_preview1: wasi.wasiImport };
        } catch (e) {
            console.warn('[freddie-host] @bjorn3/browser_wasi_shim unavailable, using stub:', e && e.message || e);
            wasiImports = { wasi_snapshot_preview1: makeStubWasi() };
        }
        const envImports = makeGmEnvImports(holder);
        // The vendored plugkit.wasm may declare host imports (e.g. host_browser_exec) that the
        // browser host cannot satisfy. Wrap in a Proxy so any unknown import resolves to a stub
        // function that returns 0n — keeps WebAssembly.instantiate happy; calls fail at runtime
        // with a friendly null instead of breaking module load.
        const envProxy = new Proxy(envImports, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string') return undefined;
                const stub = (..._args) => {
                    try {
                        if (typeof window !== 'undefined') {
                            window.__debug = window.__debug || {};
                            window.__debug.gm = window.__debug.gm || {};
                            window.__debug.gm.stubbedCalls = window.__debug.gm.stubbedCalls || {};
                            const firstHit = !window.__debug.gm.stubbedCalls[prop];
                            window.__debug.gm.stubbedCalls[prop] = (window.__debug.gm.stubbedCalls[prop] || 0) + 1;
                            if (firstHit) {
                                // Loud + deduped: a genuinely new/renamed host import silently
                                // resolving to 0n is a hard contract mismatch, not a routine no-op
                                // (see host_kv_delete BigInt-coercion incident). Fail loudly once per
                                // import name so a manual witness probe can assert stubbedCalls is empty.
                                console.error('[freddie-host] plugkit.wasm requested unknown env import "' + prop + '" — stubbed to return 0n. This likely means plugkit.wasm was updated with a new/renamed host import that freddie-host-gm-bridge.js does not implement; check window.__debug.gm.stubbedCalls.');
                            }
                        }
                    } catch {
                        // swallow: window.__debug stubbed-call counter is best-effort telemetry, non-fatal
                    }
                    return 0n;
                };
                target[prop] = stub;
                return stub;
            },
        });
        instance = await WebAssembly.instantiate(mod, { ...wasiImports, env: envProxy });
        holder.exp = instance.exports;
        if (wasi) {
            wasi.inst = instance;
            if (typeof instance.exports._initialize === 'function') {
                try { wasi.initialize(instance); } catch (e) {
                    // swallow: WASI reactor initialize is optional bootstrap; wasm still usable without it
                }
            } else if (typeof instance.exports._start === 'function') {
                try { wasi.start(instance); } catch (e) {
                    // swallow: WASI command start is optional bootstrap; wasm still usable without it
                }
            }
        }
    } catch (e) { setStage('error', 'plugkit.wasm compile/instantiate: ' + (e && e.message || e)); return { error: 'compile: ' + (e && e.message || e) }; }

    const exp = instance.exports;
    if (!exp.memory || !exp.plugkit_alloc) return { error: 'wasm missing required exports' };

    // Provision the agent-facing prose bundle into the instance fs so the wasm
    // resolver serves editable prose (.gm/instructions/<key>.md) instead of the
    // compiled const fallback. Vendored by scripts/refresh-gm.mjs into
    // ./vendor/gm/instructions/ with an index.json key list (the browser cannot
    // readdir a static dir over HTTP). Best-effort: any failure leaves the
    // resolver on its const fallback, so gm stays usable.
    try {
        const idxUrl = new URL('../vendor/gm/instructions/index.json', import.meta.url).href;
        const idxRes = await fetch(idxUrl, { cache: 'force-cache' });
        if (idxRes.ok && holder.fs && typeof holder.fs.writeFile === 'function') {
            const idx = await idxRes.json();
            const keys = idx && Array.isArray(idx.keys) ? idx.keys : [];
            let provisioned = 0;
            for (const key of keys) {
                if (typeof key !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(key) || key.includes('..')) continue;
                try {
                    const mdUrl = new URL('../vendor/gm/instructions/' + key + '.md', import.meta.url).href;
                    const mdRes = await fetch(mdUrl, { cache: 'force-cache' });
                    if (!mdRes.ok) continue;
                    const text = await mdRes.text();
                    if (text.trim()) { holder.fs.writeFile('.gm/instructions/' + key + '.md', text); provisioned++; }
                } catch {
                    // swallow: per-key instruction fetch failed — resolver falls back to compiled const for this key
                }
            }
            if (provisioned > 0 && holder.fs.flush) holder.fs.flush();
            globalThis.__gmInstructionsProvisioned = provisioned;
        }
    } catch (e) { globalThis.__gmInstructionsProvisionError = String(e && e.message || e); }

    const rawCallHook = (hookFnName, payload) => {
        const fn = exp[hookFnName];
        if (typeof fn !== 'function') return null;
        const text = JSON.stringify(payload || {});
        const enc = new TextEncoder();
        const buf = enc.encode(text);
        const ptr = Number(exp.plugkit_alloc(buf.length));
        new Uint8Array(exp.memory.buffer, ptr, buf.length).set(buf);
        let packed;
        try { packed = fn(ptr, buf.length); }
        finally { try { exp.plugkit_free(ptr, buf.length); } catch {
            // swallow: wasm free is best-effort cleanup — leaking one buffer is not fatal
        } }
        if (packed == null) return null;
        const bi = typeof packed === 'bigint' ? packed : BigInt(packed);
        const lo = Number(bi & 0xffffffffn);
        const hi = Number((bi >> 32n) & 0xffffffffn);
        const tryDecode = (p, l) => {
            if (!l || l > 1048576) return null;
            try {
                const view = new Uint8Array(exp.memory.buffer, p, l);
                const txt = new TextDecoder().decode(view);
                try { return { parsed: JSON.parse(txt) }; } catch { return { raw: txt }; }
            } catch { return null; }
        };
        const a = tryDecode(hi, lo);
        if (a && a.parsed != null) return a.parsed;
        const b = tryDecode(lo, hi);
        if (b && b.parsed != null) return b.parsed;
        return a || b || { packed: String(bi), lo, hi };
    };

    const callHook = (hookFnName, payload) => {
        const r = rawCallHook(hookFnName, payload);
        if (typeof window !== 'undefined') {
            try {
                window.__debug = window.__debug || {};
                window.__debug.gm = window.__debug.gm || { exports: Object.keys(exp), callHook: null, lastHook: null, trajectory: [] };
                window.__debug.gm.lastHook = { hook: hookFnName, payload, result: r, at: Date.now() };
                window.__debug.gm.trajectory = window.__debug.gm.trajectory || [];
                window.__debug.gm.trajectory.push({ hook: hookFnName, at: Date.now() });
                if (window.__debug.gm.trajectory.length > 100) window.__debug.gm.trajectory.shift();
            } catch {
                // swallow: window.__debug trajectory tracking is best-effort telemetry, non-fatal
            }
        }
        return r;
    };

    // Recursively coerce BigInt -> Number (or string if beyond Number.MAX_SAFE_INTEGER) so a
    // dispatch result can always be JSON.stringify'd (the agent loop serializes tool results
    // for the LLM; JSON.stringify throws on BigInt). Cheap, runs once per dispatch return.
    const sanitizeBigInt = (v) => {
        if (typeof v === 'bigint') {
            return (v <= 9007199254740991n && v >= -9007199254740991n) ? Number(v) : v.toString();
        }
        if (Array.isArray(v)) return v.map(sanitizeBigInt);
        if (v && typeof v === 'object') {
            const o = {};
            for (const k of Object.keys(v)) o[k] = sanitizeBigInt(v[k]);
            return o;
        }
        return v;
    };
    const normalizeCodesearch = (res, body) => {
        if (!res || !Array.isArray(res.data) || !res.data.length) return res;
        const first = res.data[0];
        if (first && 'key' in first && 'value' in first && !('id' in first) && !('score' in first)) {
            const ranked = bm25Search(
                { codeinsight: Object.fromEntries(res.data.map(r => [r.key, r.value])) },
                (body && body.query) || '',
                (body && body.k) || res.data.length,
            );
            return { ...res, data: ranked.map(h => { let p = null; try { p = JSON.parse(h.text); } catch { /* swallow: h.text isn't JSON — leave p null and fall back to raw h.text below */ } return { id: h.id.replace(/^codeinsight:/, ''), score: h.score, nodeType: p && p.nodeType, path: p && p.path, lineStart: p && p.lineStart, lineEnd: p && p.lineEnd, snippet: p && p.body || h.text }; }) };
        }
        return { ...res, data: res.data.map(h => { let p = null; try { p = JSON.parse(h.text); } catch { /* swallow: h.text isn't JSON — leave p null and fall back to raw h.text below */ } return { ...h, nodeType: p && p.nodeType, path: p && p.path, lineStart: p && p.lineStart, lineEnd: p && p.lineEnd, snippet: p && p.body || h.text }; }) };
    };
    const dispatchMemorizeAsync = async (text, namespace) => {
        if (!text || text.length < 200) return;
        const fs = holder.fs;
        const cfg = fs && fs.getConfig && fs.getConfig();
        const acptoapiEndpoint = cfg && cfg.providers && cfg.providers.openai && cfg.providers.openai.baseUrl || 'http://localhost:4800';
        const promptText = 'Summarize in <100 words for a memory store:\n\n' + text.slice(0, 2000);
        let summary;
        try {
            const r = await fetch(`${acptoapiEndpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', temperature: 1.0, messages: [{ role: 'user', content: promptText }] }),
            });
            if (r.ok) {
                const j = await r.json();
                summary = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            }
        } catch (e) { console.warn('[llm-learn] acptoapi fetch failed:', e && e.message); }
        if (!summary) {
            try {
                const fallback = await acptoapiFallback({ prompt: promptText, endpoint: acptoapiEndpoint });
                summary = fallback && fallback.content;
            } catch (e) { console.warn('[llm-learn] acptoapi fallback failed:', e && e.message); }
        }
        if (!summary) return;
        const arr = await embedText(summary);
        if (!arr) return;
        if (!holder.embeddings) holder.embeddings = {};
        const vecNs = (namespace || 'default') + '-vec';
        if (!holder.embeddings[vecNs]) holder.embeddings[vecNs] = {};
        const key = 'llm-sum-' + Date.now();
        holder.embeddings[vecNs][key] = arr;
        holder.map[namespace || 'default'] = holder.map[namespace || 'default'] || {};
        holder.map[namespace || 'default'][key] = summary;
        if (holder.db) {
            persistEmb(vecNs, key, arr);
            persistKv(namespace || 'default', key, summary);
        }
    };

    const dispatchLlmRerank = async (query, results) => {
        if (!query || !results || results.length < 3) return results;
        const fs = holder.fs;
        const cfg = fs && fs.getConfig && fs.getConfig();
        const acptoapiEndpoint = cfg && cfg.providers && cfg.providers.openai && cfg.providers.openai.baseUrl || 'http://localhost:4800';
        const resultsList = results.slice(0, 10).map((r, i) => `${i + 1}. [${r.namespace}:${r.id}] ${r.text.slice(0, 200)}`).join('\n');
        const promptText = `Given query: "${query}"\n\nRank these results by relevance (most relevant first). Return as JSON array of indices: [1, 3, 2, ...]\n\n${resultsList}`;
        let rankText;
        try {
            const r = await fetch(`${acptoapiEndpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', temperature: 1.0, messages: [{ role: 'user', content: promptText }] }),
            });
            if (r.ok) {
                const j = await r.json();
                rankText = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            }
        } catch (e) { console.warn('[llm-learn] acptoapi rerank fetch failed:', e && e.message); }
        if (!rankText) {
            try {
                const fallback = await acptoapiFallback({ prompt: promptText, endpoint: acptoapiEndpoint });
                rankText = fallback && fallback.content;
            } catch (e) { console.warn('[llm-learn] acptoapi rerank fallback failed:', e && e.message); }
        }
        if (!rankText) return results;
        const rankMatch = rankText.match(/\[[\d,\s]+\]/);
        if (!rankMatch) return results;
        try {
            const order = JSON.parse(rankMatch[0]);
            const seen = new Set();
            const reranked = [];
            for (const idx of order) {
                if (idx >= 1 && idx <= results.length && !seen.has(idx)) {
                    seen.add(idx);
                    reranked.push(results[idx - 1]);
                }
            }
            for (let i = 0; i < results.length; i++) {
                if (!seen.has(i + 1)) reranked.push(results[i]);
            }
            return reranked.length > 0 ? reranked : results;
        } catch (e) { console.warn('[llm-learn] rerank parse failed:', e && e.message); return results; }
    };

    // JS-side embedder for callers (LLM-learn summary path, gm.embed,
    // indexInstanceFs) that want a vector without going through wasm
    // dispatch_verb. Delegates to the same agentplug-bert instance wired into
    // host_vec_embed (holder.bertEmbedder) when it's ready, so JS-side and
    // wasm-side embeddings are the SAME real vectors, comparable by cosine
    // similarity. Falls back to a stable hash-based pseudo-embedding only when
    // the real embedder is unavailable (load failure, or called before boot's
    // await-bertEmbedderPromise gate resolves) — keeps warmup/degraded-mode
    // callers non-throwing rather than genuinely semantic.
    async function embedText(text) {
        if (!text) return null;
        const s = String(text);
        const dim = 384;
        if (holder.bertEmbedder && holder.bertEmbedder.ok) {
            const vec = holder.bertEmbedder.embed(s);
            if (vec) return Array.from(vec);
        }
        const out = new Float32Array(dim);
        // Stable but distinct: hash chars into bins.
        for (let i = 0; i < s.length; i++) out[(s.charCodeAt(i) + i) % dim] += 1;
        // L2 normalize for cosine similarity behavior.
        let n = 0;
        for (let i = 0; i < dim; i++) n += out[i] * out[i];
        n = Math.sqrt(n) || 1;
        for (let i = 0; i < dim; i++) out[i] /= n;
        return Array.from(out);
    }

    const dispatch = (verb, body) => {
        // codeinsight_index, memorize, recall, codesearch all live in wasm now (backed by
        // bundled libsql + tree-sitter inside plugkit.wasm). Do not intercept here — let
        // dispatch_verb handle them with native vector ops.
        if (verb.startsWith('exec:')) {
            const cmd = verb.slice(5);
            if (cmd === 'browser_spawn') return exp.host_browser_spawn(body && body.url);
            if (cmd === 'browser_eval') return exp.host_browser_eval(BigInt(body && body.sessionId), body && body.code);
            if (cmd === 'browser_close') return exp.host_browser_close(BigInt(body && body.sessionId));
            return { error: 'unknown exec subcommand: ' + cmd, supported: ['browser_spawn', 'browser_eval', 'browser_close'] };
        }
        // oxi_* verbs bypass gm's own dispatch_verb entirely -- oxibrowser is a
        // standalone plugin (its own plugkit_alloc/plugin_call instance), not
        // one gm's wasm calls into via call_plugin, so it's invoked directly
        // here rather than through host_plugin_call (which only serves calls
        // originating from INSIDE gm's wasm).
        if (verb.startsWith('oxi_')) {
            if (!holder.oxibrowserPlugin || !holder.oxibrowserPlugin.ok) {
                return { ok: false, error: 'oxibrowser plugin not loaded' };
            }
            return holder.oxibrowserPlugin.call(verb.slice(4), body || {});
        }
        if (typeof exp.dispatch_verb !== 'function') return { error: 'dispatch_verb not exported' };
        const enc = new TextEncoder();
        const verbBuf = enc.encode(String(verb || ''));
        const bodyStr = JSON.stringify(body || {});
        const bodyBuf = enc.encode(bodyStr);
        // plugkit_alloc can return a BigInt pointer (the wasm ABI widens to i64 once linear
        // memory grows past the 32-bit window — observed after codeinsight_index builds the
        // vector store). new Uint8Array(buffer, offset, len) and the typed-array set REQUIRE a
        // Number offset and THROW "Cannot convert a BigInt value to a number" on a BigInt — so
        // codesearch/codeinsight silently broke on a warmed-up page. Coerce alloc pointers to
        // Number for the memory-view math (pointers always fit in 2^53 here).
        const vp = Number(exp.plugkit_alloc(verbBuf.length));
        const bp = Number(exp.plugkit_alloc(bodyBuf.length));
        new Uint8Array(exp.memory.buffer, vp, verbBuf.length).set(verbBuf);
        new Uint8Array(exp.memory.buffer, bp, bodyBuf.length).set(bodyBuf);
        let packed;
        try { packed = exp.dispatch_verb(vp, verbBuf.length, bp, bodyBuf.length); }
        finally {
            try { exp.plugkit_free(vp, verbBuf.length); } catch {
                // swallow: wasm free is best-effort cleanup — leaking one buffer is not fatal
            }
            try { exp.plugkit_free(bp, bodyBuf.length); } catch {
                // swallow: wasm free is best-effort cleanup — leaking one buffer is not fatal
            }
        }
        const bi = typeof packed === 'bigint' ? packed : BigInt(packed);
        const p = Number(bi & 0xffffffffn);
        const l = Number((bi >> 32n) & 0xffffffffn);
        if (!p || !l) return null;
        const txt = new TextDecoder().decode(new Uint8Array(exp.memory.buffer, p, l));
        let parsed;
        try { parsed = JSON.parse(txt); } catch { return { raw: txt }; }
        const result = (verb === 'codesearch') ? normalizeCodesearch(parsed, body) : parsed;
        // Defensive: a normalizer (e.g. bm25 ranking) or future verb may surface a BigInt
        // score/id. The agent loop JSON.stringifies tool results into the role:tool message
        // it sends back to the LLM (freddie-chat.js), and JSON.stringify THROWS on BigInt —
        // which would silently break a gm tool call on gh-pages. Coerce any BigInt to Number
        // (or string when out of safe-integer range) so every dispatch result is JSON-safe.
        return sanitizeBigInt(result);
    };

    // Gate embed-capable verb exposure on bert.wasm settling (ready or failed)
    // BEFORE the gm tool / __GM_DISPATCH__ bridge become callable. plugkit-slim's
    // host_vec_embed probe is a Rust OnceLock: it fires once, on the FIRST
    // memorize/recall/codesearch call, and permanently caches whatever
    // host_vec_embed returns at that instant for the rest of the page session.
    // bert.wasm's fetch started in parallel with plugkit's own load above, so
    // by this point it is very likely already settled; this await only blocks
    // if it genuinely isn't, and is a one-time cost paid once per page load,
    // not per call.
    setStage('bert-await');
    holder.bertEmbedder = await bertEmbedderPromise.catch((e) => ({ error: String(e && e.message || e) }));
    if (holder.bertEmbedder && holder.bertEmbedder.ok) {
        console.log('[freddie-host] agentplug-bert embedder ready (dim=' + holder.bertEmbedder.dim + ')');
        setStage('bert-ready');
    } else {
        console.warn('[freddie-host] agentplug-bert embedder unavailable:', holder.bertEmbedder && holder.bertEmbedder.error);
        setStage('bert-failed', holder.bertEmbedder && holder.bertEmbedder.error);
        holder.bertEmbedder = null;
    }

    // libsql.wasm MUST be ready before libsqlPersist.restore()'s sql_open call
    // below (and before any sql_* verb reaches the gm tool) -- unlike bert,
    // there is no graceful "embedding degrades to bm25" fallback for a failed
    // sql_open: dispatch_verb's own SQL_VERBS all route through this one
    // plugin with no alternative path, so a missing libsqlPlugin here means
    // every sql_* verb (and the whole memory-persistence layer that depends
    // on it) throws for the rest of the page session.
    holder.libsqlPlugin = await libsqlPluginPromise.catch((e) => ({ error: String(e && e.message || e) }));
    if (holder.libsqlPlugin && holder.libsqlPlugin.ok) {
        console.log('[freddie-host] agentplug-libsql plugin ready');
        setStage('libsql-ready');
    } else {
        console.warn('[freddie-host] agentplug-libsql plugin unavailable (sql_* verbs will fail):', holder.libsqlPlugin && holder.libsqlPlugin.error);
        setStage('libsql-failed', holder.libsqlPlugin && holder.libsqlPlugin.error);
        holder.libsqlPlugin = null;
    }

    // oxibrowser has no fallback path either, but nothing else in this boot
    // sequence depends on it synchronously (unlike libsql's sql_open above),
    // so a failure here degrades only oxibrowser-backed verbs, not the whole
    // page session.
    holder.oxibrowserPlugin = await oxibrowserPluginPromise.catch((e) => ({ error: String(e && e.message || e) }));
    if (holder.oxibrowserPlugin && holder.oxibrowserPlugin.ok) {
        console.log('[freddie-host] oxibrowser plugin ready');
        setStage('oxibrowser-ready');
    } else {
        console.warn('[freddie-host] oxibrowser plugin unavailable (oxi_* verbs will fail):', holder.oxibrowserPlugin && holder.oxibrowserPlugin.error);
        setStage('oxibrowser-failed', holder.oxibrowserPlugin && holder.oxibrowserPlugin.error);
        holder.oxibrowserPlugin = null;
    }

    // Known gm verbs — used to accept forgiving arg shapes from weak models that
    // call gm as {recall:{query}} or {recall:"q"} instead of {verb:'recall',query}.
    const GM_VERBS = new Set([
        'recall', 'memorize', 'codesearch', 'codeinsight_index',
        'fs_read', 'fs_write', 'fs_stat', 'fs_readdir', 'fs_rm',
        'env_get', 'fetch', 'browser_spawn', 'browser_eval', 'browser_close',
        'sql_open', 'sql_query', 'sql_exec', 'sql_close',
        'oxi_navigate', 'oxi_evaluate', 'oxi_dom-query', 'oxi_extract-markdown', 'oxi_capabilities',
    ]);
    ctx.registerTool({
        name: 'gm',
        description: 'gm-skill engine. Call as {"verb":"recall","query":"..."} (also accepts {"recall":{"query":"..."}}). Verbs: recall (vector memory search), memorize {text}, codesearch {query}, codeinsight_index {root}, fs_read/fs_write/fs_stat/fs_readdir {path[,data]}, env_get {key}, fetch {url}, oxi_navigate {url}/oxi_evaluate {expression}/oxi_dom-query {selector}/oxi_extract-markdown (headless browser via oxibrowser).',
        async run(args) {
            if (!args || typeof args !== 'object') return { error: 'gm expects an object', usage: 'gm {"verb":"recall","query":"..."}' };
            // 1. Canonical shape: {verb, ...} or {verb, body}.
            if (args.verb) return dispatch(args.verb, args.body || args);
            // 2. Forgiving shape: a single known-verb key, e.g. {recall:{query}} /
            //    {recall:"text"} / {memorize:{text}}. Map it to dispatch(verb,args).
            const keys = Object.keys(args);
            const verbKey = keys.find(k => GM_VERBS.has(k));
            if (verbKey) {
                let body = args[verbKey];
                if (typeof body === 'string') {
                    // string positional -> best-effort arg name per verb
                    if (verbKey === 'recall' || verbKey === 'codesearch') body = { query: body };
                    else if (verbKey === 'memorize') body = { text: body };
                    else if (verbKey.startsWith('fs_') || verbKey === 'env_get') body = { path: body, key: body };
                    else body = { input: body };
                }
                // merge any sibling keys (e.g. {recall:{}, query:'x'}) so nothing is lost
                const merged = { ...args, ...(body && typeof body === 'object' ? body : {}) };
                delete merged[verbKey];
                return dispatch(verbKey, merged);
            }
            // 3. Explicit hook call.
            if (args.hook) return callHook(args.hook, args.payload || { prompt: args.prompt || '' });
            // 4. Unrecognized — return a usage hint so the model self-corrects
            //    instead of silently invoking the prompt hook.
            return { error: 'unrecognized gm args', usage: 'gm {"verb":"recall","query":"..."} — verbs: ' + [...GM_VERBS].slice(0, 8).join(', ') + ', ...' };
        },
    });

    ctx.registerHook('user_prompt_submit', async ({ prompt }) => callHook('hook_user_prompt_submit', { prompt }));

    const libsqlPersist = makeLibsqlPersistence(dispatch);
    try { await libsqlPersist.restore(); } catch (e) { console.warn('[libsql-persist] restore failed:', e && e.message || e); }

    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.gm = {
            exports: Object.keys(exp),
            callHook,
            dispatch,
            recall: (query, limit = 8, namespace = undefined) => {
                const body = { query, limit };
                if (namespace) body.namespace = namespace;
                return dispatch('recall', body);
            },
            memorize: (text, namespace = 'default') => {
                const r = dispatch('memorize', { text, namespace });
                libsqlPersist.schedule();
                return r;
            },
            codesearch: (query, k = 10) => dispatch('codesearch', { query, k }),
            persist: libsqlPersist,
            fs_read: (path) => dispatch('fs_read', { path }),
            fs_write: (path, data) => dispatch('fs_write', { path, data }),
            fs_stat: (path) => dispatch('fs_stat', { path }),
            fs_readdir: (path = '/') => dispatch('fs_readdir', { path }),
            env_get: (key) => dispatch('env_get', { key }),
            browser_spawn: (url) => dispatch('browser_spawn', { url }),
            browser_eval: (sessionId, code) => dispatch('browser_eval', { sessionId, code }),
            browser_close: (sessionId) => dispatch('browser_close', { sessionId }),
            codeinsight_index: (root = '/') => dispatch('codeinsight_index', { root }),
            embed: (text) => embedText(text),
            embeddings: holder.embeddings,
            kv: { map: holder.map, db: holder.db },
            lastHook: window.__debug.gm && window.__debug.gm.lastHook || null,
            trajectory: window.__debug.gm && window.__debug.gm.trajectory || [],
            logs: window.__debug.gm && window.__debug.gm.logs || [],
        };
    }

    // -- gm rs-learn bridge for the in-page freddie agent --------------------------
    // The vendored freddie bundle's learning layer (src/learn/gm-learn.js) cannot import
    // gm-plugkit's wasm wrapper in the browser (node:module is absent), so it probes for
    // globalThis.__GM_DISPATCH__ instead. We point it at THIS page's already-loaded plugkit
    // instance so freddie's auto-recall (turn entry), auto-learn (turn completion), the memory
    // tool, and context-engine recall all run against real rs-learn ON GH-PAGES. Verbs
    // freddie fires — memorize-fire / recall / auto-recall / memorize-prune — pass straight
    // through dispatch_verb to the wasm; we only schedule libsql persistence after a write so
    // learned memories survive a refresh, and degrade auto-recall to recall if the wasm build
    // predates that verb.
    if (typeof globalThis !== 'undefined') {
        globalThis.__GM_DISPATCH__ = (verb, body) => {
            const v = String(verb || '');
            let r;
            try {
                r = dispatch(v, body);
            } catch (e) {
                // auto-recall is newer than some wasm builds; fall back to plain recall.
                if (v === 'auto-recall') {
                    const q = typeof body === 'string' ? body : (body && body.query) || '';
                    return dispatch('recall', { query: q, limit: 5 });
                }
                throw e;
            }
            if (v === 'memorize' || v === 'memorize-fire' || v === 'memorize-prune') {
                try { libsqlPersist.schedule(); } catch (_) {
                    // swallow: scheduling libsql persistence is best-effort — a write failure here doesn't lose the in-memory memorize
                }
            }
            return r;
        };
        // Active-workspace namespace so memories isolate per thebird instance.
        globalThis.__GM_NAMESPACE__ = () => {
            try {
                const id = host && host.fs && host.fs.instanceId;
                return id ? ('instance-' + id) : 'default';
            } catch (_) { return 'default'; }
        };
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('freddie:gm-learn-ready', { detail: { namespace: globalThis.__GM_NAMESPACE__() } }));
        }
    }
    setStage('ready');
    // Legacy host-side tree-sitter indexer is superseded by wasm-side codeinsight_index
    // (rs-plugkit/src/code_index.rs + libsql). Auto-index from wasm on idle.
    setTimeout(() => {
        try {
            const idx = dispatch('codeinsight_index', { root: '/', max_files: 300 });
            if (idx && idx.ok && idx.chunks) console.log('[freddie-host] libsql codeinsight indexed', idx.chunks, 'chunks');
        } catch (e) { console.warn('[freddie-host] codeinsight_index failed:', e && e.message); }
    }, 3000);

    return { ok: true, exports: Object.keys(exp).length };
}

export function makeStubWasi() {
    const noop = () => 0;
    const fd_write = (fd, iovs, iovs_len, nwritten) => 0;
    const fd_read = () => 0;
    const proc_exit = (code) => { throw new Error('plugkit.wasm proc_exit(' + code + ')'); };
    const random_get = (buf, len) => 0;
    const clock_time_get = (id, prec, ts_out) => 0;
    return new Proxy({}, {
        get(_, k) {
            if (k === 'fd_write') return fd_write;
            if (k === 'fd_read') return fd_read;
            if (k === 'proc_exit') return proc_exit;
            if (k === 'random_get') return random_get;
            if (k === 'clock_time_get') return clock_time_get;
            return noop;
        },
    });
}
