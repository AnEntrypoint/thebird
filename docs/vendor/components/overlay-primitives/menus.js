// Trigger-anchored menus — Dropdown (role=menuitem action list),
// PermissionMenu (role=menuitemcheckbox category toggles) and MenuButton
// (role=menuitemradio single-select with a check mark). All three share the
// open/close/outside-click/roving-nav/typeahead machine in ./roving-menu.js
// and differ only in the DOM/roles they build for their own menu element.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { useRovingMenu } from './roving-menu.js';
const h = webjsx.createElement;

// Dropdown — button trigger + portaled menu.
export function Dropdown({ trigger, items = [], onSelect, placement = 'bottom-start', ariaLabel } = {}) {
    const menu = useRovingMenu({ itemSelector: '[role="menuitem"]:not([aria-disabled="true"])', items, typeahead: true, placement });
    const select = (it) => { if (it.disabled || it.separator) return; if (onSelect) onSelect(it.id, it); menu.close(); };
    const buildMenuEl = () => {
        const el = document.createElement('div');
        el.className = 'ds-popover ds-dropdown-menu';
        el.setAttribute('role', 'menu');
        if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
        const tree = h('div', { class: 'ds-dropdown-list' },
            ...items.map((it, i) => it.separator
                ? h('div', { key: 'sep' + i, class: 'ds-dropdown-separator', role: 'separator' })
                : h('button', {
                    key: it.id || i, type: 'button', role: 'menuitem',
                    class: 'ds-dropdown-item' + (it.danger ? ' is-danger' : ''),
                    'aria-disabled': it.disabled ? 'true' : 'false',
                    tabindex: '-1', onclick: () => select(it),
                },
                    it.glyph != null ? h('span', { class: 'ds-dropdown-glyph', 'aria-hidden': 'true' }, it.glyph) : null,
                    h('span', { class: 'ds-dropdown-label' }, it.label)
                )));
        webjsx.applyDiff(el, tree);
        return el;
    };
    const onTrigClick = () => menu.onTrigClick(buildMenuEl);
    const onTrigKey = (e) => menu.onTrigKey(e, buildMenuEl);
    const refFn = menu.refFn('_dsDropdown');
    const child = (typeof trigger === 'function') ? trigger() : trigger;
    const wireRef = (el) => { refFn(el); if (el) { el.addEventListener('click', onTrigClick); el.addEventListener('keydown', onTrigKey); } };
    return (child && child.type)
        ? webjsx.createElement(child.type, { ...(child.props || {}), ref: wireRef }, ...(child.children || []))
        : h('button', { type: 'button', class: 'ds-dropdown-trigger', ref: wireRef }, child || 'Menu');
}

// PermissionMenu — a role=menu of role=menuitemcheckbox rows, one per
// category, with roving tabindex + Arrow-up/down/Home/End navigation and
// Escape-closes-and-restores-focus, plus "Approve all"/"Revoke all" actions.
// Mirrors Dropdown's own open/close + outside-click wiring (a portaled menu
// element, a document-level mousedown listener, focus restored to the
// trigger on close) rather than reimplementing that plumbing.
export function PermissionMenu({ trigger, categories = [], approved = [], onToggle, onToggleAll, placement = 'bottom-start', ariaLabel = 'Permissions' } = {}) {
    const isApproved = (id) => approved.indexOf(id) !== -1;
    const menu = useRovingMenu({ itemSelector: '[role="menuitemcheckbox"]', items: categories, getLabel: (cat) => cat.label || cat.id, typeahead: true, placement });
    const toggle = (cat) => { if (onToggle) onToggle(cat.id, !isApproved(cat.id)); };
    const buildMenuEl = () => {
        const el = document.createElement('div');
        el.className = 'ds-popover ov-perm-menu';
        el.setAttribute('role', 'menu');
        el.setAttribute('aria-label', ariaLabel);
        const rows = categories.map((cat, i) => h('button', {
            key: cat.id || i, type: 'button', role: 'menuitemcheckbox',
            'aria-checked': isApproved(cat.id) ? 'true' : 'false',
            class: 'ov-perm-item' + (isApproved(cat.id) ? ' is-approved' : ''),
            tabindex: '-1',
            onclick: () => toggle(cat),
        }, h('span', { class: 'ov-perm-label' }, cat.label || cat.id)));
        const actionsRow = h('div', { class: 'ov-perm-actions' },
            h('button', { type: 'button', class: 'ov-perm-action', onclick: () => onToggleAll && onToggleAll(true) }, 'Approve all'),
            h('button', { type: 'button', class: 'ov-perm-action', onclick: () => onToggleAll && onToggleAll(false) }, 'Revoke all'));
        webjsx.applyDiff(el, h('div', { class: 'ov-perm-list' }, ...rows, actionsRow));
        return el;
    };
    const onTrigClick = () => menu.onTrigClick(buildMenuEl);
    const onTrigKey = (e) => menu.onTrigKey(e, buildMenuEl);
    const refFn = menu.refFn('_dsPermMenu');
    const child = (typeof trigger === 'function') ? trigger() : trigger;
    const wireRef = (el) => { refFn(el); if (el) { el.addEventListener('click', onTrigClick); el.addEventListener('keydown', onTrigKey); } };
    return (child && child.type)
        ? webjsx.createElement(child.type, { ...(child.props || {}), ref: wireRef }, ...(child.children || []))
        : h('button', { type: 'button', class: 'ov-perm-trigger', ref: wireRef }, child || 'Permissions');
}

// MenuButton — icon-trigger select menu: one option carries a checkmark
// (the active selection), roving keyboard nav mirrors Dropdown's own
// open/close/outside-click/typeahead wiring, plus a stale/unavailable
// per-item state that renders as a muted "unavailable — retry" row instead
// of a normal selectable item (ported from docstudio's model-picker menu,
// which shows a retry affordance when its option list fails to load).
// Zero-option and single-option lists degrade gracefully: an empty list
// renders a static "No options available" row (no crash, no keyboard trap,
// nothing focusable); roving nav on a single-option list simply refocuses
// the same item on every Arrow press (wrap-to-self), never throws.
export function MenuButton({ trigger, items = [], selected, onSelect, onRetry, placement = 'bottom-start', ariaLabel = 'Menu', emptyText = 'No options available' } = {}) {
    const menu = useRovingMenu({ itemSelector: '[role="menuitemradio"]:not([aria-disabled="true"])', items, typeahead: true, placement });
    const select = (it) => { if (it.disabled || it.unavailable) return; if (onSelect) onSelect(it.id, it); menu.close(); };
    const buildMenuEl = () => {
        const el = document.createElement('div');
        el.className = 'ds-popover ov-menubutton-menu';
        el.setAttribute('role', 'menu');
        el.setAttribute('aria-label', ariaLabel);
        const tree = items.length
            ? h('div', { class: 'ov-menubutton-list' },
                ...items.map((it, i) => it.unavailable
                    ? h('div', { key: it.id || i, class: 'ov-menubutton-item is-unavailable' },
                        h('span', { class: 'ov-menubutton-label' }, it.label || 'Unavailable'),
                        h('button', { type: 'button', class: 'ov-menubutton-retry', onclick: () => onRetry && onRetry(it.id, it) }, 'Retry')
                    )
                    : h('button', {
                        key: it.id || i, type: 'button', role: 'menuitemradio',
                        'aria-checked': it.id === selected ? 'true' : 'false',
                        // No disabled modifier class: editor-primitives.css styles
                        // .ov-menubutton-item[aria-disabled="true"] directly, so the
                        // aria attribute below is both the semantics and the hook.
                        // (This was a ternary whose branches returned the same string.)
                        class: 'ov-menubutton-item',
                        'aria-disabled': it.disabled ? 'true' : 'false',
                        tabindex: '-1', onclick: () => select(it),
                    },
                        h('span', { class: 'ov-menubutton-check', 'aria-hidden': 'true' }, it.id === selected ? Icon('check', { size: 14 }) : ''),
                        h('span', { class: 'ov-menubutton-label' }, it.label)
                    )))
            : h('div', { class: 'ov-menubutton-empty' }, emptyText);
        webjsx.applyDiff(el, tree);
        return el;
    };
    const onTrigClick = () => menu.onTrigClick(buildMenuEl);
    const onTrigKey = (e) => menu.onTrigKey(e, buildMenuEl);
    const refFn = menu.refFn('_ovMenuButton');
    const child = (typeof trigger === 'function') ? trigger() : trigger;
    const wireRef = (el) => { refFn(el); if (el) { el.addEventListener('click', onTrigClick); el.addEventListener('keydown', onTrigKey); } };
    return (child && child.type)
        ? webjsx.createElement(child.type, { ...(child.props || {}), ref: wireRef }, ...(child.children || []))
        : h('button', { type: 'button', class: 'ov-menubutton-trigger', ref: wireRef }, child || 'Select');
}
