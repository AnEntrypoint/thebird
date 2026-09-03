// Modal surfaces — Drawer (slide-in from an edge) and Dialog (centered
// modal with an actions row). Both are controlled via `open`/`onClose`,
// backdrop-dismissable (Dialog opt-in via `dismissible`), Escape-closing,
// and Tab-trapped through the shared trapTabKey helper.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { kids, FOCUSABLE_SEL, trapTabKey } from './shared.js';
const h = webjsx.createElement;

// ---------------------------------------------------------------------------
// Drawer — slide-in from side. side='left'|'right'|'bottom'.
// ---------------------------------------------------------------------------
export function Drawer({ side = 'left', open = false, onClose, children, ariaLabel } = {}) {
    if (!open) return null;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose && onClose(); } };
    return h('div', {
        class: 'ds-ep-drawer-backdrop',
        onmousedown: (e) => { if (e.target === e.currentTarget) onClose && onClose(); },
    },
        h('div', {
            class: 'ds-ep-drawer side-' + side,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': ariaLabel || 'Drawer',
            tabindex: '-1',
            onkeydown: onKey,
            ref: (el) => {
                if (!el || el._dsTrap) return;
                el._dsTrap = true;
                el.addEventListener('keydown', (e) => trapTabKey(el, e));
                // setTimeout(0), not queueMicrotask — see Dialog's identical comment
                // below: the opening click's own default focus can win a same-tick race.
                setTimeout(() => {
                    const f = el.querySelector(FOCUSABLE_SEL);
                    (f || el).focus();
                }, 0);
            },
        }, ...kids(children))
    );
}

// ---------------------------------------------------------------------------
// Dialog — modal. actions = [{label, onClick, kind?}], dismissible (backdrop).
// ---------------------------------------------------------------------------
export function Dialog({ title, open = false, onClose, children, actions = [], dismissible = false, ariaLabel } = {}) {
    if (!open) return null;
    const opener = (typeof document !== 'undefined') ? document.activeElement : null;
    const close = () => {
        if (onClose) onClose();
        if (opener && opener.focus) queueMicrotask(() => opener.focus());
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    return h('div', {
        class: 'ds-ep-dialog-backdrop',
        onmousedown: (e) => { if (dismissible && e.target === e.currentTarget) close(); },
    },
        h('div', {
            class: 'ds-ep-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': ariaLabel || title || 'Dialog',
            tabindex: '-1',
            onkeydown: onKey,
            ref: (el) => {
                if (!el || el._dsTrap) return;
                el._dsTrap = true;
                el.addEventListener('keydown', (e) => trapTabKey(el, e));
                // setTimeout(0), not queueMicrotask: the triggering click's own default
                // focus-on-click can win a same-tick microtask race and leave focus on
                // the trigger button instead of the dialog, breaking Escape/Tab-trap
                // for keyboard users (keydown only bubbles from the focused element).
                setTimeout(() => {
                    const f = el.querySelector(FOCUSABLE_SEL);
                    (f || el).focus();
                }, 0);
            },
        },
            title != null ? h('div', { class: 'ds-ep-dialog-head' }, h('h2', { class: 'ds-ep-dialog-title' }, title)) : null,
            h('div', { class: 'ds-ep-dialog-body' }, ...kids(children)),
            actions && actions.length ? h('div', { class: 'ds-ep-dialog-actions' },
                ...actions.map((a, i) => h('button', {
                    key: i, type: 'button',
                    class: 'ds-ep-dialog-btn' + (a.kind ? (' kind-' + a.kind) : ''),
                    onclick: (e) => { if (a.onClick) a.onClick(e); if (a.close !== false) close(); }
                }, a.label))
            ) : null
        )
    );
}
