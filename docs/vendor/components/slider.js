// Slider — generic single-value range-input wrapper. Styling approach is
// extracted from voice/capture.js's VadMeter (the original purpose-built
// range-input precedent): a real <input type="range"> is layered invisible
// (opacity:0, position:absolute, inset:0) directly over a custom track/fill
// so the notoriously inconsistent native thumb/track chrome never renders,
// while keyboard/pointer/a11y semantics stay on the real input.

import * as webjsx from '../../vendor/webjsx/index.js';
const h = webjsx.createElement;

let _uid = 0;
function uid(prefix) { _uid += 1; return prefix + '-' + _uid; }

/**
 * A single-value range slider (track + fill + thumb) built on a real,
 * invisible native `<input type="range">` for keyboard/pointer/a11y
 * semantics, matching the overlay approach voice/capture.js's VadMeter
 * pioneered for its threshold handle.
 *
 * @param {Object} [props]
 * @param {number} [props.value=0]
 * @param {number} [props.min=0]
 * @param {number} [props.max=100]
 * @param {number} [props.step=1]
 * @param {Function} [props.onChange] - called with (value:number, event) on input.
 * @param {string} [props.label] - accessible name; also rendered visibly when given.
 * @param {boolean} [props.disabled]
 * @param {string} [props.hint]
 * @param {*} [props.key]
 * @returns {*} webjsx vnode
 */
export function Slider({ value = 0, min = 0, max = 100, step = 1, onChange, label, disabled, hint, key } = {}) {
    const lo = Number(min);
    const hi = Number(max);
    const v = Math.max(lo, Math.min(hi, Number(value) || 0));
    const pct = hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0;
    const inputId = uid('ds-slider');
    const hintId = hint != null ? inputId + '-hint' : null;
    const range = h('input', {
        key: 'i',
        id: inputId,
        type: 'range',
        class: 'ds-slider-range',
        min: String(lo), max: String(hi), step: String(step),
        value: String(v),
        disabled: disabled ? true : null,
        'aria-label': label || null,
        'aria-describedby': hintId,
        oninput: onChange ? (e) => onChange(parseFloat(e.target.value), e) : null
    });
    // Position is written as a custom-property (--ds-slider-pct), not a raw
    // width:/left: layout string, so this stays a whitelisted dynamic
    // non-layout style per lint-inline-styles.mjs — the % math itself lives
    // in slider.css via calc(var(--ds-slider-pct) * 1%).
    const pctVar = '--ds-slider-pct:' + pct.toFixed(2);
    const track = h('div', { key: 't', class: 'ds-slider-track', style: pctVar },
        h('div', { key: 'f', class: 'ds-slider-fill' }),
        h('div', { key: 'th', class: 'ds-slider-thumb', 'aria-hidden': 'true' }),
        range
    );
    return h('div', { key, class: 'ds-slider' + (disabled ? ' is-disabled' : '') },
        label != null ? h('label', { key: 'l', class: 'ds-field-label', for: inputId }, label) : null,
        track,
        hint != null ? h('span', { key: 'h', id: hintId, class: 'ds-field-hint' }, hint) : null
    );
}
