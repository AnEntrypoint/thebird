// SpreadsheetPreview — tabbed inline spreadsheet/CSV viewer, ported from
// docstudio's documents/xls-preview.js. The kit does no parsing (no SheetJS
// dependency): the host hands over an already-parsed `workbook` shape and
// this component only renders tabs + a table + loading/error/truncation
// states, reusing the existing Skeleton/Alert primitives rather than
// inventing new visual language.

import * as webjsx from '../../vendor/webjsx/index.js';
import { Skeleton, Alert } from './content.js';
const h = webjsx.createElement;

const DEFAULT_MAX_ROWS = 500;
const DEFAULT_MAX_COLS = 80;

// workbook: { sheetNames: string[], sheets: { [name]: string[][] } }
export function SpreadsheetPreview({
    workbook, activeSheet, onSheetChange,
    maxRows = DEFAULT_MAX_ROWS, maxCols = DEFAULT_MAX_COLS,
    truncated, loading, error, errorActionLabel = 'retry', onErrorAction,
    key,
} = {}) {
    if (loading) {
        return h('div', { key, class: 'ds-sheet-preview is-loading' },
            Skeleton({ height: '1.8em', width: '40%', label: 'loading spreadsheet' }),
            Skeleton({ height: '14em', width: '100%' }));
    }

    if (error) {
        return h('div', { key, class: 'ds-sheet-preview is-error' },
            Alert({
                kind: 'error',
                title: 'could not preview this file',
                children: [String(error)],
            }),
            onErrorAction ? h('button', {
                type: 'button', class: 'ds-sheet-preview-error-action', onclick: onErrorAction,
            }, errorActionLabel) : null);
    }

    const sheetNames = (workbook && workbook.sheetNames) || [];
    if (!sheetNames.length) {
        return h('div', { key, class: 'ds-sheet-preview is-empty' }, 'no sheets found');
    }

    const active = activeSheet && sheetNames.includes(activeSheet) ? activeSheet : sheetNames[0];
    const rowsRaw = (workbook.sheets && workbook.sheets[active]) || [];

    const rowOverflow = rowsRaw.length > maxRows;
    const rows = rowsRaw.slice(0, maxRows);
    const colOverflow = rows.some((r) => Array.isArray(r) && r.length > maxCols);
    const clampedRows = rows.map((r) => (Array.isArray(r) ? r.slice(0, maxCols) : r));
    const isTruncated = truncated || rowOverflow || colOverflow;

    const isNumeric = (v) => v !== '' && v != null && !isNaN(Number(v));

    return h('div', { key, class: 'ds-sheet-preview' },
        sheetNames.length > 1 ? h('div', {
            class: 'ds-sheet-preview-tabbar', role: 'tablist', 'aria-label': 'sheets',
        }, ...sheetNames.map((name) => h('button', {
            key: name, type: 'button', role: 'tab',
            'aria-selected': name === active ? 'true' : 'false',
            tabindex: name === active ? '0' : '-1',
            class: 'ds-sheet-preview-tab' + (name === active ? ' is-active' : ''),
            onclick: () => onSheetChange && onSheetChange(name),
        }, name))) : null,
        isTruncated ? h('div', { class: 'ds-sheet-preview-truncated', role: 'status' },
            'showing first ' + clampedRows.length + ' rows' + (colOverflow ? ' (columns truncated)' : '') + ' — full file has more data') : null,
        h('div', { class: 'ds-sheet-preview-body' },
            clampedRows.length === 0
                ? h('div', { class: 'ds-sheet-preview-empty' }, 'empty sheet')
                : h('table', { class: 'ds-sheet-preview-table' },
                    h('thead', {}, h('tr', {},
                        ...(clampedRows[0] || []).map((cell, i) => h('th', { key: i, scope: 'col' }, cell == null ? '' : String(cell))))),
                    h('tbody', {}, ...clampedRows.slice(1).map((row, ri) => h('tr', { key: ri },
                        ...row.map((cell, ci) => h('td', {
                            key: ci, class: isNumeric(cell) ? 'num' : null,
                        }, cell == null ? '' : String(cell)))))))));
}
