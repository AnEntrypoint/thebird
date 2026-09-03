// Tables — the generic `Table` primitive plus the two domain tables built
// directly on it: HealthTable (a health-check map with per-value tone
// inference) and ProcessRegistryTable (a live long-lived-process census).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon, Chip } from '../shell.js';
const h = webjsx.createElement;

export function Table({ headers = [], rows = [], onRowClick, emptyText = 'nothing here yet', rowLabels, striped = false, compact = false, sortable = false, sortKey, sortDir = 'asc', onSort }) {
    if (!rows || rows.length === 0) return h('div', { class: 'empty' }, emptyText);
    // rowLabels lets callers supply a plain-text label per row when the first
    // cell is a vnode (so the aria-label is meaningful, not the literal 'row').
    const labelFor = (row, i) => {
        if (Array.isArray(rowLabels) && rowLabels[i] != null) return String(rowLabels[i]);
        const c = row[0];
        return c == null ? 'row' : (typeof c === 'object' ? 'row' : String(c));
    };
    // Native <table>/<tr>/<th>/<td> already carry the correct implicit ARIA
    // roles — explicit role="table"/row/columnheader/cell is redundant and only
    // risks overriding native semantics, so it is omitted.
    // Scroll containment lives on the component itself: a wide table used
    // outside a Panel must never force page-level horizontal scroll.
    // striped/compact are opt-in density modifiers (webgeist g-table parity) —
    // default false so the existing contract/visual is byte-unchanged.
    const wrapClass = 'ds-table-wrap' + (striped ? ' is-striped' : '') + (compact ? ' is-compact' : '');
    // sortable is opt-in (default false, byte-unchanged for existing callers):
    // a header becomes a real <button> announcing aria-sort, dispatching
    // onSort(headerIndex) so the HOST owns the actual row-ordering logic (this
    // component has no opinion on comparator/locale/type - it only renders the
    // control and current state). A docstudio-style dense admin table needs
    // sortable columns; Table previously had no way to express that at all.
    const thFor = (hd, i, isNum) => {
        if (!sortable || !onSort) return h('th', { key: i, scope: 'col', class: isNum ? 'is-num' : null }, hd);
        const isActive = sortKey === i;
        const ariaSort = isActive ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
        return h('th', { key: i, scope: 'col', 'aria-sort': ariaSort, class: isNum ? 'is-num' : null },
            h('button', { type: 'button', class: 'ds-table-sort-btn' + (isActive ? ' is-active' : ''), onclick: () => onSort(i) },
                h('span', { class: 'ds-table-sort-label' }, hd),
                isActive ? Icon(sortDir === 'desc' ? 'chevron-down' : 'chevron-up', { size: 12 }) : null));
    };
    // The wrapper is an `overflow-x: auto` scroll container, so when a table is
    // wider than its box the only way to reach the clipped columns is by
    // scrolling. A mouse/touch user can drag it; a keyboard-only user cannot
    // reach it at all unless the container itself is focusable — that is
    // WCAG 2.1.1 Keyboard, and axe's `scrollable-region-focusable`. tabindex="0"
    // puts it in the tab order and arrow keys then scroll it natively.
    // A bare focusable div with no role/name is itself a violation, so it is
    // labelled and given the `group` role: `region` would inject an
    // unconditional landmark into every page that renders a Table.
    // NOTE this fires only when the table actually overflows, which is
    // viewport-dependent — it reproduces at 1024x768 but not at 1280x900,
    // which is why it surfaced only in CI's viewport.
    // A column is numeric when every row's value in it is a plain
    // integer/decimal (optionally signed) — checked across the whole column,
    // not per-cell, so a mixed column (e.g. one row's count rendered as a
    // Chip vnode) never right-aligns only some of its cells.
    const NUM_RE = /^-?\d+(\.\d+)?$/;
    const isNumericCol = (j) => rows.every((row) => {
        const c = row[j];
        return c != null && typeof c !== 'object' && NUM_RE.test(String(c).trim());
    });
    const numericCols = headers.map((_, j) => isNumericCol(j));
    return h('div', {
        class: wrapClass,
        tabindex: '0',
        role: 'group',
        'aria-label': 'table, scrollable',
    }, h('table', {},
        h('thead', {}, h('tr', {}, ...headers.map((hd, i) => thFor(hd, i, numericCols[i])))),
        h('tbody', {}, ...rows.map((row, i) => h('tr', {
            key: i,
            class: onRowClick ? 'clickable' : '',
            onclick: onRowClick ? () => onRowClick(i) : null,
            // Space scrolls by default — preventDefault on Space (and Enter) so
            // keyboard activation matches click without page jump.
            ...(onRowClick ? { tabindex: '0', role: 'button', 'aria-label': 'open ' + labelFor(row, i), onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onRowClick(i); } } } : {})
        }, ...row.map((c, j) => h('td', { key: j, class: numericCols[j] ? 'is-num' : null }, c == null ? '' : (typeof c === 'object' ? c : String(c)))))))));
}

// HealthTable — generic health-check table: given an arbitrary
// `{checkName: value}` object, infers a Chip tone per row from the value's
// own type (boolean true/false -> ok/miss Chip, object -> truncated JSON
// string, else the raw value stringified) so a new backend health check
// appears with zero per-check hardcoding at the call site. Ported from
// freddie's health page (src/components/freddie.js's `health` page), which
// hand-rolled this exact inference inline; promoted here as a reusable
// primitive for any dashboard/monitoring surface with a health-check map
// (agentgui's Live tab included). `okLabel`/`missLabel` let a caller
// localize the two Chip strings; `jsonTruncate` caps the JSON.stringify
// length for object-shaped values (matches freddie's own truncation width).
export function HealthTable({ checks = {}, emptyText = 'no health data', okLabel = 'ok', missLabel = 'no', jsonTruncate = 60 } = {}) {
    const entries = Object.entries(checks);
    if (!entries.length) return h('div', { class: 'empty' }, emptyText);
    const rows = entries.map(([name, v]) => {
        let cell;
        if (typeof v === 'object' && v !== null) {
            const s = JSON.stringify(v);
            cell = h('span', { title: s.length > jsonTruncate ? s : null }, s.length > jsonTruncate ? s.slice(0, jsonTruncate) + '…' : s);
        } else if (v === true) cell = Chip({ tone: 'ok', children: okLabel });
        else if (v === false) cell = Chip({ tone: 'miss', children: missLabel });
        else cell = String(v);
        return [name, cell];
    });
    return Table({ headers: ['check', 'status'], rows });
}

// ProcessRegistryTable — generic long-lived-process registry table: given a
// list of `{kind, key, state}`-shaped rows (any in-flight process the host
// tracks — an xstate machine, an ACP/direct-runner session, a background
// job), renders a uniform table. Ported from freddie's `machines` page
// (src/components/freddie.js), which used this exact shape for its xstate
// machine census; generalized here since the shape (kind/key/state) applies
// equally to agentgui's Live tab listing in-flight agent runner processes.
// `extraColumns` lets a caller append columns beyond the base three (e.g. a
// stop-action button) without forking the whole table.
export function ProcessRegistryTable({ processes = [], emptyText = 'no live processes', extraColumns = [] } = {}) {
    if (!processes.length) return h('div', { class: 'empty' }, emptyText);
    const headers = ['kind', 'key', 'state', ...extraColumns.map(c => c.header)];
    const rows = processes.map(p => [
        p.kind || '—', p.key || '—', p.state || '—',
        ...extraColumns.map(c => c.render(p))
    ]);
    return Table({ headers, rows });
}
