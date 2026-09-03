// Menubar — a horizontal row of Dropdown-style menus (built on the same
// useRovingMenu state machine that ./menus.js's Dropdown uses) sharing
// cross-menu-hover-switch state. Dropdown itself keeps its open/close state
// private (no onOpenChange prop), so a true hover-driven switch — closing
// whichever menu is open and opening the one now under the pointer, without
// a second click — needs the shared state machine directly rather than a
// black-box Dropdown instance per item; each trigger still renders the exact
// role=menu / .ds-dropdown-item DOM Dropdown itself builds, so it is visually
// and semantically identical to a row of Dropdowns.
//
// Controlled component: the caller owns `openIndex`/`onOpenIndexChange`
// (which menu, if any, is open), matching the rest of this overlay group.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { useRovingMenu } from './roving-menu.js';
const h = webjsx.createElement;

function buildMenuEl(items, onSelect, close, ariaLabel) {
    const el = document.createElement('div');
    el.className = 'ds-popover ds-dropdown-menu';
    el.setAttribute('role', 'menu');
    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    const select = (it) => { if (it.disabled || it.separator) return; if (onSelect) onSelect(it.id, it); close(); };
    const tree = h('div', { class: 'ds-dropdown-list' },
        ...items.map((it, i) => it.separator
            ? h('div', { key: 'sep' + i, class: 'ds-dropdown-separator', role: 'separator' })
            : h('button', {
                key: it.id || i, type: 'button', role: 'menuitem',
                class: 'ds-dropdown-item' + (it.danger ? ' is-danger' : ''),
                'aria-disabled': it.disabled ? 'true' : 'false',
                tabindex: '-1', onclick: () => select(it),
            }, h('span', { class: 'ds-dropdown-label' }, it.label))));
    webjsx.applyDiff(el, tree);
    return el;
}

// Menubar({ menus, openIndex, onOpenIndexChange })
//   menus: [{ id?, label, items, onSelect }].
//   openIndex: caller-owned index of the currently open menu, or null.
//   onOpenIndexChange(next): called with the new open index (or null on close).
export function Menubar({ menus = [], openIndex = null, onOpenIndexChange, ariaLabel = 'Menu bar' } = {}) {
    return h('div', { class: 'ds-menubar', role: 'menubar', 'aria-label': ariaLabel },
        ...menus.map((menu, i) => {
            const isOpen = openIndex === i;
            const roving = useRovingMenu({
                itemSelector: '[role="menuitem"]:not([aria-disabled="true"])',
                items: menu.items || [], typeahead: true, placement: 'bottom-start',
                onOpenChange: (open) => onOpenIndexChange && onOpenIndexChange(open ? i : null),
            });
            const open = () => roving.openMenu(() => buildMenuEl(menu.items || [], menu.onSelect, roving.close, menu.label), true);
            const onTrigClick = () => { if (roving.isOpen()) roving.close(); else open(); };
            const onTrigKey = (e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!roving.isOpen()) open(); else roving.focusItem(0); } };
            // Cross-menu hover switch: only steal focus when a DIFFERENT menu
            // is already open — plain hover with nothing open still requires
            // a click, matching standard menubar behavior.
            const onEnter = () => { if (openIndex != null && openIndex !== i && !roving.isOpen()) open(); };
            const refFn = roving.refFn('_dsMenubarTrig');
            const wireRef = (el) => { refFn(el); if (el) { el.addEventListener('click', onTrigClick); el.addEventListener('keydown', onTrigKey); } };
            return h('div', { key: menu.id || i, class: 'ds-menubar-item', onpointerenter: onEnter },
                h('button', {
                    type: 'button', class: 'ds-menubar-trigger' + (isOpen ? ' is-open' : ''),
                    role: 'menuitem', ref: wireRef,
                }, menu.label));
        }));
}
