// ConversationList — the persistent left-rail "Chats" column: grouped, flat,
// or parentSid-nested fork-tree rows, with inline rename, arm-then-confirm
// delete, search, and a load-more tail. Host-driven throughout (the kit stays
// stateless); styling lives in chat.css (.ds-session*).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { SearchInput } from '../content.js';
import { STATUS_WORD, STATUS_DISC } from './format.js';
const h = webjsx.createElement;

/**
 * The Claude-Desktop "Chats" column. Sessions grouped by a caller-supplied
 * group label, each row showing title/project, relative time, agent badge,
 * and a running/new-event indicator. Selecting a row switches the active
 * conversation.
 *
 * @param {Object} [props]
 * @param {Array<{sid:*, title?:string, project?:string, agent?:string, time?:string, running?:boolean, unread?:boolean, rail?:string, parentSid?:*}>} [props.sessions=[]]
 * @param {*} [props.selected] - the active sid.
 * @param {Array<{label:string, sids:Array<*>}>} [props.groups] - OPTIONAL buckets for the rows; else one flat list.
 * @param {{value:string, onInput:Function, placeholder?:string}} [props.search] - inline filter (optional).
 * @param {Function} [props.onSelect] - onSelect(session).
 * @param {Function} [props.onNew] - onNew().
 * @param {string} [props.emptyText='No conversations yet']
 * @param {boolean} [props.loading=false]
 * @param {*} [props.error=null]
 * @param {boolean} [props.tree=false] - OPTIONAL: nest rows whose `parentSid` matches
 *   another row's `sid` under that row (fork/branch tree), with an indent guide,
 *   a branch glyph, and a per-node collapse toggle. Ignored when `groups` is set
 *   (grouping and tree-nesting are mutually exclusive row layouts). `expanded`/
 *   `onToggleExpand` are host-driven (kit stays stateless): a `sid` NOT present
 *   in the `expanded` Set renders collapsed once it has children.
 * @param {Set<*>|Array<*>} [props.expanded] - sids whose children are shown, when `tree`.
 * @param {Function} [props.onToggleExpand] - onToggleExpand(sid), when `tree`.
 * @param {Function} [props.onRename] - onRename(session, newTitle). Presence enables the
 *   hover-revealed rename action (row becomes an inline text input while active).
 * @param {*} [props.renaming] - sid of the row currently in rename-edit mode (host-driven).
 * @param {Function} [props.onStartRename] - onStartRename(session) - fired by the rename
 *   button click, before `onRename` commits; host flips `renaming` to this sid.
 * @param {Function} [props.onCancelRename] - onCancelRename() - Escape / blur-without-change.
 * @param {Function} [props.onDelete] - onDelete(session). Presence enables the hover-revealed
 *   delete action; clicking it arms an inline two-button confirm row (same height, no modal),
 *   mirroring SessionDashboard's arm-then-confirm stop control.
 * @param {*} [props.confirmingDelete] - sid currently showing the armed delete-confirm state.
 * @param {Function} [props.onArmDelete] - onArmDelete(session) - first delete click.
 * @param {Function} [props.onCancelDelete] - onCancelDelete() - confirm-row Cancel click.
 * @returns {*} webjsx vnode
 */
export function ConversationList({ sessions = [], selected, groups, search, caption,
                                   onSelect, onNew, newLabel = 'New chat',
                                   emptyText = 'No conversations yet', loading = false, error = null,
                                   loadingText = 'Loading conversations…',
                                   // hasMore/onLoadMore: the rail's host truncates the underlying
                                   // session list at some limit (a 200+ conversation user would
                                   // otherwise never reach older sessions) - mirrors the History
                                   // tab's existing "load N older" EventList pattern.
                                   hasMore = false, onLoadMore, loadMoreLabel = 'load more conversations',
                                   // resultCount: forwarded straight through to the inner SearchInput's
                                   // aria-live region, so a real "N results" string (computed by the
                                   // host from its filtered session list) reaches AT users instead of
                                   // the region sitting permanently empty.
                                   resultCount,
                                   // Fork/branch tree nesting (parentSid-driven), inline rename,
                                   // inline delete — all host-driven, kit stays stateless.
                                   tree = false, expanded, onToggleExpand,
                                   onRename, renaming, onStartRename, onCancelRename,
                                   onDelete, confirmingDelete, onArmDelete, onCancelDelete } = {}) {
  const expSet = expanded instanceof Set ? expanded : new Set(expanded || []);
  // childrenBySid: only consulted when `tree` is on - a flat caller pays nothing.
  const childrenBySid = new Map();
  if (tree) {
    for (const s of sessions) {
      if (s.parentSid == null) continue;
      if (!childrenBySid.has(s.parentSid)) childrenBySid.set(s.parentSid, []);
      childrenBySid.get(s.parentSid).push(s);
    }
  }
  const isRenaming = (s) => renaming != null && s.sid === renaming;
  const isConfirmingDelete = (s) => confirmingDelete != null && s.sid === confirmingDelete;

  const rowFor = (s, i, depth = 0) => {
    const hasKids = tree && childrenBySid.has(s.sid) && childrenBySid.get(s.sid).length > 0;
    const kidsOpen = hasKids && expSet.has(s.sid);
    const renamingThis = onRename && isRenaming(s);
    const confirmingThis = onDelete && isConfirmingDelete(s);
    let content;
    if (confirmingThis) {
      // Inline confirm: same row height, no modal - mirrors SessionDashboard's
      // arm-then-confirm bulk-stop control so delete has one consistent shape
      // across the kit.
      content = [
        h('span', { key: 'cd-msg', class: 'ds-session-confirm-msg' }, 'Delete "' + (s.title || s.project || s.sid || '') + '"?'),
        h('span', { key: 'cd-acts', class: 'ds-session-confirm-actions' }, [
          h('button', { key: 'cd-yes', type: 'button', class: 'ds-session-confirm-delete',
            onclick: (e) => { e.stopPropagation(); onDelete(s); } }, 'delete'),
          h('button', { key: 'cd-no', type: 'button', class: 'ds-session-confirm-cancel',
            onclick: (e) => { e.stopPropagation(); onCancelDelete && onCancelDelete(); } }, 'cancel'),
        ]),
      ];
    } else if (renamingThis) {
      content = [
        h('input', {
          key: 'rn-input', class: 'ds-session-rename-input', type: 'text',
          value: s.title || '', autofocus: true,
          onclick: (e) => e.stopPropagation(),
          onkeydown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); onRename(s, e.target.value); }
            if (e.key === 'Escape') { e.preventDefault(); onCancelRename && onCancelRename(); }
          },
          onblur: (e) => onRename(s, e.target.value),
        }),
      ];
    } else {
      content = [
        hasKids ? h('button', {
          key: 'tog', type: 'button', class: 'ds-session-tree-toggle' + (kidsOpen ? ' open' : ''),
          'aria-label': (kidsOpen ? 'collapse' : 'expand') + ' forks', 'aria-expanded': kidsOpen ? 'true' : 'false',
          onclick: (e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(s.sid); },
        }, Icon('chevron-right', { size: 10 })) : null,
        depth > 0 ? h('span', { key: 'fork', class: 'ds-session-fork-icon', 'aria-hidden': 'true' }, Icon('corner-up-left', { size: 10 })) : null,
        h('span', { key: 'main', class: 'ds-session-main' }, [
          // Two-sided truncation: the CSS ellipsis is paired with a title= carrying
          // the full string, so a long title/project is recoverable on hover.
          h('span', { class: 'ds-session-title', title: s.title || s.project || s.sid || null }, s.title || s.project || s.sid || ''),
          (s.project || s.time) ? h('span', { class: 'ds-session-sub', title: s.project || null },
            [s.project, s.time].filter(Boolean).join(' · ')) : null,
        ].filter(Boolean)),
        h('span', { key: 'meta', class: 'ds-session-meta' }, [
          s.agent ? h('span', { class: 'ds-session-agent' }, s.agent) : null,
          // Optional richer status ('error'|'stale'|'running'|'stopping') mirrors the
          // SessionCard STATUS_DISC mapping used on the Live dashboard, so a session
          // pinned to a "Running" rail group reads the same stuck-vs-busy signal it
          // does there rather than only a boolean live dot. Falls back to the plain
          // running dot when no status is supplied (existing callers unaffected).
          s.status
            ? h('span', { class: 'status-dot-disc ' + (STATUS_DISC[s.status] || 'status-dot-live'), 'aria-label': STATUS_WORD[s.status] || s.status, role: 'img' })
            : s.running
            ? h('span', { class: 'status-dot-disc status-dot-live', 'aria-label': 'running', role: 'img' })
            : (s.unread ? h('span', { class: 'ds-session-unread', 'aria-label': 'new activity', role: 'img' }) : null),
        ].filter(Boolean)),
        (onRename || onDelete) ? h('span', { key: 'row-actions', class: 'ds-session-row-actions' }, [
          onRename ? h('button', { key: 'ra-rn', type: 'button', class: 'ds-session-row-action', 'aria-label': 'rename',
            onclick: (e) => { e.stopPropagation(); onStartRename ? onStartRename(s) : onRename(s, s.title); } }, Icon('pencil', { size: 12 })) : null,
          onDelete ? h('button', { key: 'ra-del', type: 'button', class: 'ds-session-row-action ds-session-row-action-danger', 'aria-label': 'delete',
            onclick: (e) => { e.stopPropagation(); onArmDelete ? onArmDelete(s) : onDelete(s); } }, Icon('trash', { size: 12 })) : null,
        ].filter(Boolean)) : null,
      ].filter(Boolean);
    }
    const row = h('div', {
      // Stable key: prefer sid, else position - a missing/duplicate sid would make
      // key undefined and crash webjsx applyDiff ("reading 'key'" of undefined).
      key: 'cs-' + (s.sid != null ? s.sid : 'i' + i),
      role: 'option',
      tabindex: s.sid === selected ? '0' : '-1',
      class: 'ds-session-row' + (s.sid === selected ? ' active' : '') + (s.rail ? ' rail-' + s.rail : '') +
        (depth > 0 ? ' ds-session-row-nested' : ''),
      style: depth > 0 ? ('padding-left: calc(var(--space-2) + ' + (depth * 16) + 'px)') : null,
      'aria-selected': s.sid === selected ? 'true' : 'false',
      onclick: (renamingThis || confirmingThis) ? null : () => onSelect && onSelect(s),
      onkeydown: (renamingThis || confirmingThis) ? null : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(s); } },
    }, ...content);
    if (!hasKids || !kidsOpen) return [row];
    // Depth-first flatten of open children keeps the caller-facing return shape
    // (an array of rows) identical whether tree nesting is on or off.
    const kidRows = childrenBySid.get(s.sid)
      .slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''))
      .flatMap((k, ki) => rowFor(k, ki, depth + 1));
    return [row, ...kidRows];
  };

  // The body is ALWAYS a single keyed wrapper element of the same tag, so webjsx
  // diffs its children across state transitions (loading -> empty -> populated)
  // instead of swapping the container type - the swap is what triggered the
  // applyDiff "reading 'key'" crash on the first populated mount. Row children
  // are uniformly keyed; non-row states render a single unkeyed status line.
  let inner;
  if (loading && !sessions.length) {
    // Shape-matched skeleton rows during the cold ccsniff index walk (the rail
    // showed a bare line before) - Claude-Desktop skeletons its sidebar on load.
    inner = [
      h('div', { key: 'st', class: 'ds-session-state', role: 'status', 'aria-live': 'polite' }, loadingText),
      ...Array.from({ length: 5 }, (_, i) => h('div', { key: 'sk' + i, class: 'ds-session-row-skeleton', 'aria-hidden': 'true' },
        h('div', { class: 'ds-skel ds-skel-title' }), h('div', { class: 'ds-skel ds-skel-meta' }))),
    ];
  } else if (error) {
    inner = [h('div', { key: 'st', class: 'ds-session-state ds-session-state-error', role: 'status' }, String(error))];
  } else if (!sessions.length) {
    inner = [h('div', { key: 'st', class: 'ds-session-state', role: 'status' }, emptyText)];
  } else if (groups && groups.length) {
    const bySid = new Map(sessions.map((s) => [s.sid, s]));
    inner = groups.map((g) => h('div', { key: 'g-' + g.label, class: 'ds-session-group', role: 'group', 'aria-label': g.label },
      h('div', { key: 'gl', class: 'ds-session-group-label' }, g.label),
      h('div', { key: 'gr', class: 'ds-session-group-rows', role: 'listbox', 'aria-label': g.label }, ...g.sids.map((sid) => bySid.get(sid)).filter(Boolean).flatMap((s, i) => rowFor(s, i)))));
  } else if (tree) {
    // Roots = rows with no parentSid, or whose parentSid isn't present in this
    // list (an orphaned fork - the ancestor was deleted/filtered out) - each
    // root's flatMap already walks its open descendants via rowFor's recursion.
    const sidSet = new Set(sessions.map((s) => s.sid));
    const roots = sessions.filter((s) => s.parentSid == null || !sidSet.has(s.parentSid));
    inner = roots.flatMap((s, i) => rowFor(s, i, 0));
  } else {
    inner = sessions.flatMap((s, i) => rowFor(s, i));
  }
  // The load-more row sits INSIDE the scrollable list body (not the outer
  // .ds-sessions shell) so it scrolls with the rows it extends, matching
  // where a user's eye already is after scrolling to the bottom of the rail.
  const loadMoreRow = (hasMore && onLoadMore && sessions.length)
    ? h('button', { key: 'loadmore', type: 'button', class: 'ds-session-loadmore', onclick: onLoadMore }, loadMoreLabel)
    : null;
  const body = h('div', { key: 'body', class: 'ds-session-list', role: 'listbox', 'aria-label': caption || 'Conversations' },
    ...inner, loadMoreRow);

  return h('div', { class: 'ds-sessions' },
    h('div', { key: 'head', class: 'ds-session-head' },
      onNew ? h('button', { key: 'new', type: 'button', class: 'ds-session-new', onclick: onNew, 'aria-label': newLabel },
        Icon('pencil'), h('span', { key: 'l' }, newLabel)) : null,
      search ? SearchInput({
        key: 'search', value: search.value || '',
        label: search.placeholder || 'Search conversations',
        placeholder: search.placeholder || 'Search conversations',
        onInput: (v) => search.onInput && search.onInput(v),
        resultCount,
      }) : null),
    // Per-tab caption telling the user what selecting a row does on this surface
    // (chat = resume the conversation, history = browse its events) so visually
    // identical rows are disambiguated.
    caption ? h('div', { key: 'cap', class: 'ds-session-caption' }, caption) : null,
    body);
}
