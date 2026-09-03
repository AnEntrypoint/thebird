// Markdown & Prism cache layer with performance tracking.
// Ensures libraries are loaded once globally, reused for all subsequent renders.
// Tracks initialization status and render timings.

import { renderMarkdown, ensureReady as ensureMarkdownReady, isDegraded as isMarkdownDegraded } from './markdown.js';
import { highlightAllUnder, ensurePrism } from './highlight.js';
import { register } from './debug.js';

// Simple content-based hash for memoization (FNV-1a 32-bit)
function simpleHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return Math.abs(h).toString(36);
}

// Global cache state
let _markdownInitialized = false;
let _prismInitialized = false;
let _initPromise = null;
let _renderCache = new Map();
let _stats = {
    markdownInitMs: 0,
    totalInitMs: 0,
    prismInitMs: 0,
    renderCount: 0,
    renderTimes: [],
    cacheHits: 0,
    cacheMisses: 0,
};

/**
 * Initialize markdown and Prism in parallel on first Chat component mount.
 * Subsequent calls return cached state (0ms).
 * @returns {Promise<{ markdown: boolean, prism: boolean }>}
 */
export async function initializeCachesEagerly() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const startTime = performance.now();

        // Parallel initialization
        const [mdOk, prismOk] = await Promise.all([
            (async () => {
                const t0 = performance.now();
                const ok = await ensureMarkdownReady();
                _stats.markdownInitMs = performance.now() - t0;
                _markdownInitialized = true;
                return ok;
            })(),
            (async () => {
                const t0 = performance.now();
                const ok = await ensurePrism();
                _stats.prismInitMs = performance.now() - t0;
                _prismInitialized = true;
                return ok;
            })(),
        ]);

        // Recorded, not printed. This is library code, so an unconditional
        // console.debug writes into every consuming application's console on
        // every init. The same numbers are already live-inspectable through
        // window.__debug['markdown-cache'] (registered at the bottom of this
        // file), which is the repo's own observability channel and the one a
        // consumer can actually opt into.
        _stats.totalInitMs = performance.now() - startTime;

        return { markdown: mdOk, prism: prismOk };
    })();

    return _initPromise;
}

/**
 * Render markdown with cached loader (ensures markdown is ready first).
 * Memoizes by content hash to avoid re-parsing identical markdown.
 * @param {string} text - Markdown source
 * @returns {Promise<string>} - Sanitized HTML
 */
export async function renderMarkdownCached(text) {
    const t0 = performance.now();
    const hash = simpleHash(text || '');

    // Check content-based cache
    if (_renderCache.has(hash)) {
        _stats.cacheHits += 1;
        return _renderCache.get(hash);
    }

    // Ensure markdown is ready. NOT latched behind _markdownInitialized: a
    // failed loader must be retried on a later render (markdown.js owns the
    // retry backoff), otherwise an offline boot is sticky-degraded forever.
    await ensureMarkdownReady();
    _markdownInitialized = !isMarkdownDegraded();

    const html = await renderMarkdown(text);

    // Store in content cache (limit to 500 entries to prevent unbounded growth).
    // Never cache degraded (escaped-fallback) output: when the loader recovers,
    // the same content must re-render as real markdown, not replay the fallback.
    if (!isMarkdownDegraded()) {
        _renderCache.set(hash, html);
        if (_renderCache.size > 500) {
            const first = _renderCache.keys().next().value;
            _renderCache.delete(first);
        }
    }

    const renderMs = performance.now() - t0;
    _stats.renderCount += 1;
    _stats.cacheMisses += 1;
    _stats.renderTimes.push(renderMs);
    // Keep only last 100 samples
    if (_stats.renderTimes.length > 100) _stats.renderTimes.shift();

    return html;
}

/**
 * Highlight code block with cached Prism (ensures Prism is ready first).
 * @param {HTMLElement} el - DOM element containing <code> blocks
 * @returns {Promise<void>}
 */
export async function highlightCodeBlockCached(el) {
    // Ensure Prism is ready (cached after first init)
    if (!_prismInitialized) {
        await ensurePrism();
        _prismInitialized = true;
    }

    await highlightAllUnder(el);
}

/**
 * Get cache initialization and performance stats.
 * @returns {Object} - { markdownInitialized, prismInitialized, initMs, renderStats, cacheStats }
 */
export function getCacheStats() {
    const total = _stats.cacheHits + _stats.cacheMisses;
    return {
        markdownInitialized: _markdownInitialized,
        prismInitialized: _prismInitialized,
        initMs: {
            markdown: _stats.markdownInitMs,
            prism: _stats.prismInitMs,
            // Wall-clock for the whole init, which is not the sum of the two
            // above: they run concurrently under Promise.all, so total is the
            // slower of the pair plus overhead. Previously only ever printed
            // to console.debug; exposed here so it is inspectable instead.
            total: _stats.totalInitMs,
        },
        renderStats: {
            count: _stats.renderCount,
            avgTimeMs: _stats.renderTimes.length
                ? (_stats.renderTimes.reduce((a, b) => a + b, 0) / _stats.renderTimes.length).toFixed(2)
                : 0,
            minTimeMs: _stats.renderTimes.length ? Math.min(..._stats.renderTimes).toFixed(2) : 0,
            maxTimeMs: _stats.renderTimes.length ? Math.max(..._stats.renderTimes).toFixed(2) : 0,
        },
        cacheStats: {
            hits: _stats.cacheHits,
            misses: _stats.cacheMisses,
            hitRate: total > 0 ? (_stats.cacheHits / total * 100).toFixed(1) + '%' : 'N/A',
            cacheSize: _renderCache.size,
        },
    };
}

// Observability: expose markdown/prism cache stats live via window.__debug.
register('markdown-cache', () => getCacheStats());

/**
 * Reset cache state (for testing only).
 */
export function resetCacheState() {
    _markdownInitialized = false;
    _prismInitialized = false;
    _initPromise = null;
    _renderCache.clear();
    _stats = {
        markdownInitMs: 0,
        totalInitMs: 0,
        prismInitMs: 0,
        renderCount: 0,
        renderTimes: [],
        cacheHits: 0,
        cacheMisses: 0,
    };
}
