// Progressive disclosure — Collapse (a single controlled toggle panel) and
// CollapseGroup (the accordion wrapper enforcing single-open-at-a-time).
// Both are controlled: the caller owns `expanded`/`openId` state, same
// pattern as Drawer/Dialog's `open`/`onClose` — no internal state.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// ---------------------------------------------------------------------------
// Collapse — progressive-disclosure toggle panel (screen-real-estate
// density: property inspectors, nested settings, FAQ-style panels).
// Controlled component: caller owns `expanded` state and passes `onToggle`,
// same pattern as Drawer/Dialog `open`/`onClose` above — no internal state.
// ---------------------------------------------------------------------------
export function Collapse({ title, expanded = false, onToggle, children, key } = {}) {
    return h('div', { key, class: 'ds-ep-collapse' + (expanded ? ' is-expanded' : '') },
        h('button', {
            type: 'button', class: 'ds-ep-collapse-head',
            'aria-expanded': expanded ? 'true' : 'false',
            onclick: () => { if (onToggle) onToggle(!expanded); },
        },
            h('span', { class: 'ds-ep-collapse-chevron' }, expanded ? 'v' : '>'),
            h('span', { class: 'ds-ep-collapse-title' }, title)),
        expanded ? h('div', { class: 'ds-ep-collapse-body' }, children) : null);
}

// ---------------------------------------------------------------------------
// CollapseGroup — accordion wrapper enforcing single-open-at-a-time when
// `accordion=true` (default false — group just lays out children, each
// Collapse still individually controlled). `openId`/`onOpenChange` drive the
// accordion; `items` is [{id, title, children}].
// ---------------------------------------------------------------------------
export function CollapseGroup({ items = [], openId, onOpenChange, accordion = false, key } = {}) {
    return h('div', { key, class: 'ds-ep-collapse-group' },
        ...items.map((it) => Collapse({
            key: it.id,
            title: it.title,
            expanded: accordion ? it.id === openId : Boolean(it.expanded),
            onToggle: (next) => {
                if (!onOpenChange) return;
                if (accordion) onOpenChange(next ? it.id : null);
                else onOpenChange(it.id, next);
            },
            children: it.children,
        })));
}
