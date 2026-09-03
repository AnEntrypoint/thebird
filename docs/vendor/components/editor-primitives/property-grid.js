// Property grid — the EDITABLE property-inspector family: PropertyGrid
// container, PropertyField (label + control + hint), PropertyGridRow (a
// divider-separated row wrapper) and InlineEditableField (borderless-until-
// focus text/textarea input with an explicit error state). Read-only debug
// readouts live in ./diagnostics.js instead.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { kids } from './shared.js';
const h = webjsx.createElement;

export function PropertyGrid({ children } = {}) {
    return h('div', { class: 'ds-ep-propgrid', role: 'group' }, ...kids(children));
}

export function PropertyField({ label, hint, inline = false, children } = {}) {
    return h('label', { class: 'ds-ep-propfield' + (inline ? ' inline' : '') },
        h('span', { class: 'ds-ep-propfield-label' }, label),
        h('span', { class: 'ds-ep-propfield-value' }, ...kids(children)),
        hint != null ? h('span', { class: 'ds-ep-propfield-hint' }, hint) : null
    );
}

// ---------------------------------------------------------------------------
// PropertyGridRow — a PropertyGrid row wrapper with a bottom-border divider
// (last-child border suppressed), for editors that need a stronger per-row
// visual separation than the default PropertyGrid gap gives (e.g. a list of
// independently-editable records like PRD/mutable rows). Generalizes
// gmsniff's gm-propgrid-row.
// ---------------------------------------------------------------------------
export function PropertyGridRow({ children, key } = {}) {
    return h('div', { key, class: 'ds-ep-propgrid-row' }, ...kids(children));
}

// ---------------------------------------------------------------------------
// InlineEditableField — a borderless-until-focus text input that inherits
// surrounding font (no boxed input chrome), with an explicit error state
// (aria-invalid + danger-token border) for live per-field validation.
// Generalizes gmsniff's gm-inline-input / gm-field-error pair. Renders a
// <textarea> when multiline is set (for longer free-text edits), else a
// single-line <input>.
// ---------------------------------------------------------------------------
export function InlineEditableField({ value = '', placeholder, onInput, onChange, error, multiline = false, rows = 3, ariaLabel, disabled = false } = {}) {
    const cls = 'ds-ep-inline-input' + (error ? ' has-error' : '');
    const common = {
        class: cls,
        value,
        placeholder,
        disabled: disabled ? 'disabled' : null,
        'aria-label': ariaLabel,
        'aria-invalid': error ? 'true' : null,
        oninput: onInput ? (e) => onInput(e.target.value, e) : null,
        onchange: onChange ? (e) => onChange(e.target.value, e) : null,
    };
    return multiline
        ? h('textarea', { ...common, rows })
        : h('input', { ...common, type: 'text' });
}
