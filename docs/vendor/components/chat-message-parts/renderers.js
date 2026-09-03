// The one PART_RENDERERS dispatch table every chat surface's message parts
// render through, plus the attachment part kinds (image / pdf / file / link)
// that live nowhere else, and the two entry points callers actually use.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { fmtFileSize } from '../files.js';
import { safeUrl, renderInline, fileIconName } from './inline.js';
import { MdNode, CodeNode } from './prose-nodes.js';
import { ToolCallNode, ThinkingNode, ApprovalNode } from './agent-nodes.js';

const h = webjsx.createElement;

// ONE byte format across the kit (mirrors chat.js's own fmtBytes alias).
const fmtBytes = fmtFileSize;

// The one dispatch table every chat surface's message parts render through.
export const PART_RENDERERS = {
    text:  (p) => p.preShell
        // Streaming prose that already contains a code fence (or a huge tail
        // window) renders as a plain monospaced <pre> so it does not reflow from
        // prose to a styled block on settle (no Prism mid-stream). The settled
        // turn renders real markdown. `streamHead` is an optional head line for
        // the tail-window path ('streaming · N KB so far').
        ? h('div', { class: 'chat-bubble chat-md chat-stream-pre' },
            ...[p.streamHead ? h('div', { key: 'sh', class: 'chat-stream-head', role: 'status', 'aria-live': 'polite' }, p.streamHead) : null,
               h('pre', { key: 'pre' }, h('code', {}, p.text || '')),
               p.streamingCaret ? h('span', { key: '_caret', class: 'chat-stream-caret', 'aria-hidden': 'true' }) : null].filter(Boolean))
        : h('div', { class: 'chat-bubble' + (p.mdShell ? ' chat-md' : '') },
            ...renderInline(p.text || ''),
            p.streamingCaret ? h('span', { key: '_caret', class: 'chat-stream-caret', 'aria-hidden': 'true' }) : null),
    md:    (p) => MdNode(p),
    code:  (p) => CodeNode(p),
    tool:        (p) => ToolCallNode(p),
    tool_call:   (p) => ToolCallNode(p),
    tool_result: (p) => ToolCallNode({ ...p, name: p.name || 'tool_result', result: p.text != null ? p.text : p.result }),
    thinking:    (p) => ThinkingNode(p),
    approval:    (p) => ApprovalNode(p),
    image: (p) => {
        // Guard both the wrapping link and the img src against unsafe schemes
        // (e.g. a data:text/html src) so an embedded-image part from untrusted
        // markdown can't smuggle an active payload.
        const imgSrc = safeUrl(p.src);
        const linkHref = safeUrl(p.href || p.src);
        if (!imgSrc) return h('span', { class: 'chat-image-blocked' }, p.alt || 'image blocked (unsafe url)');
        return h('a', { class: 'chat-image', href: linkHref || imgSrc, target: '_blank', rel: 'noopener noreferrer', 'aria-label': p.alt || `embedded image: ${imgSrc}` },
            h('img', { src: imgSrc, alt: p.alt || `embedded image from ${imgSrc}`, loading: 'lazy' }),
            p.caption ? h('span', { class: 'cap' }, p.caption) : null);
    },
    pdf:   (p) => h('div', { class: 'chat-pdf' },
        h('div', { class: 'chat-pdf-head' },
            h('span', { class: 'glyph', 'aria-hidden': 'true' }, Icon('file-pdf', { size: 18 })),
            h('span', { class: 'name' }, p.name || 'document.pdf'),
            p.size != null ? h('span', { class: 'size' }, fmtBytes(p.size)) : null,
            h('a', { class: 'open', href: p.src, target: '_blank', rel: 'noopener', 'aria-label': `open PDF: ${p.name || 'document.pdf'}` }, 'open ->')
        ),
        h('embed', { src: p.src, type: 'application/pdf', 'aria-label': `PDF document: ${p.name || 'document.pdf'}` })),
    file:  (p) => h('a', { class: 'chat-file', href: p.src, target: '_blank', rel: 'noopener', download: p.name || true, 'aria-label': `download file: ${p.name || 'attachment'} (${p.kindLabel || (p.name || '').split('.').pop().toUpperCase()})` },
        h('span', { class: 'glyph', 'aria-hidden': 'true' }, Icon(fileIconName(p.name), { size: 22 })),
        h('span', { class: 'meta' },
            h('span', { class: 'name' }, p.name || 'attachment'),
            h('span', { class: 'size' }, [p.kindLabel || (p.name || '').split('.').pop().toUpperCase(), p.size != null ? fmtBytes(p.size) : null].filter(Boolean).join(' · '))
        ),
        h('span', { class: 'go', 'aria-hidden': 'true' }, Icon('arrow-down'))),
    link:  (p) => h('a', { class: 'chat-link', href: safeUrl(p.href) || '#', target: '_blank', rel: 'noopener noreferrer', 'aria-label': `link: ${p.title || p.href}` },
        p.thumb ? h('img', { class: 'thumb', src: p.thumb, alt: `preview for ${p.title || p.href}` }) : null,
        h('span', { class: 'meta' },
            h('span', { class: 'host' }, p.host || (() => { try { return new URL(p.href).host; } catch { return ''; } })()),
            h('span', { class: 'title' }, p.title || p.href),
            p.desc ? h('span', { class: 'desc' }, p.desc) : null
        ))
};

// Render one message part {kind, ...} to a vnode, keyed for webjsx diffing.
// `onKindRendered` is an optional (kind) => void hook so a caller can track
// per-kind render stats (chat.js uses this to keep its existing debug counter
// wired without this module owning that state itself).
export function renderMessagePart(p, key, onKindRendered) {
    const fn = PART_RENDERERS[p.kind] || PART_RENDERERS.text;
    const node = fn(p);
    if (node && typeof node === 'object') node.props = { ...(node.props || {}), key: 'p' + key };
    if (onKindRendered) onKindRendered(p.kind);
    return node;
}

// Render a full `parts` array in order — the common case every chat surface
// actually calls (ChatMessage.bodyNodes today, any future host tomorrow).
export function renderMessageParts(parts, onKindRendered) {
    return (parts || []).map((p, i) => renderMessagePart(p, i, onKindRendered));
}
