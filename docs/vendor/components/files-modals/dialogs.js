// The three question dialogs, all composed on the shared Modal shell so they
// inherit its focus trap and Escape/backdrop dismiss: ConfirmDialog (yes/no,
// optionally destructive), PromptDialog (single text input with optional root
// chips), and CountdownDialog (ticking auto-expire).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Btn } from '../shell.js';
import { Modal, modalError } from './modal-shell.js';
const h = webjsx.createElement;

// `error` renders inside .ds-modal-body (role=alert, error tone). `busy`
// disables both action buttons AND the Escape/backdrop close paths; the confirm
// label flips to `busyLabel` (default 'working…') so the in-flight state reads.
export function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'confirm', cancelLabel = 'cancel', destructive, onConfirm, onCancel, error, busy = false, busyLabel = 'working…' } = {}) {
    return Modal({
        onClose: onCancel,
        kind: 'small',
        busy,
        head: title,
        body: [message || '', modalError(error)].filter(Boolean),
        actions: [
            Btn({ onClick: onCancel, disabled: busy, children: cancelLabel }),
            Btn({ variant: destructive ? 'danger' : 'primary', disabled: busy, onClick: onConfirm, children: busy ? busyLabel : confirmLabel })
        ]
    });
}

// Built-in filename validator (used unless a caller supplies its own via
// `validate`): rejects empty/whitespace-only, path separators (would let a
// rename/save silently escape into a different directory or create a nested
// path), and the semantically-invalid '.'/'..' segments. Returns an error
// string, or null when the value is acceptable.
export function defaultPromptValidate(v) {
    const s = (v == null ? '' : String(v)).trim();
    if (!s) return 'name cannot be empty';
    if (s === '.' || s === '..') return `"${s}" is not a valid name`;
    if (/[\/\\]/.test(s)) return 'name cannot contain / or \\';
    return null;
}

export function PromptDialog({ title = 'Enter a name', value = '', placeholder = '', confirmLabel = 'ok', cancelLabel = 'cancel', onConfirm, onCancel, onInput, error, busy = false, busyLabel = 'working…', roots, onPickRoot, validate = defaultPromptValidate } = {}) {
    // Optional one-click starting-point chips (e.g. a destination-path prompt
    // for a filesystem with more than one allowed root) - a user typing a
    // path has no way to discover what a second disjoint root even looks
    // like otherwise. Each { path, label } fills the input via the same
    // onInput callback a manual keystroke would.
    // Paints a validation-failure message into the existing modalError node
    // (rendered unconditionally below so it's always present to update, even
    // when the caller passed no `error`) without requiring a re-render from
    // the caller — this component holds no reactive state of its own.
    const showLocalError = (rootEl, msg) => {
        const modalEl = rootEl && rootEl.closest ? rootEl.closest('.ds-modal') : null;
        const errEl = modalEl && modalEl.querySelector('.ds-modal-error');
        if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
        const inputEl = modalEl && modalEl.querySelector('.ds-modal-input');
        if (inputEl) inputEl.setAttribute('aria-invalid', 'true');
    };
    const rootsRow = (roots && roots.length)
        ? h('div', { class: 'ds-prompt-roots', role: 'group', 'aria-label': 'accessible folders' },
            ...roots.map((r, i) => h('button', {
                key: 'pr' + i, type: 'button', class: 'ds-prompt-root-chip',
                onclick: () => { const p = r.path || r; if (onPickRoot) onPickRoot(p); else if (onInput) onInput(p); },
            }, r.label || r.path || r)))
        : null;
    // Synchronous re-entrancy guard: the caller's `busy` prop only disables
    // the DOM on the NEXT render, which is async relative to the event that
    // triggered it. Enter-keydown and the confirm button's onClick each call
    // onConfirm independently, so a fast Enter-then-click (or Enter-Enter
    // double-fire before re-render) can invoke onConfirm twice with the same
    // value before `busy` ever reaches the DOM. `fired` is closure-scoped to
    // this PromptDialog() call and is set synchronously on first fire, so it
    // blocks the second call within the same render regardless of `busy`.
    let fired = false;
    const guardedConfirm = (val, rootEl) => {
        if (fired || busy) return;
        const msg = validate ? validate(val) : null;
        if (msg) { showLocalError(rootEl, msg); return; }
        fired = true;
        onConfirm && onConfirm(val);
    };
    return Modal({
        onClose: onCancel,
        kind: 'small',
        busy,
        head: title,
        body: [h('input', {
            class: 'input ds-modal-input',
            type: 'text',
            value,
            placeholder,
            autofocus: true,
            disabled: busy ? true : null,
            'aria-invalid': error ? 'true' : null,
            oninput: (e) => {
                // Clear a stale local validation message on the next keystroke
                // so it never masks a fresh, now-valid attempt.
                const modalEl = e.target.closest('.ds-modal');
                const errEl = modalEl && modalEl.querySelector('.ds-modal-error');
                if (errEl && !error) { errEl.hidden = true; errEl.textContent = ''; }
                onInput && onInput(e.target.value);
            },
            onkeydown: (e) => {
                // IME guard: the Enter that commits a CJK composition must not confirm.
                if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); guardedConfirm(e.target.value, e.target); }
                if (e.key === 'Escape') { e.preventDefault(); if (!busy) onCancel && onCancel(); }
            }
        }), rootsRow,
            // Always render the error node (even with no message yet) so the
            // synchronous DOM-poke path in guardedConfirm/showLocalError has a
            // stable target to fill in without needing a re-render from the
            // caller — PromptDialog holds no reactive state of its own.
            h('p', { class: 'ds-modal-error', role: 'alert', hidden: error ? null : true }, error ? String(error) : '')
        ].filter(Boolean),
        actions: [
            Btn({ onClick: onCancel, disabled: busy, children: cancelLabel }),
            Btn({
                primary: true,
                disabled: busy,
                // Read the live input value, not the closed-over `value` prop:
                // consumers update their state in oninput without re-rendering
                // (to avoid caret jump), so the prop is stale at click time.
                onClick: (e) => {
                    if (!onConfirm) return;
                    const inp = e.currentTarget.closest('.ds-modal')?.querySelector('.ds-modal-input');
                    guardedConfirm(inp ? inp.value : value, e.currentTarget);
                },
                children: busy ? busyLabel : confirmLabel
            })
        ]
    });
}

// CountdownDialog — a modal with a role=status line ticking down from
// `seconds` to 0 once per second, auto-firing onExpire at zero. Composes on
// top of the same Modal() shell ConfirmDialog/PromptDialog use, so it
// inherits Backdrop's focus-trap + Escape/backdrop-dismiss handling for free
// rather than reimplementing dialog plumbing.
export function CountdownDialog({ title = 'Are you sure?', message, seconds = 10, onExpire, actions } = {}) {
    const startSeconds = Math.max(0, Math.floor(seconds));
    return Modal({
        onClose: undefined, // no implicit dismiss path unless the caller supplies one via `actions`
        kind: 'small',
        head: title,
        body: [
            message || '',
            h('p', {
                class: 'ds-countdown-status', role: 'status', 'aria-live': 'polite',
                ref: (el) => {
                    if (!el || el._dsCountdownTimer) return;
                    let remaining = startSeconds;
                    const render = () => { el.textContent = remaining + (remaining === 1 ? ' second' : ' seconds') + ' remaining'; };
                    render();
                    el._dsCountdownTimer = setInterval(() => {
                        remaining -= 1;
                        if (remaining <= 0) {
                            clearInterval(el._dsCountdownTimer);
                            el._dsCountdownTimer = null;
                            remaining = 0;
                            render();
                            if (onExpire) onExpire();
                            return;
                        }
                        render();
                    }, 1000);
                },
            }),
            modalError(null),
        ].filter(Boolean),
        actions: actions || [],
    });
}
