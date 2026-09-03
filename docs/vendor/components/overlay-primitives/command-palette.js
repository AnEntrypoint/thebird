// CommandPalette — centered Cmd+K palette with live filter + keyboard nav.
// The result list is rendered imperatively (applyDiff into the list element)
// so filter/active-index changes repaint only the list, not the whole page.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

export function CommandPalette({ open, items = [], onSelect, onClose } = {}) {
    if (!open) return null;
    const list = Array.isArray(items) ? items : [];
    const labelOf = (it) => String(it.label || it.title || it.name || '');
    let active = 0, filterText = '';

    const matches = () => {
        const q = filterText.trim().toLowerCase();
        return q ? list.filter(it => labelOf(it).toLowerCase().includes(q)) : list.slice();
    };

    const rowsFor = (filtered) => {
        const out = [];
        let lastGroup = null, flatIdx = 0;
        for (const it of filtered) {
            const grp = it.group != null ? String(it.group) : null;
            if (grp && grp !== lastGroup) {
                out.push(h('div', { class: 'ov-cmd-group', role: 'presentation' }, grp));
                lastGroup = grp;
            }
            const idx = flatIdx++;
            const glyph = it.icon != null ? it.icon : (it.glyph != null ? it.glyph : null);
            const hint = it.hint != null ? it.hint : (it.shortcut != null ? it.shortcut : null);
            out.push(h('button', {
                type: 'button', role: 'option',
                id: 'ov-cmd-item-' + idx,
                'data-idx': String(idx),
                'aria-selected': idx === active ? 'true' : 'false',
                class: 'ov-cmd-item' + (idx === active ? ' is-active' : ''),
                onclick: () => choose(it),
                onmousemove: () => { if (active !== idx) { active = idx; renderInner(); } },
            },
                glyph != null ? h('span', { class: 'ov-cmd-glyph', 'aria-hidden': 'true' }, glyph) : null,
                h('span', { class: 'ov-cmd-label' }, labelOf(it)),
                hint != null ? h('span', { class: 'ov-cmd-hint' }, hint) : null
            ));
        }
        return out;
    };

    let rootEl = null, inputEl = null, listEl = null, flat = [];
    // Remember the element focused before the palette opened so we can return
    // focus there on close (the input steals focus on mount).
    const prevFocus = (typeof document !== 'undefined') ? document.activeElement : null;
    const restoreFocus = () => { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); };
    const close = () => { restoreFocus(); if (onClose) onClose(); };
    const choose = (it) => { if (it && onSelect) onSelect(it); };

    const renderInner = () => {
        if (!listEl) return;
        const filtered = matches();
        flat = filtered;
        if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
        webjsx.applyDiff(listEl, h('div', { class: 'ov-cmd-list-inner' },
            filtered.length ? rowsFor(filtered) : h('div', { class: 'ov-cmd-empty' }, 'No results')));
        const sel = listEl.querySelector('.ov-cmd-item.is-active');
        if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
        if (inputEl) inputEl.setAttribute('aria-activedescendant', filtered.length ? 'ov-cmd-item-' + active : '');
    };

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) { active = (active + 1) % flat.length; renderInner(); } }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) { active = (active - 1 + flat.length) % flat.length; renderInner(); } }
        else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) choose(flat[active]); }
    };

    return h('div', {
        class: 'ov-cmd-backdrop', role: 'presentation',
        ref: (el) => {
            if (!el || el._ovCmd) return; el._ovCmd = true; rootEl = el;
            el.addEventListener('mousedown', (e) => {
                const panel = el.querySelector('.ov-cmd-panel');
                if (panel && !panel.contains(e.target)) close();
            });
        },
    },
        h('div', { class: 'ov-cmd-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette', onkeydown: onKey },
            h('input', {
                type: 'text', class: 'ov-cmd-input', placeholder: 'Type a command…',
                'aria-label': 'command search',
                role: 'combobox',
                'aria-autocomplete': 'list',
                'aria-expanded': 'true',
                'aria-controls': 'ov-cmd-list',
                'aria-activedescendant': '',
                oninput: (e) => { filterText = e.target.value; active = 0; renderInner(); },
                ref: (el) => { if (!el || el._ovCmdIn) return; el._ovCmdIn = true; inputEl = el; setTimeout(() => el.focus(), 0); },
            }),
            h('div', { class: 'ov-cmd-list', id: 'ov-cmd-list', role: 'listbox',
                ref: (el) => { if (!el) return; listEl = el; queueMicrotask(renderInner); } })
        )
    );
}
