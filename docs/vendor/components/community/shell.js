// CommunityShell — the four-column community frame: server rail, channel
// sidebar, main content column, member list, plus the floating voice strip.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { ServerRail, ChannelSidebar } from './navigation.js';
import { MemberList, VoiceStrip } from './presence.js';
const h = webjsx.createElement;

export function CommunityShell({ serverRailProps, sidebarProps, children, memberListProps, voiceStripProps } = {}) {
    return h('div', { class: 'cm-shell' },
        // Same skip-link + <main id="app-main"> contract AppShell() provides.
        // This shell is the AppShell alternative for the community layout, so
        // the kits built on it were the only ones in the repo with no main
        // landmark and no way for a keyboard user to get past the server rail
        // and channel sidebar — two full columns of links before any content.
        h('a', { href: '#app-main', class: 'skip-link' }, 'skip to main content'),
        serverRailProps ? ServerRail(serverRailProps) : null,
        sidebarProps ? ChannelSidebar(sidebarProps) : null,
        // <main>, not <div>: this is the content column. tabindex=0 for the
        // same reason AppShell uses it — the column scrolls, so it must be
        // reachable by Tab for a keyboard-only user to scroll it at all.
        h('main', { class: 'cm-main', id: 'app-main', tabindex: '0' }, ...(Array.isArray(children) ? children : [children])),
        memberListProps ? MemberList(memberListProps) : null,
        voiceStripProps ? VoiceStrip(voiceStripProps) : null
    );
}
