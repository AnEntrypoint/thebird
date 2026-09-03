// useRovingMenu — the shared open/close/outside-click/roving-nav/typeahead
// state machine behind Dropdown, PermissionMenu, and MenuButton (all three in
// ./menus.js). All three previously reimplemented an identical ~70-line
// skeleton (byte-identical close() teardown, near-identical onMenuKey); this
// factors it into one place so a fix/feature (e.g. typeahead) lands for every
// consumer instead of drifting per-copy. `itemSelector` picks the live
// focusable items inside the rendered menu (each consumer uses a different
// role: menuitem / menuitemcheckbox / menuitemradio); `getLabel(item)` +
// `items` enable typeahead when `typeahead` is true (Dropdown/MenuButton have
// it, PermissionMenu's categories aren't typically typeahead-searched so it
// defaults off but can opt in). Returns { refFn, onTrigClick, onTrigKey,
// openMenu, close, focusItem, isOpen } — the caller still owns rendering the
// menu's DOM/CSS (role/class per consumer stays distinct) and wires
// `menuEl.addEventListener('keydown', onMenuKey)` itself via the returned
// `onMenuKey`, since only the caller knows when its menuEl exists.

import { useFloating, FLOAT_OFFSET_DROPDOWN } from './floating.js';

export function useRovingMenu({ itemSelector, items = [], getLabel = (it) => it.label, typeahead = false, placement = 'bottom-start', onOpenChange } = {}) {
    let triggerEl = null, open = false, menuEl = null, floating = null, typeBuf = '', typeTimer = null;
    const liveItems = () => menuEl ? [...menuEl.querySelectorAll(itemSelector)] : [];
    const focusItem = (idx) => { const b = liveItems(); if (!b.length) return; b[((idx % b.length) + b.length) % b.length].focus(); };
    const onDown = (e) => { if (menuEl && menuEl.contains(e.target)) return; if (triggerEl && triggerEl.contains(e.target)) return; close(false); };
    const close = (restore = true) => {
        if (!open) return; open = false;
        if (floating) { floating.dispose(); floating = null; }
        if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
        menuEl = null;
        document.removeEventListener('mousedown', onDown, true);
        if (triggerEl) triggerEl.setAttribute('aria-expanded', 'false');
        if (restore && triggerEl) triggerEl.focus();
        if (onOpenChange) onOpenChange(false);
    };
    const onMenuKey = (e) => {
        const b = liveItems(), idx = b.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(idx + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(idx - 1); }
        else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
        else if (e.key === 'End') { e.preventDefault(); focusItem(b.length - 1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (idx >= 0) b[idx].click(); }
        else if (typeahead && e.key.length === 1 && /\S/.test(e.key)) {
            typeBuf += e.key.toLowerCase();
            if (typeTimer) clearTimeout(typeTimer);
            typeTimer = setTimeout(() => { typeBuf = ''; }, 600);
            const selectable = items.filter(it => !it.separator && !it.disabled && !it.unavailable);
            const m = selectable.findIndex(it => (getLabel(it) || '').toLowerCase().startsWith(typeBuf));
            if (m >= 0) focusItem(m);
        }
    };
    const openMenu = (buildMenuEl, focusFirst = true) => {
        if (open || !triggerEl) return;
        open = true;
        menuEl = buildMenuEl();
        menuEl.tabIndex = -1;
        document.body.appendChild(menuEl);
        menuEl.addEventListener('keydown', onMenuKey);
        floating = useFloating(triggerEl, menuEl, { placement, offset: FLOAT_OFFSET_DROPDOWN });
        document.addEventListener('mousedown', onDown, true);
        triggerEl.setAttribute('aria-expanded', 'true');
        if (focusFirst && liveItems().length) setTimeout(() => focusItem(0), 0);
        if (onOpenChange) onOpenChange(true);
    };
    const onTrigClick = (buildMenuEl) => { if (open) close(false); else openMenu(buildMenuEl, true); };
    const onTrigKey = (e, buildMenuEl) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!open) openMenu(buildMenuEl, true); else focusItem(0); } };
    const refFn = (dsFlag) => (el) => {
        if (!el || el[dsFlag]) return;
        el[dsFlag] = true; triggerEl = el;
        el.setAttribute('aria-haspopup', 'menu');
        el.setAttribute('aria-expanded', 'false');
    };
    return { refFn, onTrigClick, onTrigKey, openMenu, close, focusItem, isOpen: () => open };
}
