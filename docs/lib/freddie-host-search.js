// freddie-host BM25/vector search + tree-sitter-aware fs chunking/indexing.
// Split out of docs/freddie-host.js (pure move, no behavior change).
//
// NOTE: `vecSearch` below calls `dispatchLlmRerank(...)` which is NOT defined
// in this module (it only exists as a local const inside the original
// `loadGmSkillPlugin`, a different top-level function). That was already a
// dangling reference in the pre-split freddie-host.js — preserved verbatim
// here rather than "fixed", per the move-and-rewire mandate.

export const BM25_SKIP_NS = new Set(['outbox', 'pending_index', 'sessions']);
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

export function tokenize(text) {
    return String(text).toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length > 1 && t.length < 64);
}

export function bm25Search(map, query, k) {
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const docs = [];
    let totalLen = 0;
    for (const ns of Object.keys(map)) {
        if (BM25_SKIP_NS.has(ns)) continue;
        for (const [key, text] of Object.entries(map[ns] || {})) {
            const s = String(text);
            const toks = tokenize(s);
            if (!toks.length) continue;
            const tf = Object.create(null);
            for (const t of toks) tf[t] = (tf[t] || 0) + 1;
            docs.push({ id: ns + ':' + key, ns, key, text: s, len: toks.length, tf });
            totalLen += toks.length;
        }
    }
    if (!docs.length) return [];
    const avgLen = totalLen / docs.length;
    const df = Object.create(null);
    for (const d of docs) for (const t of Object.keys(d.tf)) df[t] = (df[t] || 0) + 1;
    const N = docs.length;
    const idf = Object.create(null);
    for (const t of Object.keys(df)) idf[t] = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
    const scored = docs.map(d => {
        let score = 0;
        for (const qt of qTokens) {
            const tf = d.tf[qt] || 0;
            if (!tf) continue;
            const num = tf * (BM25_K1 + 1);
            const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (d.len / avgLen));
            score += (idf[qt] || 0) * (num / denom);
        }
        return { id: d.id, namespace: d.ns, text: d.text.slice(0, 500), score, payload: { snippet: d.text.slice(0, 200) } };
    }).filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
    return scored;
}

export function cosineSim(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom < 1e-10 ? 0 : dot / denom;
}

export function vecSearch(holder, qJson, k) {
    let parsed;
    try { parsed = JSON.parse(qJson); } catch { return []; }
    const query = parsed.query || '';
    const embedding = parsed.embedding && Array.isArray(parsed.embedding) ? parsed.embedding : null;
    const ns = parsed.namespace || null;
    const vecEmbedMap = holder.embeddings || {};
    const results = [];
    const searchNs = ns ? [ns + '-vec'] : Object.keys(vecEmbedMap);
    for (const vecNs of searchNs) {
        const bucket = vecEmbedMap[vecNs] || {};
        for (const [key, embArr] of Object.entries(bucket)) {
            if (!embArr || !embArr.length) continue;
            const score = embedding ? cosineSim(embedding, embArr) : 0;
            const textNs = vecNs.replace(/-vec$/, '');
            const text = (holder.map[textNs] && holder.map[textNs][key]) || '';
            results.push({ id: textNs + ':' + key, namespace: textNs, text: String(text).slice(0, 500), score, payload: { snippet: String(text).slice(0, 200) } });
        }
    }
    if (embedding && results.length) {
        results.sort((a, b) => b.score - a.score);
        const topK = results.slice(0, k);
        if (query && topK.length >= 3) {
            dispatchLlmRerank(query, topK).then(reranked => {
                if (reranked && reranked.length > 0 && holder._vecSearchLastQuery === query) {
                    Object.assign(holder._vecSearchCache = holder._vecSearchCache || {}, { [query]: reranked });
                }
            }).catch(() => {});
        }
        return topK;
    }
    return bm25Search(holder.map, query, k);
}
