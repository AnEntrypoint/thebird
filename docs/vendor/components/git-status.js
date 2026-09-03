// Git status + diff primitives — changed-file list and unified-diff renderer.
// Ported from pi-web's BranchNavigator concept into this design system's
// pure-webjsx idiom (see files.js for the sibling file-list pattern this
// mirrors: FileIcon-style type glyph, ds-file-row-style clickable row).

import * as webjsx from '../../vendor/webjsx/index.js';
import { Icon } from './shell.js';
import { fileGlyph } from './files.js';
import { highlightAllUnder } from '../highlight.js';
const h = webjsx.createElement;

// git status letter -> { label, tone, icon } used for both the row's status
// chip and its left-edge tone. Mirrors the porcelain status codes pi-web's
// git API returns (A/M/D/R/? ...), collapsed to the ones a status list needs.
const STATUS_META = {
    A: { label: 'added', tone: 'add', glyph: 'A' },
    M: { label: 'modified', tone: 'modify', glyph: 'M' },
    D: { label: 'deleted', tone: 'delete', glyph: 'D' },
    R: { label: 'renamed', tone: 'modify', glyph: 'R' },
    C: { label: 'copied', tone: 'modify', glyph: 'C' },
    U: { label: 'conflicted', tone: 'delete', glyph: 'U' },
    '?': { label: 'untracked', tone: 'add', glyph: '?' },
    '!': { label: 'ignored', tone: 'neutral', glyph: '!' },
};

function statusMeta(status) {
    return STATUS_META[status] || { label: status || 'changed', tone: 'neutral', glyph: (status || '?').slice(0, 1) };
}

// Guess a file "type" (for FileIcon-style glyph reuse) from its extension —
// git-status entries are paths, not the richer {type} shape files.js rows get
// from a directory listing.
const EXT_TYPE = {
    js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
    py: 'code', rs: 'code', go: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code',
    css: 'code', less: 'code', scss: 'code', html: 'code', htm: 'code', json: 'code', jsonl: 'code',
    yml: 'code', yaml: 'code', toml: 'code', sh: 'code', bash: 'code', zsh: 'code', fish: 'code',
    sql: 'code', graphql: 'code', gql: 'code', tf: 'code', hcl: 'code',
    md: 'document', mdx: 'document', txt: 'text', pdf: 'document', docx: 'document', doc: 'document',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', bmp: 'image', ico: 'image', avif: 'image',
    mp4: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video',
    mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
    zip: 'archive', tar: 'archive', gz: 'archive', '7z': 'archive', rar: 'archive', bz2: 'archive',
};

// Filenames (not extensions) that need a specific bucket regardless of any
// trailing dot-segment — lockfiles have no meaningful "extension" split and
// dotfiles like .gitignore/.env would otherwise fall through to 'other'.
const NAME_TYPE = {
    'package-lock.json': 'code', 'yarn.lock': 'code', 'bun.lock': 'code',
    'pnpm-lock.yaml': 'code', 'cargo.lock': 'code', 'composer.lock': 'code',
    '.gitignore': 'text', '.gitattributes': 'text', '.gitmodules': 'text',
    '.env': 'text', '.editorconfig': 'text', '.npmrc': 'text',
};

function fileTypeFromPath(pathname = '') {
    const base = pathname.split('/').pop() || pathname;
    const lower = base.toLowerCase();
    if (NAME_TYPE[lower]) return NAME_TYPE[lower];
    if (lower.startsWith('.env.')) return 'text';
    if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'code';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return 'other';
    return EXT_TYPE[base.slice(dot + 1).toLowerCase()] || 'other';
}

// GitStatusPanel — a list of changed files with add/modify/delete indicators.
// files: [{ path, status, staged?, insertions?, deletions? }]
// onFileClick(file) opens the diff for a row.
export function GitStatusPanel({ files = [], onFileClick, emptyText = 'no changes', active } = {}) {
    if (!files.length) {
        return h('div', { class: 'ds-git-empty', role: 'status' },
            h('span', { class: 'ds-git-empty-glyph', 'aria-hidden': 'true' }, Icon('circle-dot', { size: 22 })),
            h('span', {}, emptyText));
    }
    return h('div', { class: 'ds-git-status-grid', role: 'group', 'aria-label': 'changed files' },
        ...files.map((f, i) => GitStatusRow({ key: f.path || i, file: f, onClick: onFileClick, active: active === f.path })));
}

function GitStatusRow({ key, file, onClick, active } = {}) {
    const meta = statusMeta(file.status);
    const type = fileTypeFromPath(file.path);
    const stats = [
        file.insertions != null ? h('span', { class: 'ds-git-stat ds-git-stat-add' }, '+' + file.insertions) : null,
        file.deletions != null ? h('span', { class: 'ds-git-stat ds-git-stat-del' }, '-' + file.deletions) : null,
    ].filter(Boolean);
    return h('button', {
        key, type: 'button',
        class: 'ds-git-row' + (active ? ' active' : ''),
        onclick: onClick ? () => onClick(file) : null,
        disabled: onClick ? null : true,
        'aria-label': meta.label + ': ' + file.path,
        'aria-pressed': active ? 'true' : 'false',
    },
        h('span', { class: 'ds-git-status-chip tone-' + meta.tone, 'aria-hidden': 'true' }, meta.glyph),
        h('span', { class: 'ds-git-row-icon', 'aria-hidden': 'true' }, Icon(fileGlyph(type), { size: 15 })),
        h('span', { class: 'ds-git-row-path' }, file.path),
        file.staged ? h('span', { class: 'ds-git-row-tag' }, 'staged') : null,
        stats.length ? h('span', { class: 'ds-git-row-stats' }, ...stats) : null,
    );
}

// Parse a unified diff into hunks of typed lines so we can color +/- context
// independently of the raw text (avoids relying on Prism's diff grammar for
// the leading marker column, which we style ourselves).
function parseUnifiedDiff(diff = '') {
    const lines = diff.split('\n');
    const hunks = [];
    let current = null;
    for (const line of lines) {
        if (line.startsWith('@@')) {
            current = { header: line, lines: [] };
            hunks.push(current);
            continue;
        }
        if (line.startsWith('diff --git') || line.startsWith('index ') ||
            line.startsWith('--- ') || line.startsWith('+++ ')) {
            continue; // file-header noise; the host already knows the filename
        }
        if (!current) continue;
        let kind = 'context';
        if (line.startsWith('+')) kind = 'add';
        else if (line.startsWith('-')) kind = 'del';
        current.lines.push({ kind, text: line });
    }
    return hunks;
}

const EXT_LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
    ts: 'typescript', tsx: 'tsx', py: 'python', rs: 'rust', go: 'go',
    css: 'css', scss: 'css', html: 'markup', md: 'markdown', json: 'json',
    yml: 'yaml', yaml: 'yaml', sh: 'bash', sql: 'sql', toml: 'toml',
};

function langFromFilename(filename = '') {
    const base = filename.split('/').pop() || filename;
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return null;
    return EXT_LANG[base.slice(dot + 1).toLowerCase()] || null;
}

// GitDiffView — unified-diff renderer with +/- line coloring. Uses
// highlight.js's Prism loader for language detection by file extension; the
// +/- marker column is drawn by CSS (tone classes), Prism only tokenizes the
// code content inside each line.
export function GitDiffView({ diff = '', filename, binary = false } = {}) {
    const hunks = parseUnifiedDiff(diff);
    const lang = langFromFilename(filename);
    const highlightRef = (el) => {
        if (!el) return;
        try { highlightAllUnder(el); } catch { /* swallow: progressive enhancement only */ }
    };
    if (!hunks.length) {
        // A binary changed file produces no unified diff at all - saying
        // "no diff to show" reads as "nothing changed", which is wrong and
        // misleading; name the real reason instead.
        return h('div', { class: 'ds-git-diff-empty', role: 'status' },
            binary ? 'binary file, diff not shown' : 'no diff to show');
    }
    return h('div', { class: 'ds-git-diff', ref: highlightRef },
        filename ? h('div', { class: 'ds-git-diff-head' }, h('span', { class: 'name' }, filename)) : null,
        ...hunks.map((hunk, hi) => h('div', { key: 'hunk' + hi, class: 'ds-git-hunk' },
            h('div', { class: 'ds-git-hunk-header' }, hunk.header),
            h('pre', { class: 'ds-git-hunk-body' + (lang ? ' lang-' + lang : '') },
                ...hunk.lines.map((l, li) => h('code', {
                    key: li,
                    class: 'ds-git-line ds-git-line-' + l.kind + (lang ? ' language-' + lang : ''),
                }, l.text + '\n'))
            )
        ))
    );
}
