// Form primitives — Checkbox, Radio, RadioGroup, Toggle, Field,
// useFormValidation. Native inputs styled via CSS classes. No inline
// styles. All visuals route through form-primitives rules appended to
// editor-primitives.css. Theme-token driven; respects prefers-reduced-motion.

import * as webjsx from '../../vendor/webjsx/index.js';
const h = webjsx.createElement;

let _uid = 0;
function uid(prefix) { _uid += 1; return prefix + '-' + _uid; }

function setIndeterminate(node, flag) {
    if (node && typeof flag === 'boolean') node.indeterminate = flag;
}

export function Checkbox({ checked, indeterminate, disabled, label, hint, onChange, ariaLabel, key, name, id } = {}) {
    const inputId = id || uid('ds-check');
    const hintId = hint ? inputId + '-hint' : null;
    const input = h('input', {
        key: 'i', type: 'checkbox', id: inputId, name,
        class: 'ds-check',
        checked: checked ? true : null,
        disabled: disabled ? true : null,
        'aria-label': ariaLabel || null,
        'aria-describedby': hintId,
        ref: (node) => setIndeterminate(node, indeterminate),
        onchange: onChange ? (e) => onChange(e.target.checked, e) : null
    });
    return h('label', { key, class: 'ds-check-row', for: inputId },
        input,
        label != null ? h('span', { key: 'l', class: 'ds-check-label' }, label) : null,
        hint != null ? h('span', { key: 'h', id: hintId, class: 'ds-field-hint' }, hint) : null
    );
}

export function Radio({ name, value, checked, disabled, label, hint, onChange, ariaLabel, key, id } = {}) {
    const inputId = id || uid('ds-radio');
    const hintId = hint ? inputId + '-hint' : null;
    const input = h('input', {
        key: 'i', type: 'radio', id: inputId, name, value,
        class: 'ds-radio',
        checked: checked ? true : null,
        disabled: disabled ? true : null,
        'aria-label': ariaLabel || null,
        'aria-describedby': hintId,
        onchange: onChange ? (e) => onChange(value, e) : null
    });
    return h('label', { key, class: 'ds-radio-row', for: inputId },
        input,
        label != null ? h('span', { key: 'l', class: 'ds-radio-label' }, label) : null,
        hint != null ? h('span', { key: 'h', id: hintId, class: 'ds-field-hint' }, hint) : null
    );
}

export function RadioGroup({ legend, name, value, options = [], onChange, orientation = 'vertical', key } = {}) {
    const groupName = name || uid('ds-rg');
    const isHoriz = orientation === 'horizontal';
    const onKeyDown = (e) => {
        const nextKey = isHoriz ? 'ArrowRight' : 'ArrowDown';
        const prevKey = isHoriz ? 'ArrowLeft' : 'ArrowUp';
        if (e.key !== nextKey && e.key !== prevKey && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const idx = options.findIndex(o => (typeof o === 'string' ? o : o.value) === value);
        let next = idx;
        if (e.key === nextKey) next = (idx + 1) % options.length;
        else if (e.key === prevKey) next = (idx - 1 + options.length) % options.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = options.length - 1;
        const opt = options[next];
        const v = typeof opt === 'string' ? opt : opt.value;
        if (onChange) onChange(v, e);
        const root = e.currentTarget;
        const inputs = root.querySelectorAll('input[type="radio"]');
        if (inputs[next]) inputs[next].focus();
    };
    return h('fieldset', { key, class: 'ds-radio-group ' + (isHoriz ? 'horiz' : 'vert'), role: 'radiogroup', 'aria-orientation': isHoriz ? 'horizontal' : 'vertical', onkeydown: onKeyDown },
        legend != null ? h('legend', { key: 'lg', class: 'ds-field-label' }, legend) : null,
        ...options.map((o, i) => {
            const v = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            const dis = typeof o === 'object' && o.disabled;
            return Radio({ key: 'r' + i, name: groupName, value: v, label: lab, disabled: dis, checked: v === value, onChange });
        })
    );
}

export function Toggle({ checked, disabled, label, hint, onChange, ariaLabel, kind = 'switch', key, id } = {}) {
    const btnId = id || uid('ds-toggle');
    const hintId = hint ? btnId + '-hint' : null;
    const toggle = () => { if (!disabled && onChange) onChange(!checked); };
    const btn = h('button', {
        key: 'b', id: btnId, type: 'button', role: kind, class: 'ds-toggle',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': ariaLabel || (label == null ? 'toggle' : null),
        'aria-describedby': hintId,
        disabled: disabled ? true : null,
        onclick: toggle,
        onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }
    }, h('span', { key: 'k', class: 'ds-toggle-knob', 'aria-hidden': 'true' }));
    if (label == null && hint == null) return btn;
    return h('label', { key, class: 'ds-toggle-row', for: btnId },
        btn,
        label != null ? h('span', { key: 'l', class: 'ds-toggle-label' }, label) : null,
        hint != null ? h('span', { key: 'h', id: hintId, class: 'ds-field-hint' }, hint) : null
    );
}

function cloneWithProps(node, extra) {
    if (!node || typeof node !== 'object') return node;
    return { ...node, props: { ...(node.props || {}), ...extra } };
}

export function Field({ label, hint, error, required, requiredMarker = '*', htmlFor, children, key } = {}) {
    const autoId = htmlFor || uid('ds-field');
    const hintId = hint != null ? autoId + '-hint' : null;
    const errorId = error != null ? autoId + '-err' : null;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || null;
    const list = Array.isArray(children) ? children : [children];
    // Apply the generated id to the FIRST control that lacks one so the label's
    // `for=autoId` and the hint/error aria-describedby actually reference it.
    // Controls that already carry an id keep theirs (and still get describedby).
    let idApplied = false;
    const decorated = list.map((c) => {
        if (!c || typeof c !== 'object') return c;
        const props = c.props || {};
        const extra = { 'aria-describedby': describedBy };
        if (error != null) extra['aria-invalid'] = 'true';
        if (!props.id && !idApplied) { extra.id = autoId; idApplied = true; }
        return cloneWithProps(c, extra);
    });
    return h('div', { key, class: 'ds-field-wrap' },
        label != null ? h('label', { key: 'l', class: 'ds-field-label', for: autoId },
            label,
            required ? h('span', { key: 'r', class: 'ds-field-required', 'aria-hidden': 'true' }, ' ' + requiredMarker) : null
        ) : null,
        required ? h('span', { key: 'sr', class: 'sr-only' }, 'required') : null,
        ...decorated,
        error != null
            ? h('div', { key: 'e', id: errorId, class: 'ds-field-error', role: 'alert', 'aria-live': 'polite', 'aria-atomic': 'true' }, error)
            : (hint != null ? h('div', { key: 'h', id: hintId, class: 'ds-field-hint' }, hint) : null)
    );
}

const RULES = {
    required: (v) => (v == null || v === '' || (Array.isArray(v) && v.length === 0)) ? 'required' : null,
    email: (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ? null : 'invalid email',
    pattern: (v, r) => (v == null || v === '' || new RegExp(r.value).test(v)) ? null : (r.message || 'invalid format'),
    min: (v, r) => (v == null || Number(v) >= r.value) ? null : (r.message || `min ${r.value}`),
    max: (v, r) => (v == null || Number(v) <= r.value) ? null : (r.message || `max ${r.value}`),
    custom: (v, r) => r.fn ? r.fn(v) : null
};

export function useFormValidation(schema = {}) {
    const errors = {};
    const isPromise = (x) => x != null && typeof x.then === 'function';
    // Runs rules for one field. Returns the error string/null synchronously when
    // no rule yields a Promise; returns a Promise resolving to that value when
    // any rule (e.g. an async custom validator) does.
    const validateField = (name, value) => {
        const rules = schema[name] || [];
        const settle = (out, idx) => {
            if (out) { errors[name] = rules[idx].message || out; return errors[name]; }
            // No error from this rule — continue with the rest.
            return run(idx + 1);
        };
        const run = (i) => {
            if (i >= rules.length) { delete errors[name]; return null; }
            const r = rules[i];
            const fn = RULES[r.rule];
            if (!fn) return run(i + 1);
            const out = fn(value, r);
            if (isPromise(out)) return out.then((res) => settle(res, i));
            return settle(out, i);
        };
        return run(0);
    };
    const validate = (values = {}) => {
        const names = Object.keys(schema);
        const results = names.map((name) => validateField(name, values[name]));
        const finish = () => ({ valid: Object.keys(errors).length === 0, errors: { ...errors } });
        return results.some(isPromise) ? Promise.all(results).then(finish) : finish();
    };
    return { errors, validate, validateField };
}

// focusFirstInvalidField — after a `useFormValidation().validate()` call
// reports errors, moves keyboard focus to the first invalid field in
// `order` (schema key order, matching docstudio's requireFields, which
// validates fields in a fixed order and focuses only the first failure
// rather than dumping all errors on screen with no navigational aid).
// `getEl(name)` resolves a field name to its live DOM node (host owns the
// lookup — a ref map, `querySelector`, etc.); a name with no resolvable
// element is skipped rather than throwing. No-op if no name in `order` has
// an error.
export function focusFirstInvalidField(errors, order, getEl) {
    for (const name of order) {
        if (!errors[name]) continue;
        const el = getEl(name);
        if (el && typeof el.focus === 'function') { el.focus(); return name; }
    }
    return null;
}
