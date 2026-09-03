// agentplug-bert wasm loader: the standalone bge-small-en-v1.5 embedder
// artifact from ../gm (AnEntrypoint/agentplug-bert-bin releases), same model
// the fat plugkit.wasm used to bundle. Loaded as a SEPARATE wasm instance
// alongside plugkit-slim.wasm and wired into host_vec_embed so vector search
// stays real after the slim-wasm swap. Shares its ABI/compile/instantiate
// machinery with every other agentplug "shared plugin" wasm (see
// freddie-host-wasm-plugin.js) -- see ../gm/agentplug-bert/src/abi.rs for the
// verb ABI this file's call() wraps.
//
// LOCAL DEV: bert.wasm (~136MB) is gitignored (over GitHub's 100MB cap) — a
// fresh checkout does NOT have it until you run `node scripts/refresh-bert.mjs`
// (CI does the same at build time). Absent = a fast 404 and gm boots degraded
// (bm25-only, vector verbs fail loudly); it never blocks boot.
import { loadWasmPlugin, standardEnvImports } from './freddie-host-wasm-plugin.js';

const EMBED_DIM = 384;

// Lazy singleton: loadBertEmbedder() is called once from freddie-host-plugkit.js
// after the main plugkit wasm is up; concurrent callers share the same promise.
let bertPromise = null;

export function loadBertEmbedder() {
    if (!bertPromise) bertPromise = doLoadBertEmbedder();
    return bertPromise;
}

async function doLoadBertEmbedder() {
    // 136MB body: measured ~7-9s on a quiet local server (~16-20MB/s); 90s
    // covers a degraded ~1.5MB/s crawl with margin. Bounded so a stall fails
    // the embedder (degraded: bm25-only, gm still registers) instead of
    // parking boot forever.
    const r = await loadWasmPlugin('bert', 1_000_000, (getExp) => standardEnvImports('bert', getExp), { fetchTimeoutMs: 90000 });
    if (!r.ok) return r;

    // embed(text) -> Float32Array(EMBED_DIM) | null. `kind:'query'` applies the
    // BGE asymmetric-search query prefix (agentplug-bert's own handle_embed).
    const embed = (text, kind) => {
        const res = r.call('embed', kind ? { text, kind } : { text });
        if (!res || !res.ok || !Array.isArray(res.embedding) || res.embedding.length !== EMBED_DIM) return null;
        return Float32Array.from(res.embedding);
    };

    // Expose the raw plugin-family `call` alongside the `embed` convenience
    // wrapper: plugkit-slim.wasm routes its embeds through
    // host_plugin_call('bert', 'embed'|'embed_batch', body) (the SAME generic
    // plugin dispatch libsql uses — the dedicated host_vec_embed fast-path is
    // never invoked by this wasm build), and freddie-host-gm-bridge.js's
    // host_plugin_call requires the {ok, call} plugin shape. Without this the
    // bridge returned 'bert plugin not loaded' for every wasm-side embed and
    // all memorize/recall vector ops failed despite a healthy bert instance.
    return { ok: true, dim: EMBED_DIM, embed, call: r.call };
}

export { EMBED_DIM };
