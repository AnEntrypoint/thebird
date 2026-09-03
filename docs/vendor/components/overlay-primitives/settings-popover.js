// SettingsPopover — fixed popover with generic section/row control rendering.
// Rows are data-driven: `kind` picks the control (select/toggle/range/button,
// or a non-interactive value row), and every interactive control gets a
// stable id so the visible row label is its accessible name.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { trapTab, _anchoredOverlayLifecycle } from './floating.js';
const h = webjsx.createElement;

export function SettingsPopover({ title = 'Settings', open, anchorX = 0, anchorY = 0, sections = [], onClose } = {}) {
    if (!open) return null;
    let rootEl = null;
    const close = () => onClose && onClose();
    const secs = Array.isArray(sections) ? sections : [];

    const renderRow = (row, i) => {
        const label = row.label != null ? row.label : (row.title != null ? row.title : '');
        const kind = row.kind;
        // Give every interactive control a stable id and point the row label's
        // `for` at it, so the visible label is the control's accessible name.
        const ctrlId = 'ov-set-' + i + '-' + kind;
        const labelNode = h('label', { class: 'ov-set-row-label', for: ctrlId }, String(label));
        let control = null;
        if (kind === 'select') {
            const opts = Array.isArray(row.options) ? row.options : [];
            // Controlled via the `value` prop only — per-option `selected` is
            // dropped so the two don't fight (value wins).
            control = h('select', {
                id: ctrlId,
                class: 'ov-set-control', value: row.value != null ? String(row.value) : undefined,
                onchange: (e) => row.onChange && row.onChange(e.target.value),
            }, ...opts.map(o => {
                const v = (o && typeof o === 'object') ? o.value : o;
                const l = (o && typeof o === 'object') ? (o.label != null ? o.label : o.value) : o;
                return h('option', { value: String(v) }, String(l));
            }));
        } else if (kind === 'toggle') {
            control = h('input', {
                id: ctrlId,
                type: 'checkbox', class: 'ov-set-toggle',
                checked: row.value ? 'checked' : undefined,
                onchange: (e) => row.onChange && row.onChange(e.target.checked),
            });
        } else if (kind === 'range') {
            control = h('input', {
                id: ctrlId,
                type: 'range', class: 'ov-set-control',
                min: String(row.min != null ? row.min : 0),
                max: String(row.max != null ? row.max : 100),
                step: String(row.step != null ? row.step : 1),
                value: String(row.value != null ? row.value : 0),
                oninput: (e) => row.onChange && row.onChange(Number(e.target.value)),
            });
        } else if (kind === 'button') {
            control = h('button', { type: 'button', class: 'ov-set-btn',
                onclick: () => row.onClick && row.onClick() }, String(label || 'Action'));
            return h('div', { class: 'ov-set-row', key: i }, control);
        } else {
            control = h('span', { class: 'ov-set-row-value' }, String(row.value != null ? row.value : ''));
            // Non-interactive value row: a plain span label (no `for` target).
            return h('div', { class: 'ov-set-row', key: i }, h('span', { class: 'ov-set-row-label' }, String(label)), control);
        }
        return h('div', { class: 'ov-set-row', key: i }, labelNode, control);
    };

    return h('div', {
        class: 'ov-set-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': String(title), tabindex: '-1',
        onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); return; } if (rootEl) trapTab(rootEl, e); },
        ref: (el) => {
            if (!el) { if (rootEl && rootEl._ovSetCleanup) rootEl._ovSetCleanup(); return; }
            if (el._ovSet) return; el._ovSet = true; rootEl = el;
            el._ovSetCleanup = _anchoredOverlayLifecycle(el, { anchorX, anchorY, fallbackW: 280, fallbackH: 200, close });
        },
    },
        h('div', { class: 'ov-set-head' }, String(title)),
        h('div', { class: 'ov-set-body' },
            ...secs.map((sec, si) => {
                const slabel = sec.label != null ? sec.label : (sec.title != null ? sec.title : '');
                const rows = Array.isArray(sec.rows) ? sec.rows : (Array.isArray(sec.items) ? sec.items : []);
                return h('div', { class: 'ov-set-section', key: si },
                    slabel ? h('div', { class: 'ov-set-section-head' }, String(slabel)) : null,
                    ...rows.map((r, ri) => renderRow(r, ri)));
            }))
    );
}
