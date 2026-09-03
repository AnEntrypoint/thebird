// The three non-chat channel content views — ThreadPanel, ForumView, and the
// sanitized-HTML PageView — plus the shared relative-time and list-skeleton
// helpers they render through.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { sanitizeHtml } from '../../markdown.js';
const h = webjsx.createElement;

// Clamp a count to a compact badge string (matches the rail's 99+ convention),
// so a runaway number never blows out a fixed-width badge or item row.
const clampCount = (n) => { const v = Number(n) || 0; return v > 99 ? '99+' : String(v); };

function fmtRelTime(ts) {
    const t = Number(ts) || 0;
    if (!t) return '';
    const ms = t > 1e12 ? t : t * 1000;
    const d = Math.max(0, Date.now() - ms);
    const m = Math.floor(d / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const hr = Math.floor(m / 60);
    if (hr < 24) return hr + 'h';
    return Math.floor(hr / 24) + 'd';
}

// Skeleton rows for a cold thread/post-list load. Two lines per row (title +
// meta) mirrors cm-tp-item/cm-forum-item's actual shape so the shimmer
// doesn't jump on load. Reuses the kit-wide .ds-skel shimmer primitive.
function ListSkeleton({ cls, rows = 5 } = {}) {
    return h('div', { class: cls + ' cm-list-skeleton', 'aria-hidden': 'true' },
        ...Array.from({ length: rows }, (_, i) => h('div', { key: 'lsk' + i, class: 'cm-list-item-skeleton' },
            h('span', { class: 'ds-skel ds-skel-title' }), h('span', { class: 'ds-skel ds-skel-meta' }))));
}

export function ThreadPanel({ threads = [], activeId = null, title = 'Threads', onSelect, onCreate, onClose, loading = false } = {}) {
    const list = Array.isArray(threads) ? threads : [];
    return h('div', { class: 'cm-thread-panel', role: 'complementary', 'aria-label': title },
        h('div', { class: 'cm-tp-head' },
            h('span', { class: 'cm-tp-title' }, title),
            h('div', { class: 'cm-tp-head-actions' },
                onCreate ? h('button', { type: 'button', class: 'cm-tp-new', 'aria-label': 'new thread', title: 'New thread', onclick: onCreate }, '+') : null,
                onClose ? h('button', { type: 'button', class: 'cm-tp-close', 'aria-label': 'close', title: 'Close', onclick: onClose }, Icon('x')) : null
            )
        ),
        loading ? ListSkeleton({ cls: 'cm-tp-list' }) : h('div', { class: 'cm-tp-list' },
            list.length
                ? list.map(t => h('button', {
                    type: 'button', key: 'tp-' + t.id,
                    class: 'cm-tp-item' + (t.id === activeId ? ' is-active' : '') + (t.unread ? ' is-unread' : ''),
                    onclick: () => onSelect && onSelect(t.id)
                },
                    t.unread ? h('span', { class: 'cm-tp-dot', 'aria-hidden': 'true' }) : null,
                    h('span', { class: 'cm-tp-item-title' }, t.title || '(untitled)'),
                    t.lastMessage ? h('span', { class: 'cm-tp-item-snippet' }, t.lastMessage) : null,
                    h('span', { class: 'cm-tp-item-meta' },
                        t.author ? h('span', { class: 'cm-tp-item-author' }, t.author) : null,
                        t.time ? h('span', { class: 'cm-tp-item-time' }, fmtRelTime(t.time)) : null
                    )
                ))
                : h('div', { class: 'cm-tp-empty', role: 'status' },
                    Icon('thread', { size: 20 }),
                    h('span', { class: 'cm-tp-empty-text' }, onCreate ? 'no threads yet — start one' : 'no threads yet'))
        )
    );
}

export function ForumView({ posts = [], onSearch, onSort, onSelect, onNewPost, loading = false } = {}) {
    const list = Array.isArray(posts) ? posts : [];
    return h('div', { class: 'cm-forum', role: 'region', 'aria-label': 'forum' },
        h('div', { class: 'cm-forum-toolbar' },
            h('input', {
                type: 'search', class: 'cm-forum-search', placeholder: 'Search posts…',
                'aria-label': 'search posts',
                oninput: onSearch ? (e) => onSearch(e.target.value) : null
            }),
            h('select', {
                class: 'cm-forum-sort', 'aria-label': 'sort posts',
                onchange: onSort ? (e) => onSort(e.target.value) : null
            },
                h('option', { value: 'recent' }, 'Recent'),
                h('option', { value: 'replies' }, 'Most replies'),
                h('option', { value: 'oldest' }, 'Oldest')
            ),
            onNewPost ? h('button', { type: 'button', class: 'cm-forum-new', onclick: onNewPost }, 'New post') : null
        ),
        loading ? ListSkeleton({ cls: 'cm-forum-list' }) : h('div', { class: 'cm-forum-list' },
            list.length
                ? list.map(p => h('button', {
                    type: 'button', key: 'fp-' + p.id, class: 'cm-forum-item',
                    onclick: () => onSelect && onSelect(p.id)
                },
                    h('div', { class: 'cm-forum-item-head' },
                        h('span', { class: 'cm-forum-item-title' }, p.title || '(untitled)'),
                        h('span', { class: 'cm-forum-item-replies' }, clampCount(p.replyCount), Icon('chevron-right', { size: 13 }))
                    ),
                    p.snippet ? h('div', { class: 'cm-forum-item-snippet' }, p.snippet) : null,
                    h('div', { class: 'cm-forum-item-meta' },
                        p.author ? h('span', { class: 'cm-forum-item-author' }, p.author) : null,
                        p.time ? h('span', { class: 'cm-forum-item-time' }, fmtRelTime(p.time)) : null,
                        Array.isArray(p.tags) && p.tags.length
                            ? h('span', { class: 'cm-forum-item-tags' }, ...p.tags.map((tag, i) =>
                                h('span', { class: 'cm-forum-tag', key: 'tg-' + i }, tag)))
                            : null
                    )
                ))
                : h('div', { class: 'cm-forum-empty', role: 'status' },
                    Icon('forum', { size: 20 }),
                    h('span', { class: 'cm-forum-empty-text' }, onNewPost ? 'no posts yet — start the discussion' : 'no posts yet'))
        )
    );
}

export function PageView({ title = '', html = '', author = '', updatedAt = 0, isAdmin = false, onEdit } = {}) {
    return h('div', { class: 'cm-page', role: 'document' },
        h('div', { class: 'cm-page-head' },
            h('div', { class: 'cm-page-head-title' },
                h('h1', { class: 'cm-page-title' }, title || ''),
                (author || updatedAt) ? h('div', { class: 'cm-page-meta' },
                    author ? h('span', { class: 'cm-page-author' }, author) : null,
                    updatedAt ? h('span', { class: 'cm-page-time' }, fmtRelTime(updatedAt)) : null
                ) : null
            ),
            isAdmin && onEdit ? h('button', { type: 'button', class: 'cm-page-edit', onclick: onEdit }, 'Edit') : null
        ),
        h('div', {
            class: 'cm-page-body',
            // Page bodies are host/user-authored HTML, so they pass through the
            // DOMPurify gate before innerHTML — never injected raw (stored-XSS gate).
            ref: (el) => {
                if (!el) return;
                if (!html) { el.innerHTML = '<p class="cm-page-empty">This page is empty.</p>'; return; }
                sanitizeHtml(html).then((clean) => { el.innerHTML = clean; }).catch((e) => { console.error('sanitizeHtml failed:', e); el.innerHTML = '<p class="cm-page-empty">This page could not be rendered.</p>'; });
            }
        })
    );
}
