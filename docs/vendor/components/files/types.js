// File-type vocabulary: the canonical type list, its line-icon and accessible
// label maps, the FileIcon component, and the one byte formatter the whole kit
// renders sizes through (chat.js re-exports it as fmtBytes).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

export const FILE_TYPES = ['dir', 'image', 'video', 'audio', 'code', 'text', 'archive', 'document', 'symlink', 'other'];
const TYPE_ICON = {
    dir: 'folder', image: 'file-image', video: 'file-video', audio: 'file-audio', code: 'file-code',
    text: 'file-text', archive: 'file-zip', document: 'file-text', symlink: 'link', other: 'file'
};

export const TYPE_LABELS = {
    dir: 'folder',
    image: 'image file',
    video: 'video file',
    audio: 'audio file',
    code: 'code file',
    text: 'text file',
    archive: 'archive file',
    document: 'document file',
    symlink: 'symbolic link',
    other: 'file'
};

export function fileGlyph(type) {
    return TYPE_ICON[type] || TYPE_ICON.other;
}

// The canonical kit byte formatter (chat.js re-exports it as fmtBytes). One
// format everywhere: '0 B' for zero; the em-dash means unknown/null/invalid
// (NaN, a negative count, or anything non-numeric never reaches the divide
// loop — previously NaN fell through to the loop unchanged and rendered the
// literal string "NaN B").
export function fmtFileSize(bytes) {
    if (bytes == null) return '—';
    if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

export function FileIcon({ type = 'other' } = {}) {
    return h('span', { class: 'ds-file-icon', 'data-file-type': type, 'aria-label': TYPE_LABELS[type] || 'file', role: 'img' }, Icon(fileGlyph(type)));
}

// Sort a file list by a key (name/size/modified/type), dirs-first always so the
// hierarchy reads top-down regardless of sort. `dir` is 'asc'|'desc'.
// `modifiedTs` (epoch ms) is used for the modified sort when present, since the
// `modified` field is a pre-formatted relative string the host passes for display.
export function sortFiles(files = [], sort = 'name', dir = 'asc') {
    const mul = dir === 'desc' ? -1 : 1;
    const cmp = (a, b) => {
        // Directories always cluster before files; within a cluster, apply the sort.
        const ad = a.type === 'dir' ? 0 : 1, bd = b.type === 'dir' ? 0 : 1;
        if (ad !== bd) return ad - bd;
        let r = 0;
        if (sort === 'size') r = (a.size || 0) - (b.size || 0);
        else if (sort === 'modified') r = (a.modifiedTs || 0) - (b.modifiedTs || 0);
        else if (sort === 'type') r = String(a.type || '').localeCompare(String(b.type || ''));
        else r = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        return r * mul || String(a.name || '').localeCompare(String(b.name || ''));
    };
    return files.slice().sort(cmp);
}
