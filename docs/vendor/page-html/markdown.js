// Server-side markdown for the static-site renderer: HTML escaping, the
// inline subset, GitHub-flavored heading slugs, and the block renderer with
// its opt-in ```html raw-passthrough fence.

// Single source of HTML escaping lives in markdown.js (full entity set). Kept
// the `escape` export name for backward compatibility with any consumer.
import { escapeHtml } from '../markdown.js';
export const escape = escapeHtml;

export function inlineMd(s) {
    return s
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// GitHub-flavored heading slug: lowercase, strip non-word/non-space/non-hyphen,
// collapse whitespace to hyphens. Matches the fallback anchor target a hero/nav
// CTA's `#slug` href expects to resolve against a `## slug text` body heading.
export function slugify(s) {
    return String(s || '').trim().toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
}

// Raw-HTML passthrough block, opt-in via ```html fences. Distinct from a
// plain ``` code fence (which still escapes+<pre>-wraps its contents) — this
// is for SSR call sites that are trusted, repo-authored content (a theme.mjs
// page body sourced from the project's own YAML, never end-user input) and
// need to emit real markup (e.g. an <iframe> demo embed) that must NOT be
// escaped. There is no sanitization here by design: the caller owns trust.
// A consumer rendering untrusted content must not route it through this
// path — use markdown.js's DOMPurify-backed renderMarkdown for that instead.
export function renderMarkdown(md) {
    const lines = String(md || '').split('\n');
    const out = [];
    let inCode = false, inList = false, inRawHtml = false;
    for (const line of lines) {
        if (line.trim() === '```html') { if (!inCode) { inRawHtml = true; continue; } }
        if (line.startsWith('```')) {
            if (inRawHtml) { inRawHtml = false; continue; }
            if (inCode) { out.push('</pre>'); inCode = false; } else { out.push('<pre>'); inCode = true; }
            continue;
        }
        if (inRawHtml) { out.push(line); continue; }
        if (inCode) { out.push(escape(line)); continue; }
        if (line.startsWith('# ')) { const t = line.slice(2); out.push(`<h1 id="${slugify(t)}">${escape(t)}</h1>`); }
        else if (line.startsWith('## ')) { const t = line.slice(3); out.push(`<h2 id="${slugify(t)}">${escape(t)}</h2>`); }
        else if (line.startsWith('### ')) { const t = line.slice(4); out.push(`<h3 id="${slugify(t)}">${escape(t)}</h3>`); }
        else if (line.startsWith('- ')) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inlineMd(escape(line.slice(2)))}</li>`); }
        else { if (inList) { out.push('</ul>'); inList = false; } if (line.trim()) out.push(`<p>${inlineMd(escape(line))}</p>`); }
    }
    if (inList) out.push('</ul>');
    if (inCode) out.push('</pre>');
    return out.join('\n');
}

// Join a basePath prefix to a nav href. Absolute URLs and hash links pass
// through unchanged; leading-slash paths get the prefix.
export function joinHref(basePath, href) {
    if (!href) return '#';
    const h = String(href);
    if (/^([a-z]+:|#|\/\/)/i.test(h)) return h;
    if (!basePath) return h;
    const base = basePath.replace(/\/+$/, '');
    if (h.startsWith('/')) return base + h;
    return base + '/' + h.replace(/^\.?\//, '');
}
