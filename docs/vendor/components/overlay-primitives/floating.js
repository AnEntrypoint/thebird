// Overlay positioning core — the shared geometry/lifecycle every overlay in
// this group builds on: useFloating (anchored placement with auto-flip +
// viewport clamp), useLongPress, withBusy, trapTab, plus the internal
// _clampToViewport / _anchoredOverlayLifecycle helpers used by the fixed
// anchored popovers (EmojiPicker, SettingsPopover). No inline styles except
// runtime left/top. CSS classes scoped to .ds-247420 (see
// editor-primitives.css).

export const FOCUSABLE_SEL = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const kids = (c) => c == null ? [] : (Array.isArray(c) ? c : [c]);

// Shared viewport-clamp margins (px). Previously scattered as bare 8/4/6
// literals across useFloating + _clampToViewport. CLAMP_MARGIN is the gap a
// fixed box keeps from the viewport edge; FLOAT_EDGE is the useFloating edge
// gap; FLOAT_OFFSET_* are anchor-to-content offsets per overlay kind.
const CLAMP_MARGIN = 8;
const FLOAT_EDGE = 4;
export const FLOAT_OFFSET_TOOLTIP = 6;
export const FLOAT_OFFSET_POPOVER = 6;
export const FLOAT_OFFSET_DROPDOWN = 4;

// useFloating — compute left/top + auto-flip; re-runs on resize/scroll.
export function useFloating(anchorEl, contentEl, { placement = 'bottom-start', offset = 8 } = {}) {
    if (!anchorEl || !contentEl) return { update() {}, dispose() {}, finalPlacement: placement };
    let finalPlacement = placement;
    const compute = () => {
        const a = anchorEl.getBoundingClientRect(), c = contentEl.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const [side, align = 'start'] = placement.split('-');
        let s = side;
        if (s === 'bottom' && a.bottom + offset + c.height > vh && a.top - offset - c.height >= 0) s = 'top';
        else if (s === 'top' && a.top - offset - c.height < 0 && a.bottom + offset + c.height <= vh) s = 'bottom';
        else if (s === 'right' && a.right + offset + c.width > vw && a.left - offset - c.width >= 0) s = 'left';
        else if (s === 'left' && a.left - offset - c.width < 0 && a.right + offset + c.width <= vw) s = 'right';
        let x = 0, y = 0;
        if (s === 'bottom' || s === 'top') {
            y = s === 'bottom' ? a.bottom + offset : a.top - offset - c.height;
            x = align === 'start' ? a.left : align === 'end' ? a.right - c.width : a.left + (a.width - c.width) / 2;
        } else {
            x = s === 'right' ? a.right + offset : a.left - offset - c.width;
            y = align === 'start' ? a.top : align === 'end' ? a.bottom - c.height : a.top + (a.height - c.height) / 2;
        }
        x = Math.max(FLOAT_EDGE, Math.min(vw - c.width - FLOAT_EDGE, x));
        y = Math.max(FLOAT_EDGE, Math.min(vh - c.height - FLOAT_EDGE, y));
        contentEl.style.left = x + 'px';
        contentEl.style.top = y + 'px';
        finalPlacement = s + '-' + align;
        contentEl.setAttribute('data-placement', finalPlacement);
    };
    compute();
    const cb = () => compute();
    window.addEventListener('resize', cb);
    window.addEventListener('scroll', cb, true);
    // Reposition when the content box itself resizes (async-loaded content
    // grows the popover after initial positioning, pushing it off-viewport).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(cb) : null;
    if (ro) ro.observe(contentEl);
    return {
        update: compute,
        dispose() { window.removeEventListener('resize', cb); window.removeEventListener('scroll', cb, true); if (ro) ro.disconnect(); },
        get finalPlacement() { return finalPlacement; }
    };
}

// useLongPress — fire callback after ms held without movement.
export function useLongPress(targetEl, callback, { ms = 500 } = {}) {
    if (!targetEl) return () => {};
    let timer = null, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const onDown = (e) => { sx = e.clientX || 0; sy = e.clientY || 0; cancel(); timer = setTimeout(() => { timer = null; callback(e); }, ms); };
    const onMove = (e) => { if (!timer) return; const dx = (e.clientX || 0) - sx, dy = (e.clientY || 0) - sy; if (dx * dx + dy * dy > 64) cancel(); };
    const evts = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', cancel], ['pointerleave', cancel], ['pointercancel', cancel]];
    evts.forEach(([k, fn]) => targetEl.addEventListener(k, fn));
    return () => { cancel(); evts.forEach(([k, fn]) => targetEl.removeEventListener(k, fn)); };
}

// withBusy — run an async action with its triggering button disabled +
// busy-labelled, so a double-click/double-tap can't fire it twice and the
// user sees progress. Restores the button (label, disabled state,
// aria-busy) when the action settles, including on throw. Re-entry while
// already busy is dropped silently rather than queued. Mirrors docstudio's
// dom-busy.js withButtonBusy — agentgui's app.js has no equivalent anywhere,
// so every async-click handler (share/delete/retry/approve-deny) is
// currently unguarded against rapid repeat clicks firing the same mutating
// request twice.
export async function withBusy(btn, fn, busyLabel = '...') {
    if (!btn) return fn();
    if (btn.disabled) return;                 // already in flight -> drop the repeat
    const prevHtml = btn.innerHTML;
    const prevDisabled = btn.disabled;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (busyLabel != null) btn.textContent = busyLabel;
    try {
        return await fn();
    } finally {
        btn.disabled = prevDisabled;
        btn.removeAttribute('aria-busy');
        btn.innerHTML = prevHtml;
    }
}

// Clamp a fixed-position box to the viewport given desired top-left coords.
function _clampToViewport(x, y, w, h, margin = CLAMP_MARGIN) {
    const vw = (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const vh = (typeof window !== 'undefined' ? window.innerHeight : 768);
    return {
        left: Math.max(margin, Math.min(vw - w - margin, x)),
        top: Math.max(margin, Math.min(vh - h - margin, y)),
    };
}

// Tab focus trap for a dialog root — keeps Tab/Shift+Tab cycling inside `el`.
// Call from an onkeydown handler; returns true if it handled the event.
export function trapTab(el, e) {
    if (e.key !== 'Tab') return false;
    const nodes = el.querySelectorAll(FOCUSABLE_SEL);
    if (!nodes.length) { e.preventDefault(); return true; }
    const first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); return true; }
    if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); return true; }
    return false;
}

// Shared lifecycle for fixed anchor-positioned popovers (EmojiPicker,
// SettingsPopover): on mount, place+clamp near (anchorX, anchorY), focus the
// root, and wire an outside-mousedown close. Returns a cleanup fn the ref(null)
// branch must call. Both consumers deduped through this so the
// queueMicrotask/place/clamp/outside-close dance is authored once.
export function _anchoredOverlayLifecycle(el, { anchorX, anchorY, fallbackW, fallbackH, close }) {
    const place = () => {
        const r = el.getBoundingClientRect();
        const { left, top } = _clampToViewport(anchorX, anchorY, r.width || fallbackW, r.height || fallbackH);
        el.style.left = left + 'px'; el.style.top = top + 'px';
    };
    // setTimeout(0), not queueMicrotask: the triggering click's own default
    // focus-on-click (moving focus to the clicked <button>) can run AFTER a
    // same-tick microtask, so a queueMicrotask focus() call here was losing
    // the race and leaving focus on the trigger button instead of the
    // dialog -- breaking Escape-to-close (keydown only bubbles from the
    // focused element) for any keyboard user. A macrotask reliably runs
    // after the click's focus settles.
    setTimeout(() => { place(); el.focus(); }, 0);
    const onDown = (e) => { if (!el.contains(e.target)) close(); };
    queueMicrotask(() => document.addEventListener('mousedown', onDown, true));
    return () => document.removeEventListener('mousedown', onDown, true);
}
