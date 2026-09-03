// FileGrid toolbar controls: the density radiogroup (list / compact /
// thumbnails), the clickable sort-column header, and the WAI-ARIA roving-radio
// keyboard helper both share.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

export const DENSITIES = [['list', 'list'], ['compact', 'compact'], ['thumb', 'thumbnails']];
export const DENSITY_ICONS = { list: 'rows', compact: 'rows-tight', thumb: 'grid' };

// Roving-radiogroup keyboard helper (the WAI-ARIA radio pattern): a radiogroup
// is a SINGLE tab stop where Arrow/Home/End move AND select among options, with
// selection following focus. `items` is the ordered [[key, ...], ...] list;
// `onSelect(targetKey)` is the same handler the onclick fires. Mouse path is
// unchanged - this only adds keyboard navigation.
export function rovingRadio(e, idx, items, onSelect) {
    let target = -1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = (idx - 1 + items.length) % items.length;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = (idx + 1) % items.length;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = items.length - 1;
    else return;
    e.preventDefault();
    onSelect(items[target][0]);
    const sib = e.currentTarget.parentNode && e.currentTarget.parentNode.children[target];
    sib && sib.focus();
}

// Clickable column headers for FileGrid sort. Active column shows its direction
// as an ASCII caret word (asc/desc) - never a glyph arrow.
export function FileSortHeader({ key: active = 'name', dir = 'asc', onSort } = {}) {
    const cols = [['name', 'name'], ['size', 'size'], ['modified', 'modified']];
    return h('div', { class: 'ds-file-sort', role: 'group', 'aria-label': 'sort files' },
        ...cols.map(([k, label]) => h('button', {
            key: k, type: 'button',
            class: 'ds-file-sort-btn' + (active === k ? ' active' : ''),
            'aria-pressed': active === k ? 'true' : 'false',
            'aria-label': 'sort by ' + label + (active === k ? ' (' + (dir === 'asc' ? 'ascending' : 'descending') + ')' : ''),
            onclick: () => onSort && onSort(k),
        }, label + (active === k ? ' ' + (dir === 'asc' ? 'asc' : 'desc') : ''))));
}

// Density picker — list / compact / thumbnails. A radiogroup, not tabs:
// it switches presentation of the same content, not panels.
export function DensityPicker({ density = 'list', onDensity } = {}) {
    if (!onDensity) return null;
    return h('div', { key: 'density', class: 'ds-density', role: 'radiogroup', 'aria-label': 'view density' },
        ...DENSITIES.map(([k, label], idx) => h('button', {
            key: 'd-' + k, type: 'button', role: 'radio',
            class: 'ds-density-btn' + (density === k ? ' active' : ''),
            'aria-checked': density === k ? 'true' : 'false',
            // Icon-led, but the density name stays the accessible name
            // (aria-label) + the native tooltip (title) so the control reads
            // dense without losing its label.
            'aria-label': label, title: label,
            // Single tab stop: the checked radio is tabbable, the rest are
            // roved. Arrow/Home/End move + select (selection follows focus).
            tabindex: density === k ? '0' : '-1',
            onkeydown: (e) => rovingRadio(e, idx, DENSITIES, (tk) => { if (density !== tk) onDensity(tk); }),
            onclick: () => { if (density !== k) onDensity(k); },
        }, Icon(DENSITY_ICONS[k], { size: 15 }))));
}
