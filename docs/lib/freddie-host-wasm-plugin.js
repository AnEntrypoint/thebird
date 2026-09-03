// Shared loader for the agentplug "shared plugin" wasm family (bert, libsql,
// treesitter, ...): standalone wasm32-wasip1 artifacts published by ../gm's
// AnEntrypoint/agentplug-<name>-bin releases, each with the SAME ABI
// convention as plugkit itself -- plugin_call(verb_ptr,verb_len,body_ptr,
// body_len)->u64 packed ptr<<32|len, plugkit_alloc/plugkit_free, a
// wasi_snapshot_preview1 import set alongside their own bare `env` imports.
// Extracted from the bert-specific loader once a second plugin (libsql) needed
// the identical compile/instantiate/call machinery -- see
// freddie-host-bert.js and freddie-host-libsql-plugin.js for the per-plugin
// env-import sets and call() wrappers built on top of this.

// Compiles+instantiates a shared-plugin wasm module fetched from
// vendor/gm/<name>.wasm, given its own `env` imports object (built by the
// caller, since each plugin needs a different subset of host_log/
// host_now_ms/host_random_fill/etc). Returns { exp, call } on success or
// { error } on failure -- never throws.
//
// The fetch is BOUNDED: a stalled connection (server wedged mid-body, half-open
// TCP) would otherwise park this await forever -- and since
// freddie-host-plugkit.js awaits the bert plugin before registering the gm
// tool (Rust OnceLock constraint), an unbounded stall here is what made
// __GM_DISPATCH__ / window.__debug.gm.dispatch never appear (the witness-*.mjs
// "gm.dispatch never ready" flake). Each attempt aborts after timeoutMs and
// network-level failures (abort/reset/TypeError) get ONE retry -- the same
// SW-claim-mid-boot abort race plugkit.wasm's own loader retries for. A clean
// HTTP error (404 = not vendored locally; fetch it via
// `node scripts/refresh-bert.mjs` / refresh-gm.mjs) fails immediately -- a
// missing file does not reappear within a page session.
export async function loadWasmPlugin(name, minBytes, envImportsFactory, opts = {}) {
    const localUrl = new URL('../vendor/gm/' + name + '.wasm', import.meta.url).href;
    const timeoutMs = opts.fetchTimeoutMs || 60000;
    let bytes;
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !bytes; attempt++) {
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(new Error(name + '.wasm fetch timeout after ' + timeoutMs + 'ms')), timeoutMs);
        try {
            const r = await fetch(localUrl, { cache: 'force-cache', signal: ac.signal });
            if (!r.ok) { lastErr = name + '.wasm fetch ' + r.status; break; }
            const buf = await r.arrayBuffer();
            const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
            const magicOk = head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
            if (!magicOk || buf.byteLength < minBytes) { lastErr = name + '.wasm bad body (len=' + buf.byteLength + ' magicOk=' + magicOk + ')'; break; }
            bytes = buf;
        } catch (e) {
            // abort/timeout/reset — retry once, the SW-claim window may have settled
            lastErr = name + '.wasm fetch: ' + (e && e.message || e);
        } finally {
            clearTimeout(tid);
        }
    }
    if (!bytes) return { error: lastErr || (name + '.wasm: no bytes') };

    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let exp;
    const envImports = envImportsFactory(() => exp);

    let instance;
    try {
        const mod = await WebAssembly.compile(bytes);
        // Every plugin in this family pulls in a WASI import set
        // (wasi_snapshot_preview1: random_get/environ_get/fd_*/path_open/...)
        // alongside its bare `env` imports -- same real requirement
        // plugkit.wasm has, wired via the same shared shim (verified live via
        // Node-side WebAssembly.compile on bert.wasm: WebAssembly.Module.imports
        // lists 14 wasi_snapshot_preview1 entries on top of its own env
        // imports; instantiate() throws "module is not an object or function"
        // without this).
        let wasi = null;
        let wasiImports;
        try {
            const wasiUrl = new URL('../vendor/browser-wasi-shim/index.mjs', import.meta.url).href;
            const m = await import(wasiUrl);
            wasi = new m.WASI([], [], []);
            wasiImports = { wasi_snapshot_preview1: wasi.wasiImport };
        } catch (e) {
            return { error: name + '.wasm: browser-wasi-shim unavailable: ' + (e && e.message || e) };
        }
        instance = await WebAssembly.instantiate(mod, { ...wasiImports, env: envImports });
        exp = instance.exports;
        if (wasi) {
            wasi.inst = instance;
            if (typeof instance.exports._initialize === 'function') {
                try { wasi.initialize(instance); } catch { /* swallow: WASI reactor initialize is optional bootstrap */ }
            } else if (typeof instance.exports._start === 'function') {
                try { wasi.start(instance); } catch { /* swallow: WASI command start is optional bootstrap */ }
            }
        }
    } catch (e) { return { error: name + '.wasm compile/instantiate: ' + (e && e.message || e) }; }

    if (!exp.memory || !exp.plugkit_alloc || !exp.plugin_call) return { error: name + '.wasm missing required exports' };

    const call = (verb, body) => {
        const verbBuf = enc.encode(verb);
        const bodyBuf = enc.encode(JSON.stringify(body || {}));
        const vp = Number(exp.plugkit_alloc(verbBuf.length));
        const bp = Number(exp.plugkit_alloc(bodyBuf.length));
        new Uint8Array(exp.memory.buffer, vp, verbBuf.length).set(verbBuf);
        new Uint8Array(exp.memory.buffer, bp, bodyBuf.length).set(bodyBuf);
        let packed;
        try { packed = exp.plugin_call(vp, verbBuf.length, bp, bodyBuf.length); }
        finally {
            try { exp.plugkit_free(vp, verbBuf.length); } catch { /* swallow: best-effort free */ }
            try { exp.plugkit_free(bp, bodyBuf.length); } catch { /* swallow: best-effort free */ }
        }
        const bi = typeof packed === 'bigint' ? packed : BigInt(packed);
        const p = Number(bi & 0xffffffffn);
        const l = Number((bi >> 32n) & 0xffffffffn);
        if (!p || !l) return null;
        const txt = dec.decode(new Uint8Array(exp.memory.buffer, p, l));
        try { return JSON.parse(txt); } catch { return { raw: txt }; }
    };

    return { ok: true, exp, call };
}

// Standard host_log/host_random_fill/host_now_ms triple every plugin in this
// family needs -- `getExp` is a thunk since `exp` isn't assigned until AFTER
// instantiate() returns, but these imports must exist in the object passed
// INTO instantiate().
export function standardEnvImports(name, getExp) {
    const dec = new TextDecoder();
    return {
        host_log: (level, ptr, len) => {
            try { console.log('[' + name + '.wasm]', dec.decode(new Uint8Array(getExp().memory.buffer, ptr, len))); } catch { /* swallow: log decode is best-effort telemetry */ }
            return 0;
        },
        host_random_fill: (ptr, len) => {
            try {
                const mem = new Uint8Array(getExp().memory.buffer, ptr, len);
                if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(mem);
                else for (let i = 0; i < len; i++) mem[i] = (Math.random() * 256) | 0;
                return 1;
            } catch { return 0; }
        },
        host_now_ms: () => BigInt(Date.now()),
    };
}
