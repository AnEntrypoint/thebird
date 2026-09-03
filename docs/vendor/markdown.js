// Markdown — lazy-loads marked + DOMPurify on first call. Stub-safe:
// if loading fails, we fall back to a simple escape-and-linebreak pass so
// the chat doesn't go blank. FAIL-CLOSED: on any doubt about whether the
// sanitizer is actually active (load failure, parse/sanitize throw, or a
// purifier that doesn't look like a real DOMPurify instance), the render
// path returns escaped plaintext rather than ever risking raw HTML reaching
// innerHTML.

import { escapeHtml } from './html-escape.js';

let _ready = null;
let _marked = null;
let _purify = null;
// A failed load is NOT cached forever: we drop _ready so a later render retries,
// guarded by a small backoff so a broken/missing vendored module doesn't get
// re-imported on every keystroke.
let _failedAt = 0;
const RETRY_BACKOFF_MS = 30000;

// Vendored same-origin (docs/vendor/markdown-libs/), not fetched from a CDN at
// runtime: marked@15.0.12 and dompurify@3.2.6, pulled once at vendor-refresh
// time from jsDelivr's `+esm` bundle (self-contained, no further imports) and
// committed into the repo like every other vendored dep (xstate.js, webjsx,
// ...). This removes the runtime third-party fetch entirely — the parser and
// sanitizer bytes executing in-page are whatever is in this git tree, audited
// and diffable like any other source file, not whatever a CDN edge serves on
// a given cold load. `configureMarkdownCdn` below still allows a consumer to
// point at a different URL (e.g. a live CDN, an internal mirror) if they
// explicitly want that tradeoff; the zero-config default is now same-origin.
const DEFAULT_MARKED_URL = new URL('./markdown-libs/marked.js', import.meta.url).href;
const DEFAULT_PURIFY_URL = new URL('./markdown-libs/dompurify.js', import.meta.url).href;

let _markedUrl = DEFAULT_MARKED_URL;
let _purifyUrl = DEFAULT_PURIFY_URL;

// Optional override for where marked/DOMPurify are fetched from. Additive:
// call before the first render() to take effect (ensureReady() reads these
// module-level vars lazily on first invocation only, same as before). Every
// existing consumer that never calls this keeps hitting the vendored
// same-origin files above, byte-for-byte. Passing null/undefined for a key resets that
// one URL back to its default without touching the other.
export function configureMarkdownCdn({ markedUrl, purifyUrl } = {}) {
    if (markedUrl !== undefined) _markedUrl = markedUrl || DEFAULT_MARKED_URL;
    if (purifyUrl !== undefined) _purifyUrl = purifyUrl || DEFAULT_PURIFY_URL;
    // Force a fresh load on the next render so a runtime override (e.g. a
    // consumer switching to a self-hosted mirror after boot) actually takes.
    _ready = null;
    _failedAt = 0;
}

// Read-only introspection of the URLs actually in effect (defaults or
// override) — useful for a consumer's own SRI/CSP audit tooling.
export function getMarkdownCdnConfig() {
    return { markedUrl: _markedUrl, purifyUrl: _purifyUrl };
}

// True while the markdown stack is unavailable (escaped-fallback rendering).
// Consumers (markdown-cache) use this to avoid caching degraded output.
export function isDegraded() {
    return !_marked || !_purify || typeof _purify.sanitize !== 'function';
}

export async function ensureReady() {
    if (_ready) return _ready;
    if (_failedAt && Date.now() - _failedAt < RETRY_BACKOFF_MS) return false;
    _ready = (async () => {
        try {
            const [{ marked }, DOMPurifyMod] = await Promise.all([import(_markedUrl), import(_purifyUrl)]);
            const purify = DOMPurifyMod.default || DOMPurifyMod;
            // Fail closed if either module didn't resolve to something usable —
            // a CDN that 200s with an empty/HTML error-page body can satisfy the
            // dynamic import yet hand back a shape with no .parse/.sanitize.
            if (!marked || typeof marked.parse !== 'function') throw new Error('marked module missing parse()');
            if (!purify || typeof purify.sanitize !== 'function') throw new Error('DOMPurify module missing sanitize()');
            _marked = marked;
            _purify = purify;
            _failedAt = 0;
            return true;
        } catch (err) {
            console.warn('[247420] markdown loader failed:', err);
            // Reset the cached promise so a later render retries (after backoff).
            // Also drop any partial module refs so isDegraded()/renderMarkdown
            // never treat a half-initialized state as ready.
            _marked = null;
            _purify = null;
            _ready = null;
            _failedAt = Date.now();
            return false;
        }
    })();
    return _ready;
}

// Fail-closed plaintext fallback, always wrapped in the same safe container
// shape the real sanitized output would use (a plain block the caller can
// innerHTML directly) — never bare unwrapped text relying on caller discipline.
function escapedFallback(src) {
    return escapeHtml(src).replace(/\n/g, '<br>');
}

// The single HTML-entity escape for the whole SDK now lives in html-escape.js
// (full set incl. quotes, so it is safe in attribute contexts too).
// Re-exported here for backward compatibility with existing importers of
// escapeHtml from this module. page-html.js re-exports this as `escape`.
export { escapeHtml };

// Explicit allowlist as defence-in-depth alongside DOMPurify's own default
// policy (which already strips scripts/on*-handlers/javascript: URIs on its
// own): scoped to exactly what marked's markdown output for chat/notes needs
// -- headings, lists, code, links, images, tables, quotes, basic inline
// formatting -- so a future DOMPurify default-policy regression, or any
// caller elsewhere passing attacker-influenced sanitize options, still has a
// local backstop here rather than depending solely on upstream defaults.
const SANITIZE_CONFIG = {
    FORCE_BODY: true,
    ALLOWED_TAGS: [
        'p', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'span', 'div'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel', 'colspan', 'rowspan', 'align'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
};

export async function renderMarkdown(src) {
    const ok = await ensureReady();
    if (!ok) return escapedFallback(src);
    // Fail-closed around the parse+sanitize call itself too, not just the
    // loader: a CDN module that resolved but throws mid-parse (a malformed
    // remote payload, a marked/DOMPurify version mismatch) must never let a
    // partially-produced `raw` string reach the caller unsanitized, and must
    // never propagate an unhandled rejection that a caller might swallow into
    // a raw-HTML fallback of their own.
    try {
        const raw = _marked.parse(String(src));
        if (typeof _purify.sanitize !== 'function') throw new Error('purifier unavailable mid-render');
        return _purify.sanitize(raw, SANITIZE_CONFIG);
    } catch (err) {
        console.warn('[247420] markdown render failed, falling back to escaped text:', err);
        // Treat this exactly like a load failure: drop refs and start the
        // backoff so the next call retries a fresh load rather than re-hitting
        // whatever made this one throw.
        _marked = null;
        _purify = null;
        _ready = null;
        _failedAt = Date.now();
        return escapedFallback(src);
    }
}

// Sanitize already-rendered HTML before it touches innerHTML. For any surface
// that injects host/user-authored HTML (e.g. a wiki page body), this is the
// single XSS gate — DOMPurify strips scripts/handlers. If the purifier hasn't
// loaded, we safe-fail by escaping (raw tags show as text, never execute).
export async function sanitizeHtml(html) {
    const ok = await ensureReady();
    if (!ok) return escapeHtml(html);
    try {
        if (typeof _purify.sanitize !== 'function') throw new Error('purifier unavailable mid-sanitize');
        return _purify.sanitize(String(html), SANITIZE_CONFIG);
    } catch (err) {
        console.warn('[247420] sanitizeHtml failed, falling back to escaped text:', err);
        _marked = null;
        _purify = null;
        _ready = null;
        _failedAt = Date.now();
        return escapeHtml(html);
    }
}
