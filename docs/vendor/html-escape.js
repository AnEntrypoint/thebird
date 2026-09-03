// Single source of HTML/JSON escaping for the whole SDK and every static-site
// consumer that embeds SDK-produced markup or JSON into an HTML document.
// Exported from the SDK root so consumer theme.mjs files (this repo's own
// site/theme.mjs included) import these instead of pasting their own copy.

// Full HTML-entity escape (incl. quotes), safe in both text and attribute
// contexts.
export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

// U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR are valid JSON string
// contents but invalid raw JS string-literal contents, so they must be
// entity-escaped too before this can be safely embedded in an inline
// <script> block. Built from character codes rather than a literal
// character or bare regex literal so no raw U+2028/U+2029 byte has to
// survive on disk (some toolchains mangle/strip it), and so it never risks
// being parsed as a source-level line terminator.
const LINE_SEP_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP_RE = new RegExp(String.fromCharCode(0x2029), 'g');

// Safe to embed the result of JSON.stringify inside a <script type="...">
// block: escapes </script>-breaking sequences and the two line-terminator
// code points that are valid JSON but invalid raw JS string literals.
export function escapeJson(obj) {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
        .replace(LINE_SEP_RE, '\\u2028').replace(PARA_SEP_RE, '\\u2029');
}
