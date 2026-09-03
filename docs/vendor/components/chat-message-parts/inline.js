// URL safety, the inline-only markdown subset, and the shared
// copy-with-label-flip helpers — the pieces every part renderer builds on and
// the only ones a caller may reasonably use standalone.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// Reject dangerous URL schemes (javascript:, data:, vbscript:, file:) so an
// inline markdown link or an image src built from untrusted text can't smuggle
// a script-executing or data-exfiltrating URL past the inline renderer (which
// does NOT pass through DOMPurify the way the full md path does). http(s),
// mailto, protocol-relative, root/relative, and anchor links are allowed.
export function safeUrl(url) {
    const s = String(url == null ? '' : url).trim();
    if (!s) return null;
    if (/^(\/|\.|#|\?)/.test(s) || s.startsWith('//')) return s;
    const scheme = (s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1];
    if (!scheme) return s; // schemeless relative
    return /^(https?|mailto|tel)$/i.test(scheme) ? s : null;
}

// Inline-only markdown subset; safe for chat bubbles.
export function renderInline(text) {
    if (text == null) return [];
    const out = [];
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
    let last = 0; let m; let i = 0;
    const push = (n) => out.push(n);
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) push(h('span', { key: 's' + i + 'a' }, text.slice(last, m.index)));
        if (m[2] != null) push(h('strong', { key: 's' + i }, m[2]));
        else if (m[3] != null) push(h('em', { key: 's' + i }, m[3]));
        else if (m[4] != null) push(h('code', { key: 's' + i, class: 'chat-tick' }, m[4]));
        else if (m[5] != null) {
            const safe = safeUrl(m[6]);
            // A link with a rejected (unsafe) scheme degrades to its plain label
            // text rather than a clickable, scheme-smuggling anchor.
            if (safe) push(h('a', { key: 's' + i, href: safe, target: '_blank', rel: 'noopener noreferrer' }, m[5]));
            else push(h('span', { key: 's' + i }, m[5]));
        }
        last = m.index + m[0].length; i += 1;
    }
    if (last < text.length) push(h('span', { key: 's' + i + 'a' }, text.slice(last)));
    return out;
}

// Map file extension -> line-icon name (drawn SVG, not a decorative glyph).
const FILE_ICONS = { pdf: 'file-pdf', zip: 'file-zip', tar: 'file-zip', gz: 'file-zip', mp4: 'file-video', mov: 'file-video', mp3: 'file-audio', wav: 'file-audio', csv: 'file-sheet', json: 'file-code', js: 'file-code', ts: 'file-code', md: 'file-text', txt: 'file-text' };
export function fileIconName(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return FILE_ICONS[ext] || 'file';
}

// Shared clipboard-copy-with-label-flip: was three verbatim-identical blocks
// (chat.js's injectCodeCopy, CodeNode.onCopy, ToolCallNode.copyText) before
// this extraction. Same behavior in every caller: try the async Clipboard
// API, fall back to a hidden textarea + execCommand('copy') when unavailable,
// flip the trigger button's own label/class to "copied" for ~1.6s either way.
function execCommandCopy(text) {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
}
export function copyToClipboardWithFeedback(text, btn) {
    const done = () => {
        btn.textContent = 'copied';
        btn.classList.add('is-copied');
        setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('is-copied'); }, 1600);
    };
    // Falls back to execCommand whenever the async Clipboard API is either
    // absent OR its promise rejects (permission denied, an unfocused
    // document -- a real failure mode, not just an old-browser one). The
    // prior version only fell back when navigator.clipboard didn't exist at
    // all, so a live rejection silently did nothing -- no feedback, no copy.
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => { try { execCommandCopy(text); done(); } catch { /* swallow: no copy mechanism available */ } });
    } else {
        try { execCommandCopy(text); done(); } catch { /* swallow: no copy mechanism available */ }
    }
}

// Inject a per-block copy button into every <pre> inside a rendered-markdown
// container. claude.ai/code and Claude Desktop give EVERY fenced block a hover
// copy affordance; the chat surface had only a whole-message copy. Idempotent:
// marks each <pre> with data-copy-wired so re-renders don't stack buttons. The
// button reveals on .chat-code-block:hover/:focus-within (CSS) and flips its
// label copy -> copied for ~1.6s. Drawn with a real icon + word, no glyph.
export function injectCodeCopy(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach((pre) => {
        if (pre.dataset.copyWired === '1') return;
        pre.dataset.copyWired = '1';
        // Wrap the <pre> in a position:relative shell so the button can sit
        // top-right without disturbing code layout.
        const shell = document.createElement('div');
        shell.className = 'chat-code-block';
        pre.parentNode.insertBefore(shell, pre);
        shell.appendChild(pre);
        // Surface the fenced language as a small header tab (claude.ai/code
        // shows the language on every block, not just the structured CodeNode).
        // The highlighter sets language-xx / lang-xx on the inner <code>.
        const codeEl = pre.querySelector('code');
        const langCls = codeEl && (codeEl.className || '').match(/(?:language|lang)-([a-z0-9+#]+)/i);
        if (langCls && langCls[1]) {
            const lang = document.createElement('span');
            lang.className = 'chat-code-lang';
            lang.setAttribute('aria-hidden', 'true');
            lang.textContent = langCls[1];
            shell.appendChild(lang);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-code-copy';
        btn.setAttribute('aria-label', 'copy code');
        btn.textContent = 'copy';
        btn.addEventListener('click', () => copyToClipboardWithFeedback(pre.innerText, btn));
        shell.appendChild(btn);
    });
}
