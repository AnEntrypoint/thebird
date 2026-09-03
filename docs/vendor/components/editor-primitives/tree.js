// Tree — TreeView container + TreeItem row, implementing the WAI-ARIA tree
// keyboard model (Up/Down between visible rows, Right expands/enters, Left
// collapses, Enter/Space activate, Home/End jump). Visuals via
// editor-primitives.css; no hex/rgba literals here.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { kids } from './shared.js';
const h = webjsx.createElement;

export function TreeView({ children } = {}) {
    return h('div', { class: 'ds-ep-tree', role: 'tree' }, ...kids(children));
}

export function TreeItem({ label, glyph, tag, depth = 0, selected = false, expanded = false, onSelect, onToggle, children, hasChildren } = {}) {
    // Support legacy 'hasChildren' prop for future; infer from children param
    const hasKids = hasChildren != null ? hasChildren : (children != null);
    // Tree keyboard model (WAI-ARIA): Up/Down move between visible rows, Right expands/enters,
    // Left collapses/moves to parent, Enter/Space activate, Home/End jump to first/last visible.
    const onRowKeyDown = (e) => {
        const row = e.currentTarget;
        const tree = row.closest('[role="tree"]');
        if (!tree) return;
        const rows = Array.from(tree.querySelectorAll('.ds-ep-tree-row'));
        const idx = rows.indexOf(row);
        if (idx < 0) return;
        const move = (i) => {
            const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
            if (r) r.focus();
        };
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); move(idx + 1); break;
            case 'ArrowUp':   e.preventDefault(); move(idx - 1); break;
            case 'Home':      e.preventDefault(); move(0); break;
            case 'End':       e.preventDefault(); move(rows.length - 1); break;
            case 'ArrowRight':
                if (hasKids && !expanded && onToggle) { e.preventDefault(); onToggle(); }
                else if (hasKids && expanded) { e.preventDefault(); move(idx + 1); }
                break;
            case 'ArrowLeft':
                if (hasKids && expanded && onToggle) { e.preventDefault(); onToggle(); }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (onSelect) onSelect();
                break;
        }
    };
    return h('div', {
        class: 'ds-ep-tree-item' + (selected ? ' selected' : ''),
        role: 'treeitem',
        'aria-selected': selected ? 'true' : 'false',
        'aria-expanded': hasKids ? String(!!expanded) : null,
        'aria-level': depth + 1
    },
        h('div', {
            class: 'ds-ep-tree-row',
            style: 'padding-left:calc(' + depth + ' * var(--tree-indent,12px) + var(--tree-base-indent,6px))',
            tabindex: selected ? '0' : '-1',
            onclick: () => onSelect && onSelect(),
            onkeydown: onRowKeyDown
        },
            h('span', {
                class: 'ds-ep-tree-twist' + (expanded ? ' open' : ''),
                'aria-hidden': 'true',
                onclick: (e) => { e.stopPropagation(); if (hasKids && onToggle) onToggle(); }
            }, hasKids ? Icon('chevron-right') : ''),
            glyph != null ? h('span', { class: 'ds-ep-tree-glyph', 'aria-hidden': 'true' }, glyph) : null,
            h('span', { class: 'ds-ep-tree-label' }, label),
            tag != null ? h('span', { class: 'ds-ep-tree-tag' }, tag) : null
        ),
        hasKids && expanded ? h('div', { class: 'ds-ep-tree-children', role: 'group' }, ...kids(children)) : null
    );
}
