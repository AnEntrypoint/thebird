// Editor chrome — the action/navigation bars that frame an editor surface:
// Toolbar (three-slot), ToolbarRow (flat wrapping row), Tabs (WAI-ARIA tabs
// with a sliding underline), IconButtonGroup (segmented toggle row). Pure
// factories, h-based, theme-token driven. All visuals route through CSS
// classes defined in editor-primitives.css; no hex/rgba literals appear here.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { kids } from './shared.js';
const h = webjsx.createElement;

export function Toolbar({ leading = [], trailing = [], dense = false, children } = {}) {
    const cls = 'ds-ep-toolbar' + (dense ? ' dense' : '');
    return h('div', { class: cls, role: 'toolbar' },
        h('div', { class: 'ds-ep-toolbar-leading' }, ...kids(leading)),
        children != null ? h('div', { class: 'ds-ep-toolbar-center' }, ...kids(children)) : null,
        h('div', { class: 'ds-ep-toolbar-trailing' }, ...kids(trailing))
    );
}

// ---------------------------------------------------------------------------
// ToolbarRow — a flat, wrapping row of arbitrary action nodes (buttons,
// inputs, chips) with no leading/center/trailing slot structure. Toolbar's
// three-slot split is the wrong shape when a caller just wants "this row of
// controls, left to right, wrapping on narrow viewports" — the exact shape
// gmsniff's panels.js hand-rolled as a bare '.gm-toolbar' div because Toolbar
// didn't cover it. Accepts children as varargs or a single array.
// ---------------------------------------------------------------------------
export function ToolbarRow(...actions) {
    const flat = actions.length === 1 && Array.isArray(actions[0]) ? actions[0] : actions;
    return h('div', { class: 'ds-ep-toolbar-row', role: 'toolbar' }, ...kids(flat));
}

export function Tabs({ items = [], active, onChange, children, 'aria-label': ariaLabel, onClose, scroll = false } = {}) {
    // Roving tabindex + arrow nav per WAI-ARIA tabs pattern.
    // Only the active tab is in the tab order; arrows move focus + activate.
    const activeIdx = Math.max(0, items.findIndex(it => it.id === active));
    const onTabKeyDown = (e, idx) => {
        let next = null;
        if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        if (next == null) return;
        e.preventDefault();
        const nextId = items[next]?.id;
        if (nextId && onChange) onChange(nextId);
        // Move focus on next paint (so the newly rendered active button gets focus)
        queueMicrotask(() => {
            const head = e.currentTarget?.parentElement;
            const btn = head?.querySelectorAll('[role="tab"]')[next];
            if (btn) btn.focus();
        });
    };
    // Position the sliding underline from the active tab's geometry. The ref is
    // on the OUTER .ds-ep-tabs (position:relative) — the indicator is its child,
    // NOT the flex head's (an abspos child of a horizontal flex row mis-sizes to
    // 0 in Chromium). Runs on every render (ref fires after applyDiff) so a tab
    // change re-measures; the CSS transition animates the move. left/width come
    // from the active tab; top sits the bar on the head's bottom edge.
    const positionSlider = (root) => {
        if (!root) return;
        const head = root.querySelector('.ds-ep-tabs-head');
        const active = root.querySelector('.ds-ep-tab.active');
        const ind = root.querySelector('.ds-ep-tab-indicator');
        if (!head || !active || !ind) return;
        // Size via left+right insets, NOT width: an abspos element's inline
        // `width` computes to 0 in some flex-sibling layouts (Chromium), but
        // left+right insets size reliably. left/right animate via the CSS
        // transition on .ds-ep-tab-indicator.
        const rootW = root.offsetWidth;
        const l = active.offsetLeft, w = active.offsetWidth;
        ind.style.left = l + 'px';
        ind.style.right = Math.max(0, rootW - l - w) + 'px';
        ind.style.top = (head.offsetTop + head.offsetHeight - 2) + 'px';
        head.classList.add('has-slider');
    };
    // scroll=true: tabs size to content (min/max-width) instead of stretching
    // equally (flex:1) — the shape pi-web's TabBar uses for an open-file strip
    // where tab count is unbounded and overflow-x scroll (already on
    // .ds-ep-tabs-head) needs real per-tab widths to have something to scroll.
    // onClose: per-item close affordance — a close button plus middle-click
    // (auxclick button 1) to close, matching pi-web's TabBar. Opt-in: passing
    // onClose without scroll still renders close buttons on the flex:1 tabs.
    const closable = typeof onClose === 'function';
    return h('div', { class: 'ds-ep-tabs', ref: positionSlider },
        h('div', { class: 'ds-ep-tabs-head' + (scroll ? ' scroll' : ''), role: 'tablist', 'aria-label': ariaLabel || 'tabs' },
            ...items.map((it, idx) => h('span', {
                key: it.id,
                class: 'ds-ep-tab-wrap' + (it.id === active ? ' active' : ''),
                onmousedown: closable ? (e) => { if (e.button === 1) e.preventDefault(); } : null,
                onauxclick: closable ? (e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onClose(it.id);
                } : null
            },
                h('button', {
                    type: 'button',
                    class: 'ds-ep-tab' + (it.id === active ? ' active' : ''),
                    role: 'tab',
                    id: 'tab-' + it.id,
                    title: typeof it.label === 'string' ? it.label : undefined,
                    'aria-selected': it.id === active ? 'true' : 'false',
                    'aria-controls': 'tabpanel-' + it.id,
                    'aria-label': typeof it.label === 'string' ? it.label : ('tab ' + (idx + 1)),
                    tabindex: idx === activeIdx ? '0' : '-1',
                    onclick: () => onChange && onChange(it.id),
                    onkeydown: (e) => onTabKeyDown(e, idx)
                }, it.label),
                closable ? h('button', {
                    type: 'button',
                    class: 'ds-ep-tab-close',
                    title: 'Close',
                    'aria-label': 'Close ' + (typeof it.label === 'string' ? it.label : 'tab'),
                    onclick: (e) => { e.stopPropagation(); onClose(it.id); }
                }, Icon('x', { size: 14 })) : null
            ))
        ),
        // The sliding underline — child of the outer column (see positionSlider).
        // Keyed + decorative. Renders at 0-width until positioned (no-JS: hidden).
        h('span', { key: '__ind', class: 'ds-ep-tab-indicator', 'aria-hidden': 'true' }),
        h('div', {
            class: 'ds-ep-tabs-body',
            role: 'tabpanel',
            id: active ? 'tabpanel-' + active : undefined,
            'aria-labelledby': active ? 'tab-' + active : undefined,
            tabindex: '0'
        }, ...kids(children))
    );
}

export function IconButtonGroup({ items = [], value, onChange, dense = false } = {}) {
    return h('div', { class: 'ds-ep-btngrp' + (dense ? ' dense' : ''), role: 'group' },
        ...items.map((it) => h('button', {
            key: it.id,
            type: 'button',
            class: 'ds-ep-btngrp-btn' + (it.id === value ? ' active' : ''),
            title: it.title || it.label || it.id,
            'aria-pressed': it.id === value ? 'true' : 'false',
            disabled: it.disabled ? 'disabled' : null,
            onclick: () => { if (!it.disabled && onChange) onChange(it.id); }
        }, it.glyph != null ? it.glyph : it.label))
    );
}
