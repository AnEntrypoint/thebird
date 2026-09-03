// Resizable split — ResizeHandle (the draggable/keyboard-nudgeable separator)
// and SplitPanel (two children separated by one). Stateful via DOM: the
// dragged size is persisted across applyDiff re-renders by the pane's ref.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { kids } from './shared.js';
const h = webjsx.createElement;

// ---------------------------------------------------------------------------
// ResizeHandle — splitter, axis = 'horizontal' (vertical bar, horiz drag)
// or 'vertical' (horizontal bar, vertical drag). onResize(delta:px).
// ---------------------------------------------------------------------------
export function ResizeHandle({ axis = 'horizontal', onResize, ariaLabel } = {}) {
    const isH = axis === 'horizontal';
    let dragOrigin = null;
    const step = 8;
    const emit = (dx, dy) => { if (onResize) onResize(isH ? dx : dy); };
    const onPointerDown = (e) => {
        e.preventDefault();
        dragOrigin = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e) => {
        if (!dragOrigin) return;
        const dx = e.clientX - dragOrigin.x;
        const dy = e.clientY - dragOrigin.y;
        dragOrigin = { x: e.clientX, y: e.clientY };
        emit(dx, dy);
    };
    const onPointerUp = (e) => {
        dragOrigin = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* swallow: pointer capture may already be released, drag end still proceeds */ }
    };
    const onKeyDown = (e) => {
        const k = e.key;
        if (isH) {
            if (k === 'ArrowLeft') { e.preventDefault(); emit(-step, 0); }
            else if (k === 'ArrowRight') { e.preventDefault(); emit(step, 0); }
            else if (k === 'Home') { e.preventDefault(); emit(-1e6, 0); }
            else if (k === 'End') { e.preventDefault(); emit(1e6, 0); }
        } else {
            if (k === 'ArrowUp') { e.preventDefault(); emit(0, -step); }
            else if (k === 'ArrowDown') { e.preventDefault(); emit(0, step); }
            else if (k === 'Home') { e.preventDefault(); emit(0, -1e6); }
            else if (k === 'End') { e.preventDefault(); emit(0, 1e6); }
        }
    };
    return h('div', {
        class: 'ds-ep-resize ' + (isH ? 'axis-h' : 'axis-v'),
        role: 'separator',
        tabindex: '0',
        'aria-orientation': isH ? 'vertical' : 'horizontal',
        'aria-label': ariaLabel || 'Resize',
        onpointerdown: onPointerDown,
        onpointermove: onPointerMove,
        onpointerup: onPointerUp,
        onpointercancel: onPointerUp,
        onkeydown: onKeyDown,
    });
}

// ---------------------------------------------------------------------------
// SplitPanel — two children separated by a ResizeHandle. Stateful via DOM.
// ---------------------------------------------------------------------------
export function SplitPanel({ orientation = 'horizontal', initial = '50%', min = 80, max = Infinity, children } = {}) {
    const isH = orientation === 'horizontal';
    const ks = kids(children);
    const first = ks[0] || null;
    const second = ks[1] || null;
    const sizeProp = isH ? 'width' : 'height';
    const initStyle = typeof initial === 'number' ? initial + 'px' : initial;
    let rootEl = null;
    // The dragged size is persisted here so a re-render (applyDiff reconciling
    // the pane's style back to the initial value) does NOT reset the user's
    // resize. onResize records it; the pane's ref re-applies it after each diff.
    let draggedSize = null;
    const applySize = (a) => {
        if (!a) return;
        if (draggedSize != null) { a.style[sizeProp] = draggedSize + 'px'; a.style.flex = '0 0 auto'; }
    };
    const onResize = (delta) => {
        if (!rootEl) return;
        const a = rootEl.firstChild;
        if (!a) return;
        const rect = a.getBoundingClientRect();
        const curr = isH ? rect.width : rect.height;
        const total = isH ? rootEl.getBoundingClientRect().width : rootEl.getBoundingClientRect().height;
        const next = Math.max(min, Math.min(max === Infinity ? total - min : max, curr + delta));
        draggedSize = next;
        a.style[sizeProp] = next + 'px';
        a.style.flex = '0 0 auto';
    };
    return h('div', {
        class: 'ds-ep-split ' + (isH ? 'horiz' : 'vert'),
        ref: (el) => { rootEl = el; }
    },
        h('div', { class: 'ds-ep-split-pane', style: '--split-size:' + initStyle + ';flex:0 0 auto', ref: applySize }, first),
        ResizeHandle({ axis: isH ? 'horizontal' : 'vertical', onResize }),
        h('div', { class: 'ds-ep-split-pane grow', style: 'flex:1 1 0;min-' + sizeProp + ':0' }, second)
    );
}
