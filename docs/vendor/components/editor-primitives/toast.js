// ---------------------------------------------------------------------------
// Toast — Toast({message,kind,duration}) component + imperative toast(opts).
// ---------------------------------------------------------------------------

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

export function Toast({ message, kind = 'info', duration = 3000, onClose } = {}) {
    return h('div', {
        class: 'ds-ep-toast kind-' + kind,
        role: 'status',
        'aria-live': 'polite',
        ref: (el) => {
            if (!el || el._dsToast) return;
            el._dsToast = true;
            if (duration > 0) setTimeout(() => { onClose && onClose(); el.classList.add('leaving'); }, duration);
        }
    }, message);
}

let _toastHostEl = null;
function ensureToastHost() {
    if (typeof document === 'undefined') return null;
    if (_toastHostEl && document.body.contains(_toastHostEl)) return _toastHostEl;
    _toastHostEl = document.createElement('div');
    _toastHostEl.className = 'ds-ep-toast-host';
    document.body.appendChild(_toastHostEl);
    return _toastHostEl;
}

export function toast({ message, kind = 'info', duration = 3000, actionLabel, onAction } = {}) {
    const host = ensureToastHost();
    if (!host) return () => {};
    const el = document.createElement('div');
    el.className = 'ds-ep-toast kind-' + kind;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'ds-ep-toast-msg';
    text.textContent = message;
    el.appendChild(text);
    const dismiss = () => {
        if (!el.parentNode) return;
        el.classList.add('leaving');
        setTimeout(() => { el.parentNode && el.parentNode.removeChild(el); }, 200);
    };
    if (actionLabel && onAction) {
        el.classList.add('has-action');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ds-ep-toast-action';
        btn.textContent = actionLabel;
        btn.onclick = () => onAction(dismiss);
        el.appendChild(btn);
    }
    host.appendChild(el);
    if (duration > 0) setTimeout(dismiss, duration);
    return dismiss;
}
