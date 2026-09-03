// The two heavyweight prose bubbles: MdNode (markdown parse with a streaming
// throttle, idle-deferred settled parse, selection-safe innerHTML swap, and
// mermaid/math enrichment) and CodeNode (cached Prism highlight + copy head).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { renderMarkdownCached, highlightCodeBlockCached } from '../../markdown-cache.js';
import { isDegraded as isMarkdownDegraded } from '../../markdown.js';
import { renderMermaidBlocksUnder } from '../../mermaid.js';
import { renderMathBlocksUnder } from '../../math.js';
import { injectCodeCopy, copyToClipboardWithFeedback } from './inline.js';

const h = webjsx.createElement;

const MD_STREAM_THROTTLE_MS = 120;
const MD_STREAM_MIN_DELTA_CHARS = 40;

// requestIdleCallback with a setTimeout fallback (Safari/non-browser test
// contexts lack the real API). A settled historical message's parse is not
// latency-critical the way a streaming turn's is — deferring it off the
// critical path keeps a session-load burst of N historical bubbles from
// racing N synchronous parses on the same tick.
const scheduleIdle = typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 500 })
    : (fn) => setTimeout(fn, 0);

export function MdNode(p) {
    const refSink = (el) => {
        if (!el) return;
        // Version the per-element source key with a degraded marker: a bubble
        // rendered while the markdown loader was down re-renders (real markdown)
        // once the loader recovers, instead of staying plain-escaped forever.
        const srcKey = (isMarkdownDegraded() ? '~degraded~' : '') + (p.text || '');
        if (el.dataset.mdSrc === srcKey) return;
        // While streaming (text still growing, not the final settle), a full
        // re-parse of the WHOLE accumulated text on every rAF tick is the
        // dominant cost of a long stream. Throttle: skip the parse unless
        // enough time or enough new characters landed since the last one.
        // p.streamingCaret (already threaded by the host for the stream-head
        // caret) marks "still streaming"; its absence forces the final parse
        // so nothing is left un-parsed once the turn settles.
        const parsedLen = el.dataset.mdParsedLen ? Number(el.dataset.mdParsedLen) : 0;
        const lastParseAt = el.dataset.mdLastParseAt ? Number(el.dataset.mdLastParseAt) : 0;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (p.streamingCaret && parsedLen > 0 &&
            (now - lastParseAt) < MD_STREAM_THROTTLE_MS &&
            (srcKey.length - parsedLen) < MD_STREAM_MIN_DELTA_CHARS) {
            // Not enough new content/time yet — paint raw text so the latest
            // characters are visible, but defer the expensive re-parse.
            el.textContent = p.text || '';
            return;
        }
        el.dataset.mdSrc = srcKey;
        el.dataset.mdParsedLen = String(srcKey.length);
        el.dataset.mdLastParseAt = String(now);
        // Markdown stack still loading (or down): paint the raw text
        // synchronously so streamed tokens are visible the same frame they
        // arrive (an empty bubble until the CDN import resolves reads as a
        // hang); the resolved render swaps in sanitized markdown in place.
        if (isMarkdownDegraded()) el.textContent = p.text || '';
        function doParse() {
            renderMarkdownCached(p.text || '').then((html) => {
                // The element may have been recycled (webjsx applyDiff reused this
                // DOM node for a different message) or detached by the time an
                // idle-deferred parse resolves -- re-check the source key still
                // matches before swapping innerHTML into what could now be a
                // completely different message's bubble.
                if (el.dataset.mdSrc !== srcKey) return;
                const swap = () => {
                    el.innerHTML = html;
                    delete el.dataset.mathWired;
                    injectCodeCopy(el);
                    // Diagram/math enrichment runs AFTER sanitized HTML is in the DOM
                    // (never on raw markdown source) and is best-effort: a failed or
                    // still-loading mermaid/katex CDN leaves the fenced/literal source
                    // visible rather than blocking or blanking the bubble.
                    renderMermaidBlocksUnder(el).catch(() => {});
                    renderMathBlocksUnder(el).catch(() => {});
                };
                // Don't blow away an active text selection inside this bubble mid-swap
                // (e.g. the user is mid-copy while a stream tick settles). Defer the
                // swap once, until the selection changes (cleared or moved elsewhere).
                const sel = typeof window !== 'undefined' ? window.getSelection() : null;
                if (sel && sel.anchorNode && el.contains(sel.anchorNode)) {
                    const onSelChange = () => { document.removeEventListener('selectionchange', onSelChange); swap(); };
                    document.addEventListener('selectionchange', onSelChange, { once: true });
                    return;
                }
                swap();
            }).catch((e) => {
                console.error('renderMarkdownCached failed:', e);
                if (el.dataset.mdSrc === srcKey) el.textContent = p.text || '';
            });
        }
        // Streaming turns parse immediately (latency-critical: the user is
        // watching this bubble grow). A settled historical message (no
        // streamingCaret) is deferred to an idle slot -- not on the critical
        // render path, so a page mounting many historical bubbles at once
        // (session load) doesn't burst-parse them all synchronously.
        if (p.streamingCaret) doParse();
        else scheduleIdle(doParse);
    };
    return h('div', { class: 'chat-bubble chat-md', ref: refSink });
}

export function CodeNode(p) {
    const refSink = (el) => {
        if (!el) return;
        // Key on the full code, not its length: two different blocks of the same
        // length (e.g. an edit that swaps a line) would otherwise share a key and
        // skip re-highlighting, leaving stale syntax coloring.
        const codeKey = (p.lang || '') + '|' + (p.code || '');
        if (el.dataset.codeKey === codeKey) return;
        el.dataset.codeKey = codeKey;
        // Same in-progress-selection guard as MdNode.refSink: don't wipe an
        // active text selection inside this block mid-stream-settle. Defer
        // the highlight swap once, until the selection changes.
        const sel = typeof window !== 'undefined' ? window.getSelection() : null;
        if (sel && sel.anchorNode && el.contains(sel.anchorNode)) {
            const onSelChange = () => { document.removeEventListener('selectionchange', onSelChange); highlightCodeBlockCached(el); };
            document.addEventListener('selectionchange', onSelChange, { once: true });
            return;
        }
        highlightCodeBlockCached(el);
    };
    // Copy the raw code (not the highlighted DOM) for the structured CodeNode.
    const onCopy = (e) => copyToClipboardWithFeedback(p.code || '', e.currentTarget);
    return h('div', { class: 'chat-bubble chat-code', ref: refSink },
        h('div', { class: 'chat-code-head' },
            h('span', { class: 'lang' }, p.lang || 'code'),
            p.filename ? h('span', { class: 'name' }, p.filename) : null,
            h('span', { class: 'spread' }),
            h('button', { type: 'button', class: 'chat-code-copy chat-code-copy-head', 'aria-label': 'copy code', onclick: onCopy }, 'copy')
        ),
        h('pre', {}, h('code', { class: p.lang ? 'lang-' + p.lang + ' language-' + p.lang : '' }, p.code || ''))
    );
}
