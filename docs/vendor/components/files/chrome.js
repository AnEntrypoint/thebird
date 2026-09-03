// Surrounding file-browser chrome: the bulk-action strip, the drop zone, the
// per-file upload progress list, the empty state, the breadcrumb path, the
// toolbar band, and the multi-root segmented picker.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Btn, Icon } from '../shell.js';
const h = webjsx.createElement;

// BulkBar — the act-on-selection strip shown while a multi-select is active.
// Host renders it above the grid; `actions` are [{ label, onClick, danger,
// disabled }]; `busy` disables everything while a bulk operation is in flight.
export function BulkBar({ count = 0, noun = 'file', nounPlural, actions = [], onClear, busy = false } = {}) {
    if (!count) return null;
    // 'entry' pluralizes to 'entries', not 'entrys' - handle the -y noun class
    // unless the host passes an explicit plural.
    const plural = nounPlural || (/[^aeiou]y$/.test(noun) ? noun.slice(0, -1) + 'ies' : noun + 's');
    const kids = [
        h('span', { key: 'count', class: 'ds-bulkbar-count', role: 'status', 'aria-live': 'polite' },
            count + ' ' + (count === 1 ? noun : plural) + ' selected'),
        ...actions.map((a, i) => Btn({
            key: 'bba' + i, danger: !!a.danger, disabled: busy || a.disabled,
            onClick: a.onClick, children: a.label,
        })),
        onClear ? Btn({ key: 'bbclear', disabled: busy, onClick: onClear, children: 'clear selection' }) : null,
    ].filter(Boolean);
    return h('div', { class: 'ds-bulkbar', role: 'toolbar', 'aria-label': 'bulk file actions', 'aria-busy': busy ? 'true' : null }, ...kids);
}

export function FileToolbar({ left = [], right = [] } = {}) {
    return h('div', { class: 'ds-file-toolbar' },
        h('div', { class: 'ds-file-toolbar-left' }, ...left),
        h('div', { class: 'ds-file-toolbar-right' }, ...right)
    );
}

// RootsPicker — a segmented control for choosing among multiple allowed FS roots
// (so the app stops borrowing the history-tab .pill markup). Each root is
// { id, label }; `selected` is the active id. role=tablist for AT navigation.
export function RootsPicker({ roots = [], selected, onSelect, label = 'roots' } = {}) {
    if (!roots.length) return null;
    return h('div', { class: 'ds-roots-picker', role: 'tablist', 'aria-label': label },
        ...roots.map((r) => h('button', {
            key: 'root-' + (r.id != null ? r.id : r.label),
            type: 'button', role: 'tab',
            class: 'ds-roots-tab' + ((r.id != null ? r.id : r.label) === selected ? ' active' : ''),
            'aria-selected': (r.id != null ? r.id : r.label) === selected ? 'true' : 'false',
            onclick: () => onSelect && onSelect(r.id != null ? r.id : r.label),
        }, r.label || r.id)));
}

export function DropZone({ children, dragover, rejected, onDrop, onDragOver, onDragLeave, label = 'drop files here', onPick } = {}) {
    // With children the zone is a passive WRAPPER: content renders normally and
    // the dashed affordance appears only while a drag is over it (real file
    // managers never burn a permanent band on a maybe-drop). Without children
    // it keeps the explicit picker-block look. `rejected` lets the host flag a
    // drag whose payload fails a type/size guard with a distinct treatment
    // (.rejected) instead of the normal accept-toned .dragover.
    const kids = Array.isArray(children) ? children : children ? [children] : [];
    return h('div', {
        class: 'ds-dropzone' + (kids.length ? ' ds-dropzone--wrap' : '') + (dragover ? ' dragover' : '') + (rejected ? ' rejected' : ''),
        ondragover: (e) => { e.preventDefault(); onDragOver && onDragOver(e); },
        ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) { onDragLeave && onDragLeave(e); } },
        ondrop: (e) => { e.preventDefault(); onDrop && onDrop(e.dataTransfer.files); }
    },
        h('div', { class: 'ds-dropzone-inner' },
            h('span', { class: 'ds-dropzone-glyph', role: 'img', 'aria-label': 'upload' }, Icon('arrow-up')),
            h('span', { class: 'ds-dropzone-label' }, label),
            onPick ? Btn({ onClick: onPick, children: 'pick files' }) : null
        ),
        ...kids
    );
}

// UploadProgress — per-file upload rows. Error rows are recoverable, not dead
// ends: each item may carry `actions` ([{ label, onClick }], e.g. 'replace' on
// a 409 collision) and the host may wire `onDismiss(item, index)` so error rows
// can be cleared without waiting for the next successful batch.
export function UploadProgress({ items = [], onDismiss } = {}) {
    if (!items.length) return null;
    return h('div', { class: 'ds-upload-progress' },
        ...items.map((it, i) => {
            const indeterminate = !it.error && !it.done && !it.pct && it.indeterminate;
            const status = it.error ? 'error' : (it.done ? 'complete' : (indeterminate ? 'uploading' : `uploading ${it.pct || 0}%`));
            const rowActions = [
                ...((it.actions || []).map((a, ai) => h('button', {
                    key: 'ua' + ai, type: 'button', class: 'ds-upload-act',
                    'aria-label': `${a.label} ${it.name}`,
                    onclick: () => a.onClick && a.onClick(it, i),
                }, a.label))),
                (it.error && onDismiss) ? h('button', {
                    key: 'ud', type: 'button', class: 'ds-upload-act',
                    'aria-label': `dismiss ${it.name}`,
                    onclick: () => onDismiss(it, i),
                }, 'dismiss') : null,
            ].filter(Boolean);
            return h('div', {
                key: it.name + i,
                class: 'ds-upload-item' + (it.done ? ' done' : '') + (it.error ? ' error' : ''),
                role: 'status',
                'aria-label': `${it.name}: ${status}`,
                'aria-live': 'polite'
            },
                h('span', { class: 'ds-upload-name' }, it.name),
                h('span', { class: 'ds-upload-bar' + (indeterminate ? ' indeterminate' : '') },
                    h('span', { class: 'ds-upload-fill', 'data-pct': String(Math.max(0, Math.min(100, it.pct || 0))), 'aria-hidden': 'true' })
                ),
                h('span', { class: 'ds-upload-pct', 'aria-hidden': 'true' }, (it.error ? 'err' : (it.done ? 'ok' : (indeterminate ? '...' : (it.pct || 0) + '%')))),
                rowActions.length ? h('span', { class: 'ds-upload-actions', role: 'group', 'aria-label': `actions for ${it.name}` }, ...rowActions) : null
            );
        })
    );
}

export function EmptyState({ text = 'nothing here', glyph = Icon('circle'), action } = {}) {
    // action: { onClick, label } - an optional CTA (e.g. 'go up' / 'upload a
    // file'), mirroring the SessionDashboard emptyAction contract so an empty
    // directory is not a dead end. Children are built as an array + filtered so
    // the keyed Btn never sits beside an unkeyed span (webjsx applyDiff 'key'
    // crash on mixed keyed/unkeyed siblings).
    return h('div', { class: 'ds-file-empty', role: 'status' },
        ...[
            h('span', { key: 'glyph', class: 'ds-file-empty-glyph', 'aria-hidden': 'true' }, glyph),
            h('span', { key: 'text', class: 'ds-file-empty-text' }, text),
            (action && action.onClick)
                ? Btn({ key: 'ea', onClick: action.onClick, children: action.label || 'go up' })
                : null,
        ].filter(Boolean)
    );
}

export function BreadcrumbPath({ segments = [], onNav, root = 'root' } = {}) {
    const parts = [h('button', { key: 'root', class: 'ds-crumb-seg', onclick: () => onNav && onNav(0) }, root)];
    segments.forEach((seg, i) => {
        parts.push(h('span', { key: 'sep' + i, class: 'ds-crumb-sep', 'aria-hidden': 'true' }, Icon('chevron-right', { size: 13 })));
        parts.push(h('button', {
            key: 'seg' + i,
            class: 'ds-crumb-seg' + (i === segments.length - 1 ? ' leaf' : ''),
            onclick: () => onNav && onNav(i + 1)
        }, seg));
    });
    return h('div', { class: 'ds-crumb-path' }, ...parts);
}
