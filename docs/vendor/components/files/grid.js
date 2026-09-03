// FileGrid — the directory listing: cold-load skeleton, in-grid sort/filter
// toolbar, tri-state select-all, roving keyboard focus over the open buttons,
// a render cap with a "show N more" tail, and list/compact/thumb density.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { FileRow, FileCell, FileSkeleton } from './entries.js';
import { FileSortHeader, DensityPicker } from './grid-controls.js';
import { EmptyState } from './chrome.js';
const h = webjsx.createElement;

// FileGrid — the directory listing. Optional in-grid sort + filter make it a
// real file manager rather than a static dump:
//   sort   : { key, dir, onSort(key) }  - clickable column headers (name/size/modified)
//   filter : { value, onInput, placeholder } - a quick in-dir name filter
//   onOpen(f) opens a row; onAction(act,f) wires the per-row download/rename/delete.
// Keyboard nav: the grid is a focusable listbox - ArrowUp/Down move the active
// row, Enter opens it, Backspace asks the host to go up (onUp). The host keeps no
// focus state; the grid tracks it on the DOM via roving tabindex.
// How many rows to render before the "show more" cap kicks in. A node_modules-
// scale directory would otherwise flood the DOM with thousands of rows (and make
// the roving-tabindex querySelectorAll scan O(n) per keypress). Render the first
// CAP and a "show N more" row, mirroring the History tab's "load N older".
const FILE_GRID_CAP = 200;

/**
 * The directory listing.
 *
 * `loading` and `busy` are NOT two spellings of one state -- they are the two
 * halves of this SDK's standing distinction, and FileGrid is the component
 * that takes both because it is the one place both are in play at once:
 *
 *   loading -- a DATA FETCH is in flight. Owns which SHAPE renders: with no
 *              rows yet it is a cold load and the whole grid is replaced by
 *              FileSkeleton; with rows already on screen it is a refresh and
 *              the existing rows stay mounted and dim (is-refreshing), because
 *              flashing a populated directory back to shimmer reads as data
 *              loss.
 *   busy    -- a USER ACTION is in flight (a rename/move/delete round-trip).
 *              Owns INTERACTIVITY, not shape: it is forwarded to each FileRow
 *              as `busy`, which disables that row's open + mutation controls
 *              so a second click cannot fire the same mutation twice.
 *
 * A grid can be `busy` while not `loading` (a delete is posting, rows fully
 * rendered) and `loading` while not `busy` (a plain refresh). Passing one for
 * the other is a real bug, not a style choice, so they are deliberately not
 * merged and neither is an alias of the other.
 *
 * @param {Array} [files=[]] - the directory entries to render.
 * @param {boolean} [loading=false] - a data fetch is in flight (skeleton when cold, dim when refreshing).
 * @param {boolean} [busy] - a user-initiated mutation is in flight; disables every row's controls. Per-entry `f.busy` is used when this is not passed.
 * @param {string} [emptyText='No files here yet'] - copy for the empty/filtered-miss state.
 * @param {'list'|'compact'|'thumb'} [density='list'] - row density; 'thumb' switches to the multi-column cell grid.
 */
export function FileGrid({ files = [], onOpen, onAction, onUp, emptyText = 'No files here yet', emptyAction,
                          sort, filter, loading = false,
                          shown, onShowMore, actions, busy,
                          // Canonical multi-select contract (shared with
                          // SessionDashboard): selected/onToggleSelect.
                          // marked/onMark are accepted FileGrid aliases.
                          selectable = false, selected, onToggleSelect,
                          marked = selected, onMark = onToggleSelect,
                          onSelectAll, onClearSelection,
                          density = 'list', onDensity, thumbUrl } = {}) {
    // Skeleton ONLY for a cold load. A refresh of a populated grid (rename /
    // delete / upload round-trip) keeps the rows on screen and dims them -
    // flashing the whole directory to shimmer rows on every mutation reads as
    // data loss.
    if (loading && !files.length) return FileSkeleton({ rows: 12 });
    // A filtered miss is NOT an empty directory: when the in-grid filter narrows
    // to zero matches, the host still passes an empty `files` array - but we must
    // keep the controls toolbar (the filter input that caused the miss) mounted so
    // the user can clear/edit it to recover. Only a genuinely-empty directory (no
    // active filter) gets the bare cold EmptyState early-return.
    const hasFilter = !!(filter && (filter.value || '').length > 0);
    if (!files.length && !hasFilter) return EmptyState({ text: emptyText, glyph: Icon('folder-open', { size: 28 }), action: emptyAction });
    const refreshing = loading && files.length > 0;
    // Cap the rendered rows. `shown` (host-controlled) overrides the default cap
    // so "show more" can grow it; otherwise default to FILE_GRID_CAP.
    const limit = shown != null ? shown : FILE_GRID_CAP;
    const capped = files.length > limit;
    const visible = capped ? files.slice(0, limit) : files;
    const isThumb = density === 'thumb';
    // NOTE: the old `columns`-driven data-columns card-mode was removed - it placed
    // flex list-rows into a 2-4 col grid (squashed rows, mis-sized actions) and was
    // a half-wired third layout never exposed by the density radiogroup (list/
    // compact/thumb). Thumb density is the canonical multi-column grid.
    const gridAttrs = {};
    // Multi-select bookkeeping. Entries are keyed by path (fallback name); a
    // locked/EACCES entry is never selectable — bulk mutations would fail on it.
    const entryKeyOf = (f) => f.path || f.name;
    const isLockedEntry = (f) => f.locked || f.permissions === 'EACCES'
        || (Array.isArray(f.permissions) && f.permissions.length === 0);
    const selSet = marked instanceof Set ? marked : new Set(marked || []);
    const selectableKeys = selectable ? visible.filter((f) => !isLockedEntry(f)).map(entryKeyOf) : [];
    // Keyboard: roving focus over the open buttons inside the grid (rows and
    // thumbnail cells share the pattern). Ctrl/Cmd+A selects all SHOWN rows.
    const onKeyDown = (e) => {
        const grid = e.currentTarget;
        const opens = Array.from(grid.querySelectorAll('.ds-file-open:not([disabled]), .ds-file-cell-open:not([disabled])'));
        const cur = opens.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); opens[Math.min(opens.length - 1, cur + 1)]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (cur <= 0 ? opens[0] : opens[cur - 1])?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); opens[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); opens[opens.length - 1]?.focus(); }
        else if (e.key === 'Backspace') { e.preventDefault(); onUp && onUp(); }
        else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)
                 && selectable && onSelectAll && selectableKeys.length) {
            e.preventDefault(); onSelectAll(selectableKeys);
        }
    };
    const head = sort ? FileSortHeader(sort) : null;
    // Tri-state select-all over the selectable SHOWN rows (the cap label below
    // already tells the user more rows exist beyond the window).
    const selOfVisible = selectableKeys.filter((k) => selSet.has(k)).length;
    const allState = selOfVisible === 0 ? 'false' : (selOfVisible === selectableKeys.length ? 'true' : 'mixed');
    const selectAllCtl = (selectable && onSelectAll && selectableKeys.length)
        ? h('button', { key: 'selall', type: 'button', class: 'ds-file-selectall', role: 'checkbox',
            'aria-checked': allState,
            'aria-label': allState === 'true' ? 'clear selection' : 'select all ' + selectableKeys.length + ' shown files',
            onclick: () => (allState === 'true' && onClearSelection) ? onClearSelection() : onSelectAll(selectableKeys) },
            h('span', { class: 'ds-check-box', 'aria-hidden': 'true' }),
            h('span', {}, 'all'))
        : null;
    const densityCtl = DensityPicker({ density, onDensity });
    // One toolbar baseline: filter + select-all + sort sit left, density is
    // pushed right by the spread. The filter used to be a separate right-aligned
    // strip ABOVE controls, giving two strips with conflicting alignment.
    const filterCtl = filter ? h('span', { key: 'filterwrap', class: 'ds-file-filter-wrap' },
        h('input', {
            key: 'filter',
            class: 'ds-file-filter-input', type: 'search',
            value: filter.value || '', placeholder: filter.placeholder || 'Filter files',
            'aria-label': filter.placeholder || 'Filter files in this directory',
            oninput: (e) => filter.onInput && filter.onInput(e.target.value),
            onkeydown: (e) => {
                if (e.key === 'Escape' && filter.value) { e.preventDefault(); e.stopPropagation(); filter.onInput && filter.onInput(''); }
            },
        }),
        // Announces the filtered count as the filter narrows the list, so a
        // screen-reader user gets the same feedback a sighted user reads off
        // the grid without having to re-scan it after every keystroke. `files`
        // here is already the host's filter-applied set (see hasFilter above) -
        // there is no separate pre-filter total available inside this component.
        h('span', { key: 'filtercount', class: 'sr-only', role: 'status', 'aria-live': 'polite' },
            hasFilter ? files.length + (files.length === 1 ? ' file' : ' files') + ' shown' : '')
    ) : null;
    const leftKids = [filterCtl, selectAllCtl, head].filter(Boolean);
    const controlsKids = [
        ...leftKids,
        (leftKids.length && densityCtl) ? h('span', { key: 'spread', class: 'spread' }) : null,
        densityCtl].filter(Boolean);
    const controls = controlsKids.length
        ? h('div', { class: 'ds-file-controls' }, ...controlsKids)
        : null;
    // A filtered miss (zero rows but an active filter) renders the EmptyState
    // INSIDE the listing, below the controls toolbar, so the filter input stays
    // mounted and editable - the user can clear/edit it to recover instead of
    // being stranded with no toolbar (the early-return only fires for a genuinely
    // empty directory). The host passes filter-aware copy via emptyText.
    const filteredEmpty = !files.length && hasFilter;
    // role=group not listbox: the rows contain real <button> action controls, so
    // listbox/option semantics are invalid (an option can't host interactive
    // children). Keyboard nav still works via roving focus over the open buttons.
    const grid = filteredEmpty ? EmptyState({ text: emptyText, glyph: Icon('folder-open', { size: 28 }) }) : h('div', {
        class: 'ds-file-grid' + (isThumb ? ' ds-file-grid-thumb' : '') + (refreshing ? ' is-refreshing' : ''),
        role: 'group', 'aria-label': 'files', tabindex: '0',
        'aria-busy': refreshing ? 'true' : 'false',
        // Always concrete (webjsx's attribute diff can leave a null-valued
        // attribute unset when toggling away from the default).
        'data-density': density || 'list',
        onkeydown: onKeyDown, ...gridAttrs },
        ...visible.map((f, i) => isThumb
            ? FileCell({
                key: f.path || f.name + i, f,
                selectable, selected: selSet.has(entryKeyOf(f)),
                onToggleSelect: onMark ? (opts) => onMark(f, opts) : null,
                onOpen,
                thumb: (thumbUrl && f.type === 'image') ? thumbUrl(f) : null,
            })
            : FileRow({
                key: f.path || f.name + i,
                name: f.name, type: f.type, size: f.size, modified: f.modified, code: f.code, active: f.active,
                permissions: f.permissions, locked: f.locked,
                actions: actions != null ? actions : undefined,
                busy: busy != null ? !!busy : !!f.busy,
                selectable, selected: selSet.has(entryKeyOf(f)),
                onToggleSelect: onMark ? (opts) => onMark(f, opts) : null,
                onOpen: onOpen ? () => onOpen(f) : null,
                onAction: onAction ? (act) => onAction(act, f) : null
            }))
    );
    // A count + "show more" affordance so a capped large dir reads as "more
    // exist", not "this is everything". aria-live announces the shown/total.
    const more = capped
        ? h('div', { class: 'ds-file-more' },
            h('span', { class: 'ds-file-more-count', role: 'status', 'aria-live': 'polite' },
                'showing ' + visible.length + ' of ' + files.length),
            onShowMore ? h('button', { type: 'button', class: 'ds-file-more-btn',
                onclick: () => onShowMore(Math.min(files.length, limit + FILE_GRID_CAP)) },
                'show ' + Math.min(FILE_GRID_CAP, files.length - limit) + ' more') : null)
        : null;
    return (controls || more)
        ? h('div', { class: 'ds-file-listing' }, controls, grid, more)
        : grid;
}
