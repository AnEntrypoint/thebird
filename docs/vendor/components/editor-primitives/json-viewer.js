// ---------------------------------------------------------------------------
// JsonViewer — monospace data preview (max-height + scroll), generalizing
// gmsniff's gm-json. Accepts a pre-stringified string OR any value
// (objects/arrays get JSON.stringify(v, null, 2); null/undefined render the
// empty-state text rather than the literal string "undefined"/"null").
//
// mode selects rendering; 'plain' is the historical contract (children[0] is
// the raw text string, verbatim for string input) and stays the default so
// every existing consumer is untouched:
//   'plain'     — flat <pre>, raw text.
//   'highlight' — flat <pre>, text tokenized into ds-ep-json-* spans
//                 (key/string/number/boolean/null). A string that does not
//                 parse as JSON falls back to plain text — arbitrary prose is
//                 never falsely tokenized.
//   'tree'      — collapsible <details> tree per nested object/array, open
//                 above treeDepth (default 2), each summary carrying a
//                 child-count tag. Scalars/unparseable input fall back to
//                 'highlight'/plain respectively.
// copyable=true wraps the viewer with a copy-to-clipboard button (transient
// copied/failed feedback, no dependencies).
// ---------------------------------------------------------------------------

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

const JSON_NUM_CHARS = '0123456789eE+.-';

// Linear single-pass scan — no regex, no backtracking, safe on truncated
// input (an unterminated string just consumes to end-of-text).
function tokenizeJson(text) {
    const toks = [];
    let i = 0, plain = '';
    const flush = () => { if (plain) { toks.push(['', plain]); plain = ''; } };
    while (i < text.length) {
        const c = text[i];
        if (c === '"') {
            const start = i;
            i++;
            while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
            i = Math.min(i + 1, text.length);
            let j = i;
            while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) j++;
            flush();
            toks.push([text[j] === ':' ? 'k' : 's', text.slice(start, i)]);
            continue;
        }
        if (c === '-' || (c >= '0' && c <= '9')) {
            const start = i;
            i++;
            while (i < text.length && JSON_NUM_CHARS.includes(text[i])) i++;
            flush();
            toks.push(['n', text.slice(start, i)]);
            continue;
        }
        if (text.startsWith('true', i)) { flush(); toks.push(['b', 'true']); i += 4; continue; }
        if (text.startsWith('false', i)) { flush(); toks.push(['b', 'false']); i += 5; continue; }
        if (text.startsWith('null', i)) { flush(); toks.push(['z', 'null']); i += 4; continue; }
        plain += c; i++;
    }
    flush();
    return toks;
}

function highlightJsonSpans(text) {
    return tokenizeJson(text).map(([t, s]) => t ? h('span', { class: 'ds-ep-json-' + t }, s) : s);
}

function jsonTreeNode(key, val, depth, treeDepth) {
    const keyParts = key != null ? [h('span', { class: 'ds-ep-json-k' }, JSON.stringify(key)), ': '] : [];
    if (val !== null && typeof val === 'object') {
        const isArr = Array.isArray(val);
        const entries = isArr ? val.map((v) => [null, v]) : Object.entries(val);
        if (!entries.length) return h('div', { class: 'ds-ep-json-leaf' }, ...keyParts, isArr ? '[]' : '{}');
        const tag = isArr ? '[' + entries.length + ']' : '{' + entries.length + '}';
        return h('details', { class: 'ds-ep-json-node', open: depth < treeDepth ? true : null },
            h('summary', { class: 'ds-ep-json-sum' }, ...keyParts, h('span', { class: 'ds-ep-json-tag' }, tag)),
            h('div', { class: 'ds-ep-json-kids' }, ...entries.map(([k, v]) => jsonTreeNode(k, v, depth + 1, treeDepth))));
    }
    const t = typeof val === 'string' ? 's' : typeof val === 'number' ? 'n' : typeof val === 'boolean' ? 'b' : 'z';
    return h('div', { class: 'ds-ep-json-leaf' }, ...keyParts, h('span', { class: 'ds-ep-json-' + t }, JSON.stringify(val) ?? String(val)));
}

function jsonCopyButton(text) {
    return h('button', {
        type: 'button', class: 'ds-ep-json-copy', title: 'copy JSON', 'aria-label': 'copy JSON',
        onclick: (e) => {
            const btn = e.currentTarget;
            const show = (label, ok) => {
                btn.textContent = label;
                btn.classList.toggle('copied', ok);
                setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 1200);
            };
            const fallback = () => {
                try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); show('copied', true); }
                catch { show('failed', false); }
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => show('copied', true), fallback);
            else fallback();
        },
    }, 'copy');
}

export function JsonViewer({ value, emptyText = 'no data', maxHeight, mode = 'plain', copyable = false, treeDepth = 2 } = {}) {
    let text, parsed;
    let knownJson = false;
    if (value == null) text = null;
    else if (typeof value === 'string') text = value;
    else { try { text = JSON.stringify(value, null, 2); knownJson = text != null; parsed = value; } catch { text = String(value); } }
    if (!text) return h('div', { class: 'ds-ep-json ds-ep-json-empty' }, emptyText);
    const style = maxHeight ? ('max-height:' + maxHeight) : null;
    // Every viewer is a scroll container, so these are UNCONDITIONAL. The
    // `maxHeight` prop only overrides a height the stylesheet already sets:
    // `.ds-ep-json` carries `max-height: 300px; overflow-y: auto` in
    // editor-primitives.css, so a viewer rendered with no prop at all still
    // clips and still scrolls. Gating the attributes on the prop therefore
    // missed the common case — measured live: a prop-less viewer reported
    // scrollHeight 1265 against clientHeight 300 while sitting at tabindex -1.
    //
    // Clipped content reachable by wheel but not by keyboard is WCAG 2.1.1
    // Keyboard, axe's `scrollable-region-focusable`. tabindex puts the box in
    // the tab order and arrow keys then scroll it natively; a bare focusable
    // region with no name is its own violation, so it is labelled. `group`
    // rather than `region` so a page rendering several viewers does not gain a
    // landmark each.
    const scrollable = { tabindex: '0', role: 'group', 'aria-label': 'JSON, scrollable' };
    if (!knownJson && (mode === 'highlight' || mode === 'tree')) {
        try { parsed = JSON.parse(text); knownJson = true; } catch { /* swallow: not JSON — render plain */ }
    }
    let body;
    if (mode === 'tree' && knownJson && parsed !== null && typeof parsed === 'object') {
        body = h('div', { class: 'ds-ep-json ds-ep-json-tree', style, ...scrollable }, jsonTreeNode(null, parsed, 0, treeDepth));
    } else if ((mode === 'highlight' || mode === 'tree') && knownJson) {
        body = h('pre', { class: 'ds-ep-json ds-ep-json-hl', style, ...scrollable }, ...highlightJsonSpans(text));
    } else {
        body = h('pre', { class: 'ds-ep-json', style, ...scrollable }, text);
    }
    if (!copyable) return body;
    return h('div', { class: 'ds-ep-json-wrap' }, jsonCopyButton(text), body);
}
