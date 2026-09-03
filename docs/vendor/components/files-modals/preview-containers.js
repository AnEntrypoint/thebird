// The two preview containers around a body renderer: FileViewer (the modal
// overlay, focus-trapped, kept as the narrow-viewport fallback) and
// FilePreviewPane (the persistent non-modal side pane for a WorkspaceShell
// pane slot). Both share the head, the ArrowLeft/Right stepper, and the
// swipe-to-step gesture.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { fmtFileSize } from '../files.js';
import { Modal } from './modal-shell.js';
const h = webjsx.createElement;

// Shared preview-head children for both the modal FileViewer and the inline
// FilePreviewPane: name + meta + prev/next stepper + download + close. ASCII
// prev/next words (no glyph arrows). onPrev/onNext are omitted when there is no
// previewable neighbour in that direction.
function previewHead({ file, onClose, onAction, onPrev, onNext } = {}) {
    const meta = [file.type, file.size != null ? fmtFileSize(file.size) : null, file.modified || null]
        .filter(Boolean).join(' · ');
    return [
        h('span', { class: 'ds-preview-name', title: file.path || file.name || '' }, file.name || ''),
        h('span', { class: 'ds-preview-meta' }, meta),
        h('span', { class: 'ds-preview-actions' },
            (onPrev || onNext) ? h('span', { class: 'ds-preview-step', role: 'group', 'aria-label': 'step files' },
                h('button', { class: 'ds-file-act', title: 'previous file', 'aria-label': 'previous file', disabled: onPrev ? null : true, onclick: () => onPrev && onPrev() }, 'prev'),
                h('button', { class: 'ds-file-act', title: 'next file', 'aria-label': 'next file', disabled: onNext ? null : true, onclick: () => onNext && onNext() }, 'next')) : null,
            onAction ? h('button', { class: 'ds-file-act', title: 'download', 'aria-label': 'download', onclick: () => onAction('download') }, Icon('arrow-down')) : null,
            onClose ? h('button', { class: 'ds-file-act', title: 'close', 'aria-label': 'close', onclick: onClose }, Icon('x')) : null
        )
    ];
}

// ArrowLeft/Right step the preview when focus is inside it (both pane + modal).
function previewKeyNav(onPrev, onNext) {
    return (e) => {
        if (e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev(); }
        else if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext(); }
    };
}

// Touch stepping: horizontal swipe on the preview body steps prev/next. Skips
// when the gesture starts inside a horizontally-scrollable child (code <pre>)
// so panning wide code never flips files.
function previewSwipe(onPrev, onNext) {
    if (!onPrev && !onNext) return {};
    let sx = null, sy = null;
    return {
        onpointerdown: (e) => {
            const scroller = e.target.closest && e.target.closest('pre');
            if (scroller && scroller.scrollWidth > scroller.clientWidth) { sx = null; return; }
            sx = e.clientX; sy = e.clientY;
        },
        onpointerup: (e) => {
            if (sx == null) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            sx = null;
            if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
            if (dx < 0 && onNext) onNext();
            else if (dx > 0 && onPrev) onPrev();
        },
        onpointercancel: () => { sx = null; },
    };
}

export function FileViewer({ file, body, onClose, onAction, onPrev, onNext } = {}) {
    if (!file) return null;
    const keyNav = previewKeyNav(onPrev, onNext);
    return Modal({
        onClose,
        kind: 'preview',
        headClass: 'ds-preview-head',
        headAttrs: { 'data-file-type': file.type || 'other', onkeydown: keyNav },
        head: previewHead({ file, onClose, onAction, onPrev, onNext }),
        bodyClass: 'ds-preview-body',
        bodyAttrs: { 'data-file-type': file.type || 'other', onkeydown: keyNav, ...previewSwipe(onPrev, onNext) },
        body: Array.isArray(body) ? body : [body],
    });
}

// FilePreviewPane — the SAME preview, but as a persistent, non-modal side pane
// for the WorkspaceShell's pane slot (the split-view, claude-Desktop file-pane
// feel). Distinct from the overlay FileViewer (kept as the <900px fallback).
// Not focus-trapped (it is not modal); ArrowLeft/Right step files when focused.
export function FilePreviewPane({ file, body, onClose, onAction, onPrev, onNext } = {}) {
    if (!file) {
        return h('div', { class: 'ds-preview-pane ds-preview-pane-empty', role: 'status' },
            h('span', {}, 'Select a file to preview'));
    }
    return h('div', { class: 'ds-preview-pane', role: 'region', 'aria-label': 'file preview: ' + (file.name || ''),
                      tabindex: '0', onkeydown: previewKeyNav(onPrev, onNext) },
        h('div', { class: 'ds-preview-head', 'data-file-type': file.type || 'other' },
            ...previewHead({ file, onClose, onAction, onPrev, onNext })),
        h('div', { class: 'ds-preview-body', 'data-file-type': file.type || 'other' },
            ...(Array.isArray(body) ? body : [body]))
    );
}
