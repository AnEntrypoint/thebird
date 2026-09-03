// DatePicker / DateRangePicker — trigger button + Popover-hosted Calendar.
// Fully controlled, matching Dialog/Drawer/Popover's shape exactly: the
// CALLER owns `open`/`onOpenChange` and `month`/`onMonthChange` as real props
// (no internal open-state toggle). The one DOM-timing wrinkle: Popover needs
// the trigger's live DOM node as `anchorEl` at the moment `open` flips true,
// but that node is a same-render sibling, so a `ref` callback captured during
// THIS render is too late (Popover is constructed synchronously, before
// webjsx attaches anything to the DOM). chat/composer.js's EmojiPicker
// trigger hits the same problem and solves it the same way: look the trigger
// up via `document.querySelector` (already mounted from the prior closed-
// state render) rather than a same-pass ref value. `name` gives the query a
// stable per-instance scope so two pickers on one page don't collide.
import * as webjsx from '../../../vendor/webjsx/index.js';
import { Popover } from '../overlay-primitives/popover.js';
import { Icon } from '../shell.js';
import { getLocale } from '../../i18n.js';
import { Calendar } from './calendar.js';
import { formatDate } from './grid.js';
const h = webjsx.createElement;

function findAnchor(name) {
    return typeof document !== 'undefined' ? document.querySelector('.ds-dp-trigger[data-dp-name="' + name + '"]') : null;
}

/**
 * Trigger button that opens a Popover hosting a single-mode Calendar.
 *
 * @param {Object} props
 * @param {Date} [props.value] - the selected date.
 * @param {Function} [props.onChange] - `onChange(date)`, fired on day select.
 * @param {boolean} [props.open] - popover open state, owned by the caller.
 * @param {Function} [props.onOpenChange] - `onOpenChange(nextOpen)`, fired by the trigger click and on close (Escape/outside-click/selection).
 * @param {Date} [props.month] - displayed month; defaults to `value` or today when omitted.
 * @param {Function} [props.onMonthChange] - `onMonthChange(newMonthDate)`, fired by the prev/next nav.
 * @param {string} [props.placeholder='Select date'] - trigger label when `value` is unset.
 * @param {Date} [props.minDate]
 * @param {Date} [props.maxDate]
 * @param {string} [props.name='dp'] - stable id distinguishing multiple pickers' anchor lookup; set explicitly when rendering more than one DatePicker on a page.
 * @param {string} [props.locale]
 * @returns {*} webjsx vnode
 */
export function DatePicker({ value, onChange, open = false, onOpenChange, month, onMonthChange, placeholder = 'Select date', minDate, maxDate, name = 'dp', locale = getLocale() } = {}) {
    const close = () => onOpenChange && onOpenChange(false);
    const displayedMonth = month || value || new Date();
    const label = value ? formatDate(value, locale) : placeholder;
    const trigger = h('button', {
        type: 'button', class: 'ds-dp-trigger', 'data-dp-name': name,
        'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
        onclick: () => onOpenChange && onOpenChange(!open),
    }, Icon('page', { size: 15 }), h('span', { class: 'ds-dp-trigger-label' }, label));
    const popover = Popover({
        open, anchorEl: open ? findAnchor(name) : null, onClose: close,
        ariaLabel: 'choose date',
        children: Calendar({
            mode: 'single',
            selected: value,
            month: displayedMonth,
            onMonthChange: (m) => onMonthChange && onMonthChange(m),
            onSelect: (d) => { onChange && onChange(d); close(); },
            minDate, maxDate, locale,
        }),
    });
    return h('span', { class: 'ds-dp' }, trigger, popover);
}

/**
 * Trigger button that opens a Popover hosting a range-mode Calendar.
 *
 * @param {Object} props
 * @param {{from:?Date,to:?Date}} [props.value]
 * @param {Function} [props.onChange] - `onChange({from,to})`, fired on each click.
 * @param {boolean} [props.open] - popover open state, owned by the caller.
 * @param {Function} [props.onOpenChange] - `onOpenChange(nextOpen)`; also fired with `false` once both ends of the range are picked.
 * @param {Date} [props.month]
 * @param {Function} [props.onMonthChange]
 * @param {string} [props.placeholder='Select dates']
 * @param {Date} [props.minDate]
 * @param {Date} [props.maxDate]
 * @param {string} [props.name='drp'] - stable id distinguishing multiple pickers' anchor lookup.
 * @param {string} [props.locale]
 * @returns {*} webjsx vnode
 */
export function DateRangePicker({ value, onChange, open = false, onOpenChange, month, onMonthChange, placeholder = 'Select dates', minDate, maxDate, name = 'drp', locale = getLocale() } = {}) {
    const close = () => onOpenChange && onOpenChange(false);
    const from = value && value.from, to = value && value.to;
    const displayedMonth = month || from || new Date();
    const label = from ? (formatDate(from, locale) + ' – ' + (to ? formatDate(to, locale) : '…')) : placeholder;
    const trigger = h('button', {
        type: 'button', class: 'ds-dp-trigger', 'data-dp-name': name,
        'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
        onclick: () => onOpenChange && onOpenChange(!open),
    }, Icon('page', { size: 15 }), h('span', { class: 'ds-dp-trigger-label' }, label));
    const popover = Popover({
        open, anchorEl: open ? findAnchor(name) : null, onClose: close,
        ariaLabel: 'choose date range',
        children: Calendar({
            mode: 'range',
            selected: { from, to },
            month: displayedMonth,
            onMonthChange: (m) => onMonthChange && onMonthChange(m),
            onSelect: (range) => { onChange && onChange(range); if (range.from && range.to) close(); },
            minDate, maxDate, locale,
        }),
    });
    return h('span', { class: 'ds-dp ds-drp' }, trigger, popover);
}
