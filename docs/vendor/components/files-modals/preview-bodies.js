// The three preview body renderers a host drops into FileViewer /
// FilePreviewPane: media (image with fit/actual toggle, video, audio, or a
// typed fallback), code (gutter + Prism highlight, optional wrap toggle and
// source/preview mode switch), and plain text.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { fileGlyph } from '../files.js';
import { highlightAllUnder } from '../../highlight.js';
const h = webjsx.createElement;

export function FilePreviewMedia({ src, type = 'other', name } = {}) {
    if (type === 'image') {
        // Fit-to-pane (default) vs actual-size (1:1) toggle + a checkerboard so
        // transparency reads. The toggle flips a class on the img in-place and
        // reports the natural pixel dimensions into its own caption on load.
        const onToggle = (e) => {
            const wrap = e.currentTarget.closest('.ds-preview-media-wrap');
            const img = wrap && wrap.querySelector('.ds-preview-media');
            if (!img) return;
            const actual = img.classList.toggle('is-actual');
            e.currentTarget.textContent = actual ? 'fit to pane' : 'actual size';
        };
        const onLoad = (e) => {
            const img = e.currentTarget;
            const cap = img.closest('.ds-preview-media-wrap');
            const dim = cap && cap.querySelector('.ds-preview-media-dim');
            if (dim && img.naturalWidth) dim.textContent = img.naturalWidth + ' x ' + img.naturalHeight + ' px';
        };
        return h('div', { class: 'ds-preview-media-wrap' },
            h('img', { class: 'ds-preview-media ds-preview-media-alpha', src, alt: name || '', onload: onLoad }),
            h('div', { class: 'ds-preview-media-controls' },
                h('span', { class: 'ds-preview-media-dim', 'aria-live': 'polite' }, ''),
                h('button', { type: 'button', class: 'chat-code-copy', onclick: onToggle }, 'actual size')));
    }
    if (type === 'video') return h('video', { class: 'ds-preview-media', src, controls: true });
    if (type === 'audio') return h('audio', { class: 'ds-preview-audio', src, controls: true });
    return h('div', { class: 'ds-preview-fallback' },
        h('span', { class: 'ds-preview-glyph', 'aria-hidden': 'true' }, Icon(fileGlyph(type))),
        h('span', {}, 'no inline preview for ' + (type || 'this file'))
    );
}

// FilePreviewCode — the code/source pane. Two additive, opt-in affordances
// ported from pi-web's FileViewer (behavior only, not its React/SSE plumbing):
//   wrap        : host-controlled wrap-lines toggle. Pass `wrap` (current
//                 state) + `onWrapToggle` to show the control; omitted host
//                 keeps the old always-'pre' behavior (no regression).
//   previewHtml : when the host has already rendered markdown/HTML to a safe
//                 HTML string (e.g. via markdown-cache.js's
//                 renderMarkdownCached, or a sanitized srcDoc for raw HTML
//                 files) it passes it here + `previewLabel` (defaults
//                 'preview') to get a source/preview mode switcher, mirroring
//                 pi-web's DisplayMode tabs. This component never renders
//                 unsanitized markdown itself — that stays the host's job
//                 (chat.js already owns the sanitize+render pipeline).
export function FilePreviewCode({ content = '', lang, filename, wrap, onWrapToggle, previewHtml, previewLabel = 'preview', mode, onModeChange } = {}) {
    // A filename/lang header matching the chat CodeNode's .chat-code-head, plus
    // the same copy control (chat A1/A2 ship this run, so preview matches for
    // full cross-surface consistency).
    const onCopy = (e) => {
        const btn = e.currentTarget;
        const done = () => { btn.textContent = 'copied'; btn.classList.add('is-copied'); setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('is-copied'); }, 1600); };
        const fallback = () => { try { const t = document.createElement('textarea'); t.value = content; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); done(); } catch { /* swallow: no copy mechanism available */ } };
        // Falls back whenever the async Clipboard API is absent OR its
        // promise rejects (permission denied, an unfocused document) --
        // was previously only reached when navigator.clipboard didn't exist.
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(content).then(done, fallback);
        else fallback();
    };
    const hasPreview = previewHtml != null && onModeChange;
    const activeMode = hasPreview ? (mode || 'source') : 'source';
    const modeSwitch = hasPreview ? h('div', { class: 'ds-preview-mode-switch', role: 'group', 'aria-label': 'file view mode' },
        h('button', { type: 'button', class: 'ds-preview-mode-btn' + (activeMode === 'source' ? ' active' : ''),
            'aria-pressed': activeMode === 'source' ? 'true' : 'false', onclick: () => onModeChange('source') }, 'source'),
        h('button', { type: 'button', class: 'ds-preview-mode-btn' + (activeMode === 'preview' ? ' active' : ''),
            'aria-pressed': activeMode === 'preview' ? 'true' : 'false', onclick: () => onModeChange('preview') }, previewLabel)
    ) : null;
    const wrapCtl = (onWrapToggle && activeMode === 'source') ? h('button', {
        type: 'button', class: 'chat-code-copy ds-preview-wrap-toggle' + (wrap ? ' active' : ''),
        title: wrap ? 'disable word wrap' : 'enable word wrap',
        'aria-label': wrap ? 'disable word wrap' : 'enable word wrap',
        'aria-pressed': wrap ? 'true' : 'false',
        onclick: () => onWrapToggle(!wrap),
    }, 'wrap') : null;
    return h('div', { class: 'ds-preview-code-wrap' },
        h('div', { class: 'chat-code-head ds-preview-code-head' },
            h('span', { class: 'lang' }, lang || 'text'),
            filename ? h('span', { class: 'name' }, filename) : null,
            h('span', { class: 'spread' }),
            modeSwitch,
            wrapCtl,
            h('button', { type: 'button', class: 'chat-code-copy chat-code-copy-head', 'aria-label': 'copy code', onclick: onCopy }, 'copy')),
        activeMode === 'preview'
            // webjsx has no innerHTML prop — set it imperatively via ref, same
            // pattern as chat-message-parts.js/community.js. `previewHtml` is
            // the HOST's already-sanitized HTML (e.g. via markdown-cache.js's
            // renderMarkdownCached, which owns its own sanitize step); this
            // component never sanitizes or fetches on its own.
            ? h('div', { class: 'ds-preview-html', ref: (el) => { if (el) el.innerHTML = previewHtml; } })
            : codeBody({ content, lang, wrap })
    );
}

// The code body: a non-selectable line-number gutter + the highlighted code.
// A ref triggers Prism over the <code> after mount (the bundle only auto-runs
// Prism in the chat path), so the file preview is token-colored like Claude
// Code's file pane. lineNumbers defaults on for code, off for plaintext.
function codeBody({ content = '', lang, wrap = false } = {}) {
    const wantGutter = !!lang;
    const lineCount = content ? content.split('\n').length : 1;
    const gutter = wantGutter
        ? h('div', { class: 'ds-preview-gutter', 'aria-hidden': 'true' },
            Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n'))
        : null;
    const highlightRef = (el) => {
        if (!el) return;
        try { highlightAllUnder(el); } catch { /* swallow: syntax highlighting is a progressive enhancement, plain code still renders */ }
    };
    // wrap: ported from pi-web's wrapLines toggle — pre-wrap + anywhere-break
    // instead of the default horizontal-scroll 'pre', for long unbroken lines
    // (minified JS, long log lines) that are easier to read wrapped.
    return h('pre', { class: 'ds-preview-code' + (lang ? ' lang-' + lang : '') + (wantGutter ? ' has-gutter' : '') + (wrap ? ' is-wrapped' : ''), ref: highlightRef },
        gutter,
        h('code', { class: lang ? 'language-' + lang : '' }, content));
}

export function FilePreviewText({ content = '', truncated } = {}) {
    return h('pre', { class: 'ds-preview-text' },
        h('code', {}, content),
        truncated ? h('div', { class: 'ds-preview-truncated' }, '… (truncated)') : null
    );
}
