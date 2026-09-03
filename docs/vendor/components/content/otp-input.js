// InputOTP — segmented PIN/code-entry input. `length` real <input> boxes
// (not a single overlaid input) so each box gets a real accessible name and
// native text-cursor behavior; auto-advance-on-type, backspace-retreat, and
// paste-splits-across-boxes are wired by hand since no browser gives this
// pattern for free. First box carries autocomplete="one-time-code" so mobile
// SMS/keychain autofill still targets the group.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

let _uid = 0;
function uid(prefix) { _uid += 1; return prefix + '-' + _uid; }

/**
 * Segmented one-time-code / PIN entry.
 *
 * @param {Object} [props]
 * @param {number} [props.length=6] - number of boxes.
 * @param {string} [props.value=''] - the full code so far (controlled).
 * @param {Function} [props.onChange] - called with (nextValue:string, event) on every edit.
 * @param {Function} [props.onComplete] - called with (code:string) once all boxes are filled.
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.error]
 * @param {string} [props.label] - accessible name for the group.
 * @param {*} [props.key]
 * @returns {*} webjsx vnode
 */
export function InputOTP({ length = 6, value = '', onChange, onComplete, disabled, error, label = 'code', key } = {}) {
    const groupId = uid('ds-otp');
    const chars = value.split('').slice(0, length);
    const setValue = (next, e) => {
        const clipped = next.slice(0, length);
        if (onChange) onChange(clipped, e);
        if (clipped.length === length && onComplete) onComplete(clipped);
    };
    const focusBox = (root, idx) => {
        const boxes = root.querySelectorAll('.ds-otp-box');
        if (boxes[idx]) boxes[idx].focus();
    };
    const boxes = [];
    for (let i = 0; i < length; i++) {
        const ch = chars[i] || '';
        boxes.push(h('input', {
            key: 'b' + i,
            type: 'text',
            inputmode: 'numeric',
            autocomplete: i === 0 ? 'one-time-code' : 'off',
            class: 'ds-otp-box' + (ch ? ' ds-otp-box-filled' : '') + (error ? ' ds-otp-box-error' : ''),
            maxlength: '1',
            value: ch,
            disabled: disabled ? true : null,
            'aria-label': label + ' digit ' + (i + 1) + ' of ' + length,
            'aria-invalid': error ? 'true' : null,
            oninput: (e) => {
                const raw = e.target.value.replace(/\s/g, '');
                const c = raw.slice(-1);
                const arr = chars.slice();
                arr[i] = c;
                setValue(arr.join('').slice(0, length), e);
                if (c && i < length - 1) focusBox(e.currentTarget.closest('.ds-otp'), i + 1);
            },
            onkeydown: (e) => {
                if (e.key === 'Backspace' && !e.currentTarget.value && i > 0) {
                    e.preventDefault();
                    const arr = chars.slice();
                    arr[i - 1] = '';
                    setValue(arr.join(''), e);
                    focusBox(e.currentTarget.closest('.ds-otp'), i - 1);
                } else if (e.key === 'ArrowLeft' && i > 0) {
                    e.preventDefault();
                    focusBox(e.currentTarget.closest('.ds-otp'), i - 1);
                } else if (e.key === 'ArrowRight' && i < length - 1) {
                    e.preventDefault();
                    focusBox(e.currentTarget.closest('.ds-otp'), i + 1);
                }
            },
            onpaste: (e) => {
                e.preventDefault();
                const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s/g, '');
                if (!text) return;
                setValue(text.slice(0, length), e);
                const root = e.currentTarget.closest('.ds-otp');
                const landAt = Math.min(text.length, length) - 1;
                if (landAt >= 0) focusBox(root, landAt);
            }
        }));
    }
    return h('div', { key, id: groupId, class: 'ds-otp', role: 'group', 'aria-label': label },
        ...boxes
    );
}
