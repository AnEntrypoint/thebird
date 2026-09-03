// Form controls — the standalone field primitives (SearchInput, TextField,
// Select) and the declarative `Form` builder that lays out a fields[] spec.
// Every control carries a real accessible name; SearchInput additionally
// owns the single shared clear path (Escape key and visible X button).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

export function SearchInput({ value = '', placeholder = 'search…', onInput, onSubmit, name = 'q', key, label, resultCount }) {
    // Shared clear path — both the Escape key and the visible clear button
    // call this, so there is exactly one place that clears the field.
    const doClear = (e) => { if (onInput) onInput('', e); };
    const input = h('input', {
        key: 'i',
        type: 'search',
        name,
        class: 'ds-search-input',
        placeholder,
        'aria-label': label || placeholder,
        value,
        oninput: onInput ? (e) => onInput(e.target.value, e) : null,
        onkeydown: (e) => {
            // Escape clears the field in place (stays focused) rather than
            // falling through to whatever ancestor Escape handler exists.
            if (e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); doClear(e); return; }
            // IME guard: the Enter that commits a CJK composition must not submit.
            if (onSubmit && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) onSubmit(e.target.value, e);
        }
    });
    // Visible clear (X) button — mouse/touch users have no way to discover the
    // Escape-to-clear shortcut, so this surfaces the same clear path visibly.
    // Only rendered when there's something to clear.
    const clearBtn = value
        ? h('button', {
            key: 'clr', type: 'button', class: 'ds-search-clear',
            'aria-label': 'clear search',
            onclick: doClear,
        }, Icon('x'))
        : null;
    // Always return the same wrapping shape regardless of whether resultCount/
    // clearBtn are present this render - a conditional bare-input-vs-wrapped-
    // span return here previously changed SearchInput's VElement type at the
    // SAME keyed slot from render to render (e.g. typing into an empty filter
    // makes resultCount go from undefined to a string), and webjsx's applyDiff
    // has no way to morph one element type into another in place - it produced
    // a corrupted merged DOM node carrying attributes from both shapes.
    return h('span', { key, class: 'ds-search-input-wrap' },
        h('span', { key: 'fld', class: 'ds-search-field' },
            h('span', { key: 'ic', class: 'ds-search-icon', 'aria-hidden': 'true' }, Icon('search', { size: 15 })),
            input),
        clearBtn,
        resultCount != null ? h('span', { key: 'cnt', class: 'sr-only', role: 'status', 'aria-live': 'polite' }, resultCount) : null);
}

export function TextField({ label, value = '', type = 'text', placeholder = '', onInput, onChange, name, key, hint, multiline, rows = 4, maxLength, min, max, error, title, size = 'md', 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy }) {
    // size: 'sm' | 'md' | 'lg' — md is the base .ds-field control; sm/lg add a
    // wrapper modifier that snaps the control height/padding/font to --ctl-*.
    const sizeCls = size === 'sm' ? ' ds-field--sm' : (size === 'lg' ? ' ds-field--lg' : '');
    const errorId = error != null ? ((key ? key : 'tf') + '-err') : null;
    const describedBy = ariaDescribedBy || errorId || null;
    const input = multiline
        ? h('textarea', {
            key: 'i', name, rows, placeholder, value,
            maxlength: maxLength != null ? maxLength : null,
            'aria-label': ariaLabel || null,
            'aria-invalid': error != null ? 'true' : (ariaInvalid || null),
            'aria-describedby': describedBy,
            title: title || null,
            oninput: onInput ? (e) => onInput(e.target.value, e) : null,
            onchange: onChange ? (e) => onChange(e.target.value, e) : null
        })
        : h('input', {
            key: 'i', type, name, placeholder, value,
            maxlength: maxLength != null ? maxLength : null,
            min: min != null ? String(min) : null,
            max: max != null ? String(max) : null,
            'aria-label': ariaLabel || null,
            'aria-invalid': error != null ? 'true' : (ariaInvalid || null),
            'aria-describedby': describedBy,
            title: title || null,
            oninput: onInput ? (e) => onInput(e.target.value, e) : null,
            onchange: onChange ? (e) => onChange(e.target.value, e) : null
        });
    return h('label', { key, class: 'ds-field' + sizeCls },
        ...[
            label != null ? h('span', { key: 'l', class: 'ds-field-label' }, label) : null,
            input,
            error != null ? h('span', { key: 'e', id: errorId, class: 'ds-field-error', role: 'alert', 'aria-live': 'polite', 'aria-atomic': 'true' }, error) : null,
            maxLength != null ? h('span', { key: 'c', class: 'ds-field-count' }, String(value.length) + '/' + maxLength) : null,
            hint != null ? h('span', { key: 'h', class: 'ds-field-hint' }, hint) : null
        ].filter(Boolean)
    );
}

export function Select({ label, value = '', options = [], onChange, name, key, placeholder, hint, title, size = 'md', 'aria-label': ariaLabel }) {
    const sizeCls = size === 'sm' ? ' ds-field--sm' : (size === 'lg' ? ' ds-field--lg' : '');
    const opts = [];
    if (placeholder != null) opts.push(h('option', { key: '_ph', value: '', disabled: true, selected: value === '' || value == null }, placeholder));
    for (const o of options) {
        const id = typeof o === 'string' ? o : (o.value != null ? o.value : o.id);
        const lab = typeof o === 'string' ? o : (o.label != null ? o.label : (o.id || o.value));
        opts.push(h('option', { key: 'o-' + id, value: id, selected: id === value }, lab));
    }
    // When this select is returned bare (the no-label/no-hint/md branch below),
    // it is the node the caller keys, so it must carry the caller's key. The
    // internal 'i' only has to be unique among THIS component's own children,
    // which is why the wrapped branches can keep it. Previously 'i' was
    // hardcoded here and the bare branch dropped `key` on the floor, so two
    // sibling label-less Selects both keyed as 'i' and webjsx's keyed diff
    // collapsed them into one on the next re-render.
    const bare = label == null && hint == null && size === 'md';
    const select = h('select', {
        key: bare && key != null ? key : 'i', name, class: 'ds-select',
        // Guarantee an accessible name even when rendered without a visible label.
        'aria-label': ariaLabel || (label == null ? (title || placeholder || name) : null),
        title,
        onchange: onChange ? (e) => onChange(e.target.value, e) : null
    }, ...opts);
    if (bare) return select;
    if (label == null && hint == null) return h('label', { key, class: 'ds-field' + sizeCls }, select);
    return h('label', { key, class: 'ds-field' + sizeCls },
        label != null ? h('span', { key: 'l', class: 'ds-field-label' }, label) : null,
        select,
        hint != null ? h('span', { key: 'h', class: 'ds-field-hint' }, hint) : null
    );
}

export function Form({ fields = [], submit = 'submit', onSubmit, columns = 1 }) {
    const cols = columns > 1 ? String(columns) : null;
    return h('form', { class: 'row-form', 'data-columns': cols, onsubmit: (ev) => { ev.preventDefault(); onSubmit && onSubmit(ev); } },
        ...fields.map((f, i) => {
            // Each control gets a stable id and an associated <label> so the
            // placeholder is no longer the only (inaccessible) name. The label
            // text falls back to label -> placeholder -> name.
            const fieldId = 'ds-form-' + (f.name || 'field') + '-' + i;
            const labelText = f.label != null ? f.label : (f.placeholder || f.name || '');
            const control = f.kind === 'textarea'
                ? h('textarea', { key: 'i', id: fieldId, name: f.name, placeholder: f.placeholder || '', rows: f.rows || 4, required: f.required ? true : null })
                : h('input', { key: 'i', id: fieldId, name: f.name, type: f.type || 'text', placeholder: f.placeholder || '', value: f.value || '', required: f.required ? true : null });
            return h('label', { key: i, class: 'ds-field', for: fieldId },
                labelText !== '' ? h('span', { key: 'l', class: 'ds-field-label' }, labelText) : null,
                control);
        }),
        h('button', { type: 'submit', class: 'btn-primary' }, submit));
}
