// Thin chrome bands around the main content column: the channel header, the
// narrow-viewport header with its menu/members toggles, the reply-quote bar,
// and the dismissible/actionable banner.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { CHANNEL_ICON_FOR } from './navigation.js';
const h = webjsx.createElement;

export function ChatHeader({ icon = '#', name, topic, toolbar = [] } = {}) {
    return h('div', { class: 'cm-chat-header' },
        h('span', { class: 'cm-chat-header-icon' }, icon),
        // h1, not span: this is already the visible title of the content column
        // — the channel you are reading. It carried no heading semantics, so
        // both community kits rendered a document with zero headings. An h1
        // here reuses the element that was always the page title rather than
        // adding a second, hidden one. .cm-chat-header-name pins weight/size/
        // colour and now also zeroes the UA h1 margin, so this is a semantic
        // change with no visual change.
        h('h1', { class: 'cm-chat-header-name' }, name),
        topic ? h('span', { class: 'cm-chat-header-topic' }, topic) : null,
        h('div', { class: 'cm-chat-header-toolbar' }, ...toolbar)
    );
}

export function MobileHeader({ title, channelType, channelName, onMenu, onMembers } = {}) {
    const ICON_FOR = CHANNEL_ICON_FOR;
    const titleNode = channelType
        ? [Icon(ICON_FOR[channelType] || 'hash', { size: 16 }), ' ' + (channelName || '')]
        : [title || ''];
    return h('div', { class: 'cm-mobile-header', role: 'banner' },
        h('button', {
            class: 'cm-mh-btn', type: 'button', onclick: onMenu,
            title: 'Menu', 'aria-label': 'open navigation menu'
        }, Icon('menu')),
        h('span', { class: 'cm-mh-title' }, ...titleNode),
        h('button', {
            class: 'cm-mh-btn', type: 'button', onclick: onMembers,
            title: 'Members', 'aria-label': 'show members'
        }, Icon('members'))
    );
}

export function ReplyBar({ quotedMessage, quotedAuthor, onCancel } = {}) {
    return h('div', { class: 'cm-reply-bar', role: 'status' },
        h('span', { class: 'cm-rb-label' }, 'Replying to ',
            h('strong', { class: 'cm-rb-author' }, quotedAuthor || 'unknown')
        ),
        h('span', { class: 'cm-rb-preview', title: quotedMessage || '' }, quotedMessage || ''),
        h('button', {
            class: 'cm-rb-cancel', type: 'button', onclick: onCancel,
            title: 'Cancel reply', 'aria-label': 'cancel reply'
        }, Icon('x'))
    );
}

export function Banner({ tone = 'info', message, visible, actionLabel, onAction, onClick } = {}) {
    if (!visible || !message) return null;
    return h('div', {
        class: 'cm-banner tone-' + tone + (onClick ? ' clickable' : ''),
        role: tone === 'error' || tone === 'warning' ? 'alert' : 'status',
        onclick: onClick || null
    },
        h('span', { class: 'cm-banner-msg' }, message),
        actionLabel ? h('button', {
            class: 'cm-banner-action', type: 'button',
            onclick: (e) => { e.stopPropagation(); onAction && onAction(e); }
        }, actionLabel) : null
    );
}
