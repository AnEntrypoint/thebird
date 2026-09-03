// Pure date-grid math for Calendar — no DOM, no webjsx. Builds the 6x7 cell
// matrix for a given month (leading/trailing days from adjacent months
// included so every row is full), plus small date-key/compare helpers shared
// by grid.js, calendar.js and the picker shells. All dates are normalized to
// local-midnight Date objects; `key(d)` ('YYYY-MM-DD') is the identity used
// for selection/range membership comparisons instead of Date reference
// equality (which two independently-constructed Dates never satisfy).

export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function startOfDay(d) {
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    return n;
}

export function key(d) {
    if (!d) return null;
    const n = startOfDay(d);
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

export function sameDay(a, b) {
    return !!a && !!b && key(a) === key(b);
}

export function addMonths(monthDate, delta) {
    const n = new Date(monthDate);
    n.setDate(1);
    n.setMonth(n.getMonth() + delta);
    return n;
}

export function addDays(d, delta) {
    const n = startOfDay(d);
    n.setDate(n.getDate() + delta);
    return n;
}

export function isBefore(a, b) {
    return startOfDay(a).getTime() < startOfDay(b).getTime();
}

export function isAfter(a, b) {
    return startOfDay(a).getTime() > startOfDay(b).getTime();
}

export function isDisabled(d, minDate, maxDate) {
    if (minDate && isBefore(d, minDate)) return true;
    if (maxDate && isAfter(d, maxDate)) return true;
    return false;
}

// Build the 42-cell (6 week rows x 7) matrix for `monthDate`'s month. Each
// cell: { date, inMonth }. Always 6 rows so the grid height never reflows
// between months (a 4-row Feb next to a 6-row Oct would otherwise jump the
// popover/page height under it).
export function buildMonthGrid(monthDate) {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = first.getDay(); // 0=Sun
    const gridStart = addDays(first, -startOffset);
    const cells = [];
    for (let i = 0; i < 42; i++) {
        const date = addDays(gridStart, i);
        cells.push({ date, inMonth: date.getMonth() === monthDate.getMonth() });
    }
    return cells;
}

export function monthLabel(monthDate, locale) {
    try { return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(monthDate); }
    catch { return monthDate.toDateString(); }
}

export function formatDate(d, locale) {
    if (!d) return '';
    try { return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d); }
    catch { return startOfDay(d).toDateString(); }
}
