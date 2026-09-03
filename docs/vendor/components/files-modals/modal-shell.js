// The shared modal shell every file dialog funnels through: Backdrop (focus
// trap, document-level Escape, invoker focus restore, backdrop dismiss),
// Modal (head/body/actions slots + a stable aria-labelledby id), and the
// in-body error line.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { shortUid } from '../../uid.js';
const h = webjsx.createElement;

// Full focusable set for the modal Tab trap — omitting textarea/select/a[href]
// lets Tab escape behind the fixed backdrop (fully obscured at mobile sizes).
const FOCUSABLE_SEL = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function Backdrop({ onClose, children, kind = '', labelledBy, busy = false } = {}) {
    // Per-Backdrop-instance state (invoker/last-el/pending-removal flag) is
    // captured in this closure, not on the shared Backdrop function — so two
    // modals mounting concurrently (e.g. two thebird windows/instances each
    // opening a file dialog) never stomp each other's focus-restore bookkeeping.
    const state = { invoker: null, last: null, pendingRemoval: false };
    // webjsx invokes a ref callback with the element on mount and with null on
    // unmount. We stash the per-element keydown teardown on the node itself so
    // the null branch can run it — otherwise the document/element listener leaks
    // once the modal is removed.
    const backdropRef = (el) => {
        if (!el) return;            // unmount (ref(null)) handled by wrapper below
        const modal = el.querySelector('.ds-modal');
        if (!modal) return;

        const handleKeydown = (e) => {
            // Escape closes the modal — unless a mutation is in flight (the live
            // busy state is read off the data-busy attribute, which re-renders;
            // this handler's closure is bound once at mount).
            if (e.key === 'Escape') {
                e.preventDefault();
                if (el.dataset.busy === '1') return;
                if (onClose) onClose();
                return;
            }
            // Focus trap: re-query focusables on each Tab press so that buttons
            // disabled mid-flight (busy state) are excluded from the cycle and
            // do not break tab navigation.
            if (e.key === 'Tab') {
                const focusables = modal.querySelectorAll(FOCUSABLE_SEL);
                if (focusables.length === 0) {
                    e.preventDefault();
                    return;
                }
                const firstFocusable = focusables[0];
                const lastFocusable = focusables[focusables.length - 1];
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusable) {
                        e.preventDefault();
                        lastFocusable.focus();
                    }
                } else {
                    if (document.activeElement === lastFocusable) {
                        e.preventDefault();
                        firstFocusable.focus();
                    }
                }
            }
        };

        // Escape must close the modal no matter where focus sits (re-renders
        // can bounce focus out of the dialog), so listen at document level
        // for the modal's lifetime.
        document.addEventListener('keydown', handleKeydown, true);
        // Record the invoker BEFORE the modal steals focus, so close (confirm,
        // cancel, Escape, backdrop click) restores keyboard/AT focus to where
        // the user was (e.g. the FileGrid row button) instead of <body>.
        // Re-mounts mid-lifetime (every app render re-runs this ref) keep the
        // ORIGINAL invoker and never re-steal focus from the user.
        const invoker = el.contains(document.activeElement) ? (state.invoker || document.activeElement) : document.activeElement;
        if (!state.invoker) state.invoker = invoker;
        el._dsModalTeardown = (removed) => {
            document.removeEventListener('keydown', handleKeydown, true);
            // Only restore focus when the modal is genuinely going away (not a
            // re-render remount) and focus is not already somewhere useful.
            if (removed && state.invoker && state.invoker.focus && state.invoker.isConnected) {
                try { state.invoker.focus(); } catch { /* swallow: restoring focus on close is best-effort, teardown still completes */ }
            }
            if (removed) state.invoker = null;
        };
        // Auto-focus on open - only when focus is not already inside the modal
        // (re-renders must not yank the caret around).
        if (!el.contains(document.activeElement)) {
            const preferred = modal.querySelector('[autofocus]') || modal.querySelector(FOCUSABLE_SEL);
            if (preferred) preferred.focus();
        }
    };

    return h('div', {
        class: 'ds-modal-backdrop',
        // Live busy flag read by the mount-bound Escape handler + backdrop click.
        'data-busy': busy ? '1' : '0',
        ref: (el) => {
            if (el) {
                // A remount in the same tick (render churn) is not a close:
                // cancel the pending removal teardown before re-binding.
                state.pendingRemoval = false;
                backdropRef(el);
                state.last = el;
            } else if (state.last && state.last._dsModalTeardown) {
                const t = state.last._dsModalTeardown;
                state.last = null;
                state.pendingRemoval = true;
                t(false); // always unhook the document listener now
                queueMicrotask(() => {
                    // Still gone next microtask -> genuine close: restore focus.
                    if (state.pendingRemoval) { t(true); state.pendingRemoval = false; }
                });
            }
        },
        onclick: (e) => {
            if (e.target !== e.currentTarget) return;
            if (e.currentTarget.dataset.busy === '1') return; // no mid-flight close
            if (onClose) onClose();
        }
    },
        h('div', {
            class: 'ds-modal' + (kind ? ' ds-modal-' + kind : ''),
            role: 'dialog', 'aria-modal': 'true',
            ...(labelledBy ? { 'aria-labelledby': labelledBy } : {})
        }, ...(Array.isArray(children) ? children : [children]))
    );
}

// Modal() is a plain function re-invoked on EVERY re-render (webjsx pattern,
// not a stateful component) with no instance handle of its own, so the
// aria-labelledby id can't be minted fresh per call (churns every render,
// per the finding this map fixes) or read off a previous DOM node (no
// cross-call handle survives now that Backdrop's focus/invoker state was
// scoped into a per-call closure to fix the separate multi-instance-stomp
// bug). Instead memoize per logical dialog, keyed on `kind` (ConfirmDialog/
// PromptDialog/CountdownDialog/etc. each pass a distinct `kind`, and this
// app's modal callers only ever have one dialog of a given kind open at
// once) — cleared on close so a later, unrelated dialog of the same kind
// mints its own fresh id rather than inheriting a stale one.
const _headIds = new Map();

// Shared modal shell: head + body + actions row. ConfirmDialog/PromptDialog/
// FileViewer all funnel through this so the ds-modal markup is authored once.
// `actions` is an array of vnodes (already using the Btn primitive). Any of the
// slots may be omitted.
export function Modal({ onClose, kind = '', head, headClass = '', headAttrs = {}, body, bodyClass = 'ds-modal-body', bodyAttrs = {}, actions, busy = false } = {}) {
    // Give the head a stable id so the dialog can point aria-labelledby at it,
    // exposing the title as the dialog's accessible name to screen readers.
    // See _headIds above for why this is keyed on `kind` rather than minted
    // fresh per call or read off a previous DOM node.
    let headId = null;
    if (head != null) {
        headId = _headIds.get(kind);
        if (!headId) {
            headId = 'ds-modal-head-' + shortUid(6);
            _headIds.set(kind, headId);
        }
    } else {
        _headIds.delete(kind);
    }
    const wrappedOnClose = onClose ? (...args) => { _headIds.delete(kind); return onClose(...args); } : undefined;
    return Backdrop({
        onClose: wrappedOnClose,
        kind,
        busy,
        labelledBy: headId,
        children: [
            head != null ? h('div', { id: headId, class: ('ds-modal-head' + (headClass ? ' ' + headClass : '')), ...headAttrs }, ...(Array.isArray(head) ? head : [head])) : null,
            body != null ? h('div', { class: bodyClass, ...bodyAttrs }, ...(Array.isArray(body) ? body : [body])) : null,
            actions != null ? h('div', { class: 'ds-modal-actions' }, ...(Array.isArray(actions) ? actions : [actions])) : null,
        ].filter(Boolean)
    });
}

// A role=alert error line rendered INSIDE the modal body (so a 409/403 from a
// mutation is visible at the point of action, inside the focus trap — not a
// sibling stuck in page flow behind the fixed backdrop).
export function modalError(error) {
    return error ? h('p', { class: 'ds-modal-error', role: 'alert' }, String(error)) : null;
}
