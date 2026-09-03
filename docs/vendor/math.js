// Inline/display math (KaTeX) rendering — lazy-loads KaTeX CSS+JS from CDN on
// first call. No-op safe: absent/failed load leaves $...$ / $$...$$ as plain
// literal text (already escaped by the markdown sanitizer), never broken markup.
// Mirrors highlight.js/mermaid.js's lazy-CDN-module pattern.

let _katex = null;
let _ready = null;
let _cssInjected = false;

const DEFAULT_KATEX_JS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs';
const DEFAULT_KATEX_CSS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
let _jsUrl = DEFAULT_KATEX_JS_URL;
let _cssUrl = DEFAULT_KATEX_CSS_URL;

export function configureKatexCdn({ jsUrl, cssUrl } = {}) {
    _jsUrl = jsUrl || DEFAULT_KATEX_JS_URL;
    _cssUrl = cssUrl || DEFAULT_KATEX_CSS_URL;
    _katex = null;
    _ready = null;
    _cssInjected = false;
}

export function getKatexCdnConfig() {
    return { jsUrl: _jsUrl, cssUrl: _cssUrl };
}

function injectCss() {
    if (_cssInjected || typeof document === 'undefined') return;
    if (document.querySelector('link[data-katex]')) { _cssInjected = true; return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = _cssUrl;
    link.setAttribute('data-katex', '');
    document.head.appendChild(link);
    _cssInjected = true;
}

export async function ensureKatex() {
    if (_katex) return _katex;
    if (_ready) return _ready;
    _ready = (async () => {
        try {
            injectCss();
            const mod = await import(_jsUrl);
            const katex = mod.default || mod;
            if (!katex || typeof katex.renderToString !== 'function') throw new Error('katex module missing renderToString()');
            _katex = katex;
            return _katex;
        } catch (err) {
            console.warn('[247420] katex loader failed:', err);
            _katex = null;
            _ready = null;
            return null;
        }
    })();
    return _ready;
}

// Render one math source to sanitized-by-construction KaTeX HTML (katex
// escapes its own output; throwOnError:false degrades a malformed expression
// to KaTeX's own inline error span rather than throwing).
async function renderOne(src, displayMode) {
    const katex = await ensureKatex();
    if (!katex) return null;
    try {
        return katex.renderToString(src, { throwOnError: false, strict: false, displayMode });
    } catch (err) {
        console.warn('[247420] katex render failed:', err);
        return null;
    }
}

// Replace $$...$$ (display) and $...$ (inline) math spans inside already-
// rendered markdown HTML text nodes under `root`. Runs AFTER markdown/
// DOMPurify have produced the DOM (never operates on raw markdown source, so
// it cannot introduce unsanitized HTML — katex's own output is inserted via
// innerHTML on a fresh span, same trust boundary as DOMPurify's own output).
// Skips code/pre content so math delimiters inside fenced or inline code are
// left alone. Idempotent (data-math-wired guard on root).
export async function renderMathBlocksUnder(root) {
    if (!root || root.dataset?.mathWired === '1') return;
    if (!root || !root.querySelectorAll) return;
    const text = root.innerHTML || '';
    if (!text.includes('$')) return;
    const katex = await ensureKatex();
    if (!katex) return;
    root.dataset.mathWired = '1';

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const p = node.parentElement;
            if (p && (p.closest('code') || p.closest('pre'))) return NodeFilter.FILTER_REJECT;
            return /\$/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    const DISPLAY_RE = /\$\$([^$]+)\$\$/g;
    const INLINE_RE = /\$([^$\n]+)\$/g;

    for (const node of nodes) {
        const src = node.nodeValue;
        if (!DISPLAY_RE.test(src) && !INLINE_RE.test(src)) continue;
        DISPLAY_RE.lastIndex = 0;
        INLINE_RE.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        // Two-pass: first split out display ($$..$$), each remaining plain
        // segment is then split for inline ($..$).
        const pieces = [];
        let m;
        while ((m = DISPLAY_RE.exec(src)) !== null) {
            if (m.index > cursor) pieces.push({ text: src.slice(cursor, m.index) });
            pieces.push({ math: m[1], display: true });
            cursor = m.index + m[0].length;
        }
        if (cursor < src.length) pieces.push({ text: src.slice(cursor) });

        for (const piece of pieces) {
            if (piece.math != null) {
                const html = await renderOne(piece.math.trim(), true);
                if (html) {
                    const span = document.createElement('span');
                    span.className = 'ds-math-display';
                    span.innerHTML = html;
                    frag.appendChild(span);
                } else {
                    frag.appendChild(document.createTextNode('$$' + piece.math + '$$'));
                }
                continue;
            }
            let sub = piece.text;
            let last = 0;
            INLINE_RE.lastIndex = 0;
            let im;
            let any = false;
            while ((im = INLINE_RE.exec(sub)) !== null) {
                any = true;
                if (im.index > last) frag.appendChild(document.createTextNode(sub.slice(last, im.index)));
                const html = await renderOne(im[1].trim(), false);
                if (html) {
                    const span = document.createElement('span');
                    span.className = 'ds-math-inline';
                    span.innerHTML = html;
                    frag.appendChild(span);
                } else {
                    frag.appendChild(document.createTextNode('$' + im[1] + '$'));
                }
                last = im.index + im[0].length;
            }
            if (!any) frag.appendChild(document.createTextNode(sub));
            else if (last < sub.length) frag.appendChild(document.createTextNode(sub.slice(last)));
        }
        node.parentNode.replaceChild(frag, node);
    }
}
