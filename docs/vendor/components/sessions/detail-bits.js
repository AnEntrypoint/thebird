// Small session-detail chrome: the middot-separated metadata strip shown on a
// session detail surface, and the agent-picker loading skeleton.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// SessionMeta — a middot-separated metadata strip for a session detail surface.
//   items : [{ label, value, title, onCopy }]
// Each item is a span (label dimmed, value mono) with an optional per-item copy
// button; the strip flex-wraps at narrow widths. Class is .ds-session-meta-strip
// (the bare .ds-session-meta is already taken by ConversationList row meta).
export function SessionMeta({ items = [] } = {}) {
  if (!items.length) return null;
  return h('div', { class: 'ds-session-meta-strip', role: 'group', 'aria-label': 'session metadata' },
    ...items.map((it, i) => h('span', {
      key: 'sm-' + (it.label != null ? it.label : i),
      class: 'ds-session-meta-item',
      title: it.title || null,
    },
      [
        it.label != null ? h('span', { key: 'l', class: 'ds-session-meta-label' }, it.label) : null,
        h('span', { key: 'v', class: 'ds-session-meta-value' }, it.value != null ? String(it.value) : ''),
        it.onCopy ? h('button', {
          key: 'c', type: 'button', class: 'ds-session-meta-copy',
          'aria-label': 'copy ' + (it.title || it.label || 'value'),
          onclick: () => it.onCopy(it.value),
        }, 'copy') : null,
        // Generic secondary action (e.g. a directory row's "use as chat cwd")
        // - kept distinct from onCopy since a fact can want a non-copy action,
        // or (rare) both.
        it.onAction ? h('button', {
          key: 'a', type: 'button', class: 'ds-session-meta-action',
          onclick: () => it.onAction(it.value),
        }, it.actionLabel || 'use') : null,
      ].filter(Boolean))));
}

// AgentListSkeleton — placeholder shimmer rows shown while the agent picker's
// list is loading, so it doesn't flash from a bare spinner to a full list
// (same predictable-perceived-perf pattern as FileSkeleton). `rows` controls
// how many ghost rows render; each mimics a Row's icon+title+meta footprint.
export function AgentListSkeleton({ rows = 5 } = {}) {
  return h('div', { class: 'ds-agent-list-skeleton', 'aria-hidden': 'true' },
    ...Array.from({ length: Math.max(1, rows) }, (_, i) => h('div', { key: 'ags' + i, class: 'ds-agent-row-skeleton' },
      h('span', { class: 'ds-skel ds-skel-icon' }),
      h('span', { class: 'ds-skel ds-skel-title' }),
      h('span', { class: 'ds-skel ds-skel-meta' }))),
    h('span', { key: 'st', class: 'ds-agent-list-skeleton-status', role: 'status', 'aria-live': 'polite' }, 'loading agents…'));
}
