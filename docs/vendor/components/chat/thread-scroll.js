// Thread auto-scroll: keep a scroll container pinned to the bottom as new
// messages arrive, but never while the user is mid-selection. Shared by Chat,
// AICat, and AgentChat.

// True when the user has a non-collapsed text selection anchored inside `el`.
// Used to pause auto-scroll (and by hosts to pause streaming re-renders) so
// select-and-copy from a still-streaming message is not wiped every frame.
export function hasSelectionInside(el) {
    const sel = typeof document !== 'undefined' && document.getSelection ? document.getSelection() : null;
    return !!(sel && !sel.isCollapsed && sel.anchorNode && el && el.contains(sel.anchorNode));
}

// Build a ref callback that keeps a scroll container pinned to the bottom when
// new messages arrive AND the user is already at the bottom (sentinel visible).
// `getCount` returns the current message count so the observer compares against
// live state. Shared by Chat, AICat, and AgentChat.
// CONTRACT: auto-scroll pauses while the user holds a non-collapsed selection
// inside the thread (hasSelectionInside) — the same guard hosts apply to their
// streaming re-render pass — and resumes once the selection collapses.
export function makeThreadAutoScroll(getCount) {
    return (el) => {
        if (!el) return;
        let sentinel = el.querySelector('[data-scroll-sentinel]');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.setAttribute('data-scroll-sentinel', '');
            sentinel.style.height = '1px';
            el.appendChild(sentinel);
        }
        const obs = new IntersectionObserver((entries) => {
            if (hasSelectionInside(el)) return; // don't fight an active selection
            const count = String(getCount());
            if (entries[0]?.isIntersecting && el.dataset.msgCount !== count) {
                el.scrollTop = el.scrollHeight - el.clientHeight;
                el.dataset.msgCount = count;
            }
        }, { root: el, threshold: 0 });
        obs.observe(sentinel);
        el.dataset.msgCount = String(getCount());
        return () => obs.disconnect();
    };
}
