// Per-entry file primitives: FileRow (list/compact density), FileCell
// (thumbnail density), and the loading skeleton. Both entry shapes share the
// same open/select/permission semantics and the same no-interactive-nesting
// rule — the row is a plain container whose "open" affordance is itself a real
// <button>, with per-file action buttons as siblings.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { TYPE_LABELS, FileIcon, fmtFileSize } from './types.js';
const h = webjsx.createElement;

// Default action set for FileRow. A host without mutation endpoints passes a
// narrower `actions` list (e.g. ['download']) so the row renders no dead controls.
const FILE_ROW_ACTIONS = ['download', 'rename', 'move', 'delete'];

export function FileRow({ name, type = 'other', size, modified, code, onOpen, onAction, active, key, permissions, locked,
                          actions = FILE_ROW_ACTIONS, busy = false, selectable = false, selected = false, onToggleSelect } = {}) {
    // permissions: ['read','write'] | ['read'] | 'EACCES'. A no-access entry can
    // be listed (the dir stat saw it) but not opened — show an ASCII tag and
    // disable the open button so the row reads honestly instead of silently
    // failing on click.
    const noAccess = locked || permissions === 'EACCES' || (Array.isArray(permissions) && permissions.length === 0);
    const readOnly = !noAccess && Array.isArray(permissions) && permissions.indexOf('write') === -1 && permissions.indexOf('read') !== -1;
    const permTag = noAccess ? 'no access' : (readOnly ? 'read-only' : null);
    // permTag is rendered as its own chip (a SHAPE channel, not folded into the
    // muted meta text) - so drop it from the meta join, but keep it in the
    // accessible label so AT still announces the restriction.
    const meta = [type === 'dir' ? null : fmtFileSize(size), modified || null].filter(Boolean).join(' · ');
    const typeLabel = TYPE_LABELS[type] || 'file';
    const accessibleLabel = `${typeLabel}: ${name}${meta ? ` (${meta})` : ''}${permTag ? ', ' + permTag : ''}`;
    const canOpen = onOpen && !noAccess && !busy;
    // Mutation actions on a read-only/no-access row render disabled (with a
    // 'read-only' title) instead of vanishing, so the affordance reads honestly.
    // `busy` (in-flight mutation) disables every control on the row.
    const mutateDisabled = busy || readOnly || noAccess;
    const actBtn = (act, title, ariaLabel, icon, warn) => h('button', {
        key: 'act-' + act,
        type: 'button',
        class: 'ds-file-act' + (warn ? ' ds-file-act-warn' : ''),
        title: mutateDisabled && act !== 'download' ? 'read-only' : title,
        'aria-label': ariaLabel,
        disabled: (act === 'download' ? busy : mutateDisabled) ? true : null,
        'aria-disabled': (act === 'download' ? busy : mutateDisabled) ? 'true' : null,
        onclick: () => onAction(act),
    }, Icon(icon));
    const actionBtns = onAction ? [
        actions.indexOf('download') !== -1 && type !== 'dir'
            ? actBtn('download', 'download', `download ${name}`, 'arrow-down', false) : null,
        actions.indexOf('rename') !== -1
            ? actBtn('rename', 'rename', `rename ${name}`, 'pencil', false) : null,
        // Single-file move used to require checkbox-select + BulkBar - a
        // per-row affordance matches fsbrowse and the kit rename/delete rows
        // already on this row (no reason move alone needed a select detour).
        actions.indexOf('move') !== -1
            ? actBtn('move', 'move', `move ${name}`, 'arrow-right', false) : null,
        actions.indexOf('delete') !== -1
            ? actBtn('delete', 'delete', `delete ${name}`, 'x', true) : null,
    ].filter(Boolean) : [];
    // Multi-select checkbox — a sibling control before the open button so the
    // row stays valid HTML (no interactive nesting). A no-access entry cannot
    // be marked (bulk mutations would fail on it anyway).
    const checkCtl = selectable ? h('button', {
        key: 'mark',
        type: 'button',
        class: 'ds-file-check' + (selected ? ' is-marked' : ''),
        role: 'checkbox',
        'aria-checked': selected ? 'true' : 'false',
        'aria-label': (selected ? 'unselect ' : 'select ') + name,
        disabled: (noAccess || busy) ? true : null,
        onclick: onToggleSelect ? (e) => onToggleSelect({ range: !!e.shiftKey }) : null,
    }, h('span', { class: 'ds-check-box', 'aria-hidden': 'true' })) : null;
    // A role=button row containing real <button> action controls is invalid
    // HTML (interactive nesting). Instead the row is a plain container and the
    // primary "open" affordance is itself a real <button> (native keyboard +
    // semantics); the per-file action buttons sit alongside it as siblings.
    const rowKids = [
        checkCtl,
        h('button', {
            key: 'open',
            type: 'button',
            class: 'ds-file-open',
            onclick: canOpen ? onOpen : null,
            'aria-label': accessibleLabel + (noAccess ? ' (no access)' : ''),
            'aria-pressed': active ? 'true' : 'false',
            disabled: canOpen ? null : true,
        },
            ...[
                code != null ? h('span', { class: 'code', 'aria-label': `code: ${code}` }, code) : null,
                FileIcon({ type }),
                h('span', { class: 'title' }, name),
                h('span', { class: 'ds-file-meta meta', 'aria-label': meta ? `metadata: ${meta}` : null }, meta || '—'),
                permTag ? h('span', { class: 'ds-file-perm-tag' + (noAccess ? ' is-noaccess' : ''), 'aria-hidden': 'true' }, permTag) : null,
            ].filter(Boolean)
        ),
        actionBtns.length ? h('span', { key: 'acts', class: 'ds-file-actions', role: 'group', 'aria-label': `actions for ${name}` },
            ...actionBtns
        ) : null,
    ].filter(Boolean);
    return h('div', {
        key,
        class: 'ds-file-row row' + (active ? ' active' : '') + (noAccess ? ' is-locked' : '')
            + (readOnly ? ' is-restricted' : '')
            + (selected ? ' is-marked' : '') + (selectable ? ' is-selectable' : ''),
        'data-file-type': type,
        'aria-busy': busy ? 'true' : null,
    }, ...rowKids);
}

// FileCell — the thumbnail-density tile. Image entries show a real (lazy)
// thumbnail through the host's confined thumbUrl; everything else keeps its
// type icon. Same open/mark semantics as FileRow, same no-nesting rule.
export function FileCell({ key, f = {}, selectable = false, selected = false, onToggleSelect, onOpen, thumb } = {}) {
    const noAccess = f.locked || f.permissions === 'EACCES'
        || (Array.isArray(f.permissions) && f.permissions.length === 0);
    const canOpen = onOpen && !noAccess;
    const typeLabel = TYPE_LABELS[f.type] || 'file';
    const kids = [
        selectable ? h('button', {
            key: 'mark', type: 'button',
            class: 'ds-file-check ds-file-cell-check' + (selected ? ' is-marked' : ''),
            role: 'checkbox', 'aria-checked': selected ? 'true' : 'false',
            'aria-label': (selected ? 'unselect ' : 'select ') + f.name,
            disabled: noAccess ? true : null,
            onclick: onToggleSelect ? (e) => onToggleSelect({ range: !!e.shiftKey }) : null,
        }, h('span', { class: 'ds-check-box', 'aria-hidden': 'true' })) : null,
        h('button', {
            key: 'open', type: 'button', class: 'ds-file-cell-open',
            onclick: canOpen ? () => onOpen(f) : null,
            disabled: canOpen ? null : true,
            'aria-label': typeLabel + ': ' + f.name + (noAccess ? ' (no access)' : ''),
        },
            h('span', { class: 'ds-file-cell-media' },
                thumb
                    ? h('img', { class: 'ds-file-cell-thumb', src: thumb, alt: '', loading: 'lazy' })
                    : FileIcon({ type: f.type })),
            h('span', { class: 'ds-file-cell-name', title: f.name }, f.name),
            h('span', { class: 'ds-file-cell-meta' }, f.type === 'dir' ? 'folder' : fmtFileSize(f.size))),
    ].filter(Boolean);
    return h('div', {
        key,
        class: 'ds-file-cell' + (selected ? ' is-marked' : '') + (f.active ? ' active' : '') + (noAccess ? ' is-locked' : ''),
        'data-file-type': f.type,
    }, ...kids);
}

// FileSkeleton — placeholder shimmer rows shown while a directory loads, so the
// grid does not flash from a bare spinner to a full list (predictable perceived
// perf, the file-manager feel). `rows` controls how many ghost rows render.
export function FileSkeleton({ rows = 12 } = {}) {
    return h('div', { class: 'ds-file-grid ds-file-skeleton', role: 'status', 'aria-busy': 'true', 'aria-label': 'loading files' },
        ...Array.from({ length: Math.max(1, rows) }, (_, i) => h('div', { key: 'sk' + i, class: 'ds-file-row ds-file-row-skeleton', 'aria-hidden': 'true' },
            h('span', { class: 'ds-skel ds-skel-icon' }),
            h('span', { class: 'ds-skel ds-skel-title' }),
            h('span', { class: 'ds-skel ds-skel-meta' })))
    );
}
