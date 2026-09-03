// Community navigation: the server rail and the channel sidebar it selects
// into — ServerIcon / ServerRail, ChannelItem (with its voice state and
// participant strip), ChannelCategory, and the composed ChannelSidebar.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { Avatar, avatarInitial, avatarContrastFg } from '../content.js';
import { UserPanel } from './presence.js';
const h = webjsx.createElement;

// Channel-type -> line-icon name, shared by ChannelItem and MobileHeader.
export const CHANNEL_ICON_FOR = { voice: 'speaker', forum: 'forum', threaded: 'thread', announcement: 'megaphone', page: 'page', thread: 'thread', text: 'hash' };

export function ServerIcon({ id, name, icon, active, badge, onClick } = {}) {
    return h('div', {
        class: 'cm-server-icon' + (active ? ' active' : ''),
        onclick: onClick,
        role: 'button',
        'aria-label': name,
        'aria-pressed': active ? 'true' : 'false',
        tabindex: '0',
        'data-id': id,
        onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick && onClick(e);
            }
        }
    },
        h('span', { class: 'cm-server-pill' }),
        icon ? h('img', { src: icon, alt: name }) : Avatar({ name, shape: 'square', initialsCount: 2 }),
        badge ? h('span', { class: 'cm-server-badge' }, badge > 99 ? '99+' : String(badge)) : null
    );
}

export function ServerRail({ servers = [], activeId, onSelect, onAdd } = {}) {
    return h('div', { class: 'cm-server-rail', role: 'navigation', 'aria-label': 'servers' },
        h('a', { class: 'cm-server-back', href: '../', title: 'Back', 'aria-label': 'back' }, Icon('chevron-left')),
        h('div', { class: 'cm-server-sep', 'aria-hidden': 'true' }),
        ...servers.map(s => ServerIcon({ ...s, active: s.id === activeId, onClick: () => onSelect && onSelect(s.id) })),
        onAdd ? h('button', { class: 'cm-server-add', type: 'button', onclick: onAdd, title: 'Add server', 'aria-label': 'add server' }, '+') : null
    );
}

export function ChannelItem({ id, name, type = 'text', active, voiceActive, voiceConnecting, badge, draggable, actions = [], participants = [], onClick, onContext } = {}) {
    const ICON_FOR = CHANNEL_ICON_FOR;
    const icon = Icon(ICON_FOR[type] || 'hash', { size: 15 });
    const handleActionClick = (a, e) => { e.stopPropagation(); a.onClick && a.onClick(id, e); };
    return h('div', { class: 'cm-channel-item-wrap', 'data-channel-wrap': id, role: 'listitem' },
        h('div', {
            class: 'cm-channel-item' + (active ? ' active' : '') + (voiceActive ? ' voice-active' : '') + (voiceConnecting ? ' voice-connecting' : ''),
            'data-id': id,
            'data-type': type,
            draggable: draggable ? 'true' : null,
            onclick: onClick,
            oncontextmenu: (e) => { e.preventDefault(); onContext && onContext(id, e.clientX, e.clientY); },
            onkeydown: (e) => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onContext && onContext(id, rect.left, rect.top + rect.height);
                }
                if (draggable) {
                    if (e.ctrlKey && e.key === 'ArrowUp') {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent('reorder', { detail: { id, direction: 'up' } }));
                    }
                    if (e.ctrlKey && e.key === 'ArrowDown') {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent('reorder', { detail: { id, direction: 'down' } }));
                    }
                }
            },
            tabindex: '0',
            // NOT role="option": this is channel NAVIGATION, not a select-one
            // listbox — activating a row changes the view, and each row also
            // contains its own action buttons, which `option` forbids (its
            // children must be presentational). A link inside a list is the
            // structure a screen reader should announce, and the current
            // channel is conveyed by aria-current="page", the navigation
            // idiom, rather than aria-selected.
            role: 'link',
            'aria-current': active ? 'page' : null
        },
            h('span', { class: 'cm-ch-icon' + (voiceActive ? ' voice-active-badge' : ''), 'data-voice-active': voiceActive ? 'true' : null }, icon),
            voiceConnecting ? h('span', { class: 'cm-ch-spinner', title: 'Connecting…', 'aria-label': 'Connecting to voice channel…' }) : voiceActive ? h('span', { class: 'cm-ch-voice-badge', title: 'Voice active', 'aria-label': 'Voice channel active' }) : null,
            h('span', { class: 'cm-ch-name' }, name),
            badge ? h('span', { class: 'cm-ch-badge' }, badge > 99 ? '99+' : String(badge)) : null,
            actions.length ? h('div', { class: 'cm-ch-actions' },
                ...actions.map(a => h('button', {
                    class: 'cm-ch-action-btn',
                    title: a.title || '',
                    'data-action': a.id || '',
                    onclick: (e) => handleActionClick(a, e)
                }, a.icon || a.label || 'more'))
            ) : null
        ),
        voiceActive && participants.length ? h('div', { class: 'cm-ch-voice-users' },
            ...participants.map(p => h('div', { class: 'cm-ch-voice-user' + (p.speaking ? ' speaking' : '') },
                h('div', { class: 'cm-ch-voice-user-avatar', style: p.color ? (avatarContrastFg(p.color) ? `--avatar-bg:${p.color};--avatar-fg:${avatarContrastFg(p.color)}` : `--avatar-bg:${p.color}`) : null }, avatarInitial(p.identity)),
                h('span', { class: 'cm-ch-voice-user-name' }, p.identity)
            ))
        ) : null
    );
}

export function ChannelCategory({ id, name, channels = [], collapsed, activeId, onToggle, onAddChannel, onChannelClick, onChannelContext, onContextMenu, extraButton, channelDraggable } = {}) {
    return h('div', { class: 'cm-channel-category', 'data-category': id },
        h('div', {
            class: 'cm-category-header' + (collapsed ? ' collapsed' : ''),
            onclick: () => onToggle && onToggle(id),
            oncontextmenu: onContextMenu ? (e) => { e.preventDefault(); onContextMenu(id, e.clientX, e.clientY); } : null
        },
            h('span', { class: 'cm-cat-arrow' }, Icon('chevron-down')),
            h('span', { class: 'cm-cat-name' }, name),
            extraButton ? h('button', { class: 'cm-cat-extra', onclick: (e) => { e.stopPropagation(); extraButton.onClick && extraButton.onClick(id, e); }, 'aria-label': extraButton.title || 'Category action' }, extraButton.icon || extraButton.label || '+') : null,
            onAddChannel ? h('button', { class: 'cm-cat-add', onclick: (e) => { e.stopPropagation(); onAddChannel(id); }, 'aria-label': 'Add channel to ' + name }, '+') : null
        ),
        // role=list + role=listitem on each wrap: the channel rows are a real
        // list of navigation targets, so a screen reader announces position
        // and count ("3 of 7") instead of a flat run of links.
        collapsed ? null : h('div', { class: 'cm-cat-channels', role: 'list', 'aria-label': name + ' channels' },
            ...channels.map(c => ChannelItem({
                ...c,
                draggable: channelDraggable,
                active: c.id === activeId,
                onClick: () => onChannelClick && onChannelClick(c),
                onContext: onChannelContext
            }))
        )
    );
}

// Skeleton rows for a cold channel-list load — reuses the kit-wide .ds-skel
// shimmer primitive (sessions.js / files.js) rather than a bare spinner.
function ChannelListSkeleton({ rows = 6 } = {}) {
    return h('div', { class: 'cm-channel-list cm-channel-skeleton', 'aria-hidden': 'true' },
        ...Array.from({ length: rows }, (_, i) => h('div', { key: 'csk' + i, class: 'cm-channel-item-skeleton' },
            h('span', { class: 'ds-skel ds-skel-icon' }), h('span', { class: 'ds-skel ds-skel-title' }))));
}

export function ChannelSidebar({ serverName, channels = [], categories = [], activeId, collapsedCats, onChannelClick, onCategoryToggle, onAddChannel, onChannelContext, userPanelProps, loading = false } = {}) {
    const collapsed = collapsedCats || new Set();
    const uncategorized = channels.filter(c => !c.categoryId || !categories.find(cat => cat.id === c.categoryId));
    const sorted = [...categories].sort((a, b) => (a.position || 0) - (b.position || 0));
    return h('div', { class: 'cm-channel-sidebar' },
        h('div', { class: 'cm-server-header' },
            h('span', { class: 'cm-server-header-name' }, serverName || 'Server'),
        ),
        loading ? ChannelListSkeleton() : h('div', { class: 'cm-channel-list' },
            (sorted.length === 0 && uncategorized.length === 0)
                ? h('div', { class: 'cm-channel-empty', role: 'status' },
                    Icon('hash', { size: 20 }),
                    h('span', { class: 'cm-channel-empty-text' }, 'no channels yet — add one to get this server started'))
                : null,
            ...sorted.map(cat => ChannelCategory({
                id: cat.id,
                name: cat.name,
                channels: channels.filter(c => c.categoryId === cat.id).sort((a, b) => (a.position || 0) - (b.position || 0)),
                collapsed: collapsed.has && collapsed.has(cat.id),
                activeId,
                onToggle: onCategoryToggle,
                onAddChannel,
                onChannelClick,
                onChannelContext
            })),
            uncategorized.length ? ChannelCategory({
                id: 'uncategorized',
                name: 'CHANNELS',
                channels: uncategorized,
                activeId,
                onChannelClick,
                onChannelContext
            }) : null
        ),
        userPanelProps ? UserPanel(userPanelProps) : null
    );
}
