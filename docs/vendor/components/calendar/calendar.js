// Calendar — controlled date-grid primitive. mode='single' calls
// onSelect(date) on click/Enter; mode='range' uses a two-click anchor
// (first click sets the range start, second sets the end) with a
// hover-preview highlight between anchor and the hovered cell. selected/
// month are owned entirely by the caller; the only state this module keeps
// is UI-only (hover-preview cell, keyboard-focused cell) via `ref`-captured
// DOM roving tabindex, matching the FileGrid/DensityPicker roving pattern in
// this codebase (querySelectorAll the live day buttons, move focus by index,
// tabindex follows focus) rather than reimplementing useRovingMenu's popup-
// menu open/close machinery, which this inline grid does not need.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { getLocale } from '../../i18n.js';
import {
    WEEKDAY_LABELS, buildMonthGrid, key, sameDay, addMonths, isBefore, isAfter,
    isDisabled, monthLabel,
} from './grid.js';
const h = webjsx.createElement;

// Module-scoped hover-preview state for range mode, keyed by the grid's own
// wrapper element — pure UI-only concern (never handed back to the caller),
// same shape as Popover's WeakMap-keyed instance bookkeeping.
const _hoverPreview = new WeakMap();

function rangeBounds(selected) {
    if (!selected) return { from: null, to: null };
    const { from, to } = selected;
    if (from && to && isAfter(from, to)) return { from: to, to: from };
    return { from, to };
}

/**
 * A month date-grid. Fully controlled: `selected`/`month` are owned by the
 * caller, this component holds no selection state of its own.
 *
 * @param {Object} props
 * @param {'single'|'range'} [props.mode='single']
 * @param {Date|{from:?Date,to:?Date}} [props.selected] - a Date in single mode, `{from,to}` in range mode.
 * @param {Function} [props.onSelect] - single mode: `onSelect(date)`. range mode: `onSelect({from,to})`.
 * @param {Date} props.month - the currently-displayed month (any date within it).
 * @param {Function} [props.onMonthChange] - `onMonthChange(newMonthDate)`, fired by the prev/next nav.
 * @param {Date} [props.minDate]
 * @param {Date} [props.maxDate]
 * @param {string} [props.locale] - BCP-47 locale for weekday/month labels; defaults to the SDK's active locale.
 * @returns {*} webjsx vnode
 */
export function Calendar({ mode = 'single', selected, onSelect, month, onMonthChange, minDate, maxDate, locale = getLocale() } = {}) {
    const monthDate = month ? new Date(month) : new Date();
    const cells = buildMonthGrid(monthDate);
    const today = new Date();
    const { from, to } = mode === 'range' ? rangeBounds(selected) : { from: null, to: null };

    const onDayActivate = (date) => {
        if (isDisabled(date, minDate, maxDate) || !onSelect) return;
        if (mode === 'single') { onSelect(date); return; }
        // Range: no anchor yet, or a full range already picked -> start fresh.
        if (!from || (from && to)) { onSelect({ from: date, to: null }); return; }
        // One anchor set -> this click closes the range (either order).
        onSelect(isBefore(date, from) ? { from: date, to: from } : { from, to: date });
    };

    const onGridKeyDown = (e) => {
        const grid = e.currentTarget;
        const days = Array.from(grid.querySelectorAll('.ds-cal-day:not([disabled])'));
        const cur = days.indexOf(document.activeElement);
        let target = -1;
        if (e.key === 'ArrowRight') target = cur + 1;
        else if (e.key === 'ArrowLeft') target = cur - 1;
        else if (e.key === 'ArrowDown') target = cur + 7;
        else if (e.key === 'ArrowUp') target = cur - 7;
        else if (e.key === 'Home') target = 0;
        else if (e.key === 'End') target = days.length - 1;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); days[cur]?.click(); return; }
        else return;
        e.preventDefault();
        if (target < 0 || target >= days.length) return;
        days[target].focus();
    };

    const onDayHover = (date) => {
        if (mode !== 'range' || !from || to) return;
        _hoverPreview.set(monthDate, date);
    };

    const hoverDate = mode === 'range' ? _hoverPreview.get(monthDate) : null;
    const previewFrom = from && !to && hoverDate ? (isBefore(hoverDate, from) ? hoverDate : from) : null;
    const previewTo = from && !to && hoverDate ? (isBefore(hoverDate, from) ? from : hoverDate) : null;

    const dayCell = (cell, idx) => {
        const disabled = isDisabled(cell.date, minDate, maxDate);
        const isToday = sameDay(cell.date, today);
        const isSelected = mode === 'single' ? sameDay(cell.date, selected) : (sameDay(cell.date, from) || sameDay(cell.date, to));
        const isRangeStart = mode === 'range' && from && sameDay(cell.date, from);
        const isRangeEnd = mode === 'range' && to && sameDay(cell.date, to);
        const inCommittedRange = mode === 'range' && from && to && !isBefore(cell.date, from) && !isAfter(cell.date, to) && !isRangeStart && !isRangeEnd;
        const inPreviewRange = mode === 'range' && previewFrom && previewTo
            && !isBefore(cell.date, previewFrom) && !isAfter(cell.date, previewTo);
        const cls = ['ds-cal-day',
            !cell.inMonth ? 'ds-cal-day-outside' : '',
            isToday ? 'ds-cal-day-today' : '',
            isSelected ? 'ds-cal-day-selected' : '',
            isRangeStart ? 'ds-cal-day-range-start' : '',
            isRangeEnd ? 'ds-cal-day-range-end' : '',
            (inCommittedRange || (inPreviewRange && !isSelected)) ? 'ds-cal-day-in-range' : '',
            disabled ? 'ds-cal-day-disabled' : ''].filter(Boolean).join(' ');
        // Roving tabindex: only one day is a tab stop at a time (the selected
        // day, today, or the first in-month day as fallback), matching
        // DensityPicker's rovingRadio contract in files/grid-controls.js.
        const isTabStop = isSelected || (!selected && isToday) || (!selected && !isToday && idx === cells.findIndex(c => c.inMonth));
        return h('button', {
            key: key(cell.date),
            type: 'button',
            class: cls,
            disabled: disabled ? true : null,
            'aria-pressed': isSelected ? 'true' : 'false',
            'aria-current': isToday ? 'date' : null,
            'aria-label': cell.date.toDateString(),
            tabindex: isTabStop ? '0' : '-1',
            onclick: () => onDayActivate(cell.date),
            onmouseenter: () => onDayHover(cell.date),
        }, String(cell.date.getDate()));
    };

    return h('div', { class: 'ds-cal' },
        h('div', { class: 'ds-cal-head' },
            h('button', {
                type: 'button', class: 'ds-cal-nav ds-cal-nav-prev',
                'aria-label': 'previous month',
                onclick: () => onMonthChange && onMonthChange(addMonths(monthDate, -1)),
            }, Icon('chevron-left', { size: 16 })),
            h('span', { class: 'ds-cal-title' }, monthLabel(monthDate, locale)),
            h('button', {
                type: 'button', class: 'ds-cal-nav ds-cal-nav-next',
                'aria-label': 'next month',
                onclick: () => onMonthChange && onMonthChange(addMonths(monthDate, 1)),
            }, Icon('chevron-right', { size: 16 }))),
        h('div', { class: 'ds-cal-weekdays', 'aria-hidden': 'true' },
            ...WEEKDAY_LABELS.map((w, i) => h('span', { key: i, class: 'ds-cal-weekday-label' }, w))),
        h('div', {
            class: 'ds-cal-grid', role: 'grid', 'aria-label': monthLabel(monthDate, locale),
            onkeydown: onGridKeyDown,
        }, ...cells.map((c, i) => dayCell(c, i))));
}
