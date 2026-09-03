// Popover — controlled, portaled to <body>. Unlike the other overlays in
// this group it renders no VElement of its own: it imperatively creates,
// positions and tears down a body-level element keyed off the anchor, and
// always returns null.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { useFloating, FLOAT_OFFSET_POPOVER, FOCUSABLE_SEL, kids } from './floating.js';
const h = webjsx.createElement;

const _popovers = new WeakMap();

export function Popover({ open, anchorEl, onClose, placement = 'bottom-start', children, ariaLabel } = {}) {
    if (typeof document === 'undefined') return null;
    const existing = anchorEl ? _popovers.get(anchorEl) : null;
    if (!open) {
        if (existing) { existing.dispose(); _popovers.delete(anchorEl); if (anchorEl && anchorEl.focus) anchorEl.focus(); }
        return null;
    }
    if (existing || !anchorEl) return null;
    const el = document.createElement('div');
    el.className = 'ds-popover';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    el.tabIndex = -1;
    document.body.appendChild(el);
    webjsx.applyDiff(el, h('div', { class: 'ds-popover-inner' }, ...kids(children)));
    const floating = useFloating(anchorEl, el, { placement, offset: FLOAT_OFFSET_POPOVER });
    const close = () => onClose && onClose();
    const onDown = (e) => { if (el.contains(e.target) || anchorEl.contains(e.target)) return; close(); };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        const nodes = el.querySelectorAll(FOCUSABLE_SEL); if (!nodes.length) { e.preventDefault(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
        if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    // setTimeout(0), not queueMicrotask — see _anchoredOverlayLifecycle's
    // comment: the opening click's own default focus-on-click can otherwise
    // win the race and leave focus outside el, breaking Escape/Tab-trap.
    setTimeout(() => { const f = el.querySelector(FOCUSABLE_SEL); (f || el).focus(); }, 0);
    _popovers.set(anchorEl, { dispose() {
        document.removeEventListener('mousedown', onDown, true);
        floating.dispose();
        if (el.parentNode) el.parentNode.removeChild(el);
    }});
    return null;
}
