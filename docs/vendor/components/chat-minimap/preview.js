// Message-shape helpers the minimap measures and labels against: preview-text
// extraction across the three message shapes this kit carries, the has-text
// and mapped-role filters that decide which turns get a dot, and the message
// element resolver.

export const PREVIEW_CHARS = 200;

// Extract a short preview string the same way upstream's getMessagePreview
// does: prefer flat `text`, then `content` (string or array-of-parts), then
// `parts` (this kit's structured shape) joined and trimmed.
export function messagePreview(m) {
    if (!m) return '';
    if (typeof m.text === 'string' && m.text) return m.text.slice(0, PREVIEW_CHARS);
    if (typeof m.content === 'string' && m.content) return m.content.slice(0, PREVIEW_CHARS);
    const partsSrc = Array.isArray(m.content) ? m.content : (Array.isArray(m.parts) ? m.parts : null);
    if (partsSrc) {
        const joined = partsSrc
            .map((p) => (typeof p === 'string' ? p : (p && (p.text || (p.type === 'text' && p.text)) || '')))
            .filter(Boolean)
            .join(' ');
        if (joined) return joined.slice(0, PREVIEW_CHARS);
    }
    return '';
}

// True when a message carries any renderable text (dots skip empty/tool-only
// turns the way upstream's hasTextContent does).
export function hasTextContent(m) {
    return !!messagePreview(m);
}

export function isMappedRole(role) {
    return role === 'user' || role === 'assistant';
}

// Resolve the DOM node for message index `i`, via the host's getter or the
// data-msg-index fallback.
export function resolveMessageEl(threadEl, getMessageEl, i) {
    if (typeof getMessageEl === 'function') return getMessageEl(i) || null;
    return threadEl.querySelector('[data-msg-index="' + i + '"]') || null;
}
