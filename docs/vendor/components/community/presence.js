// Who-is-here surfaces: the speaking-state voice user chip, the local user's
// own mic/deafen/settings panel, the member roster, and the connected-voice
// control strip.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { avatarInitial, avatarContrastFg } from '../content.js';
const h = webjsx.createElement;

function avatarStyle(color) {
    if (!color) return null;
    const fg = avatarContrastFg(color);
    return fg ? `--avatar-bg:${color};--avatar-fg:${fg}` : `--avatar-bg:${color}`;
}

export function VoiceUser({ identity, speaking, color } = {}) {
    const initial = avatarInitial(identity);
    return h('div', { class: 'cm-voice-user' + (speaking ? ' speaking' : '') },
        h('div', { class: 'cm-voice-user-avatar', style: avatarStyle(color) }, initial),
        h('span', { class: 'cm-voice-user-name' }, identity)
    );
}

export function UserPanel({ name, tag, color, muted, deafened, onMute, onDeafen, onSettings } = {}) {
    const initial = avatarInitial(name);
    const handleSettings = (e) => {
        e.preventDefault();
        if (onSettings) {
            // onSettings callback should open a drawer/modal with quick toggles
            onSettings({
                audioDevice: null, // controlled by consumer
                micOn: !muted,
                speakerOn: !deafened,
            });
        }
    };
    return h('div', { class: 'cm-user-panel' },
        h('div', { class: 'cm-user-avatar', style: avatarStyle(color) },
            h('span', { class: 'cm-user-status-dot' }),
            initial
        ),
        h('div', { class: 'cm-user-info' },
            h('div', { class: 'cm-user-name' }, name || 'You'),
            tag ? h('div', { class: 'cm-user-tag' }, tag) : null
        ),
        h('div', { class: 'cm-user-controls' },
            h('button', { class: 'cm-user-btn' + (muted ? ' muted' : ''), onclick: onMute, 'aria-label': muted ? 'Unmute microphone' : 'Mute microphone', 'aria-pressed': muted ? 'true' : 'false' }, Icon(muted ? 'mic-off' : 'mic')),
            h('button', { class: 'cm-user-btn' + (deafened ? ' deafened' : ''), onclick: onDeafen, 'aria-label': deafened ? 'Undeafen' : 'Deafen', 'aria-pressed': deafened ? 'true' : 'false' }, Icon(deafened ? 'speaker-off' : 'speaker')),
            h('button', { class: 'cm-user-btn', onclick: handleSettings, 'aria-label': 'Audio settings', title: 'Open audio settings' }, Icon('settings'))
        )
    );
}

export function MemberItem({ identity, name, color, status = 'online' } = {}) {
    const initial = avatarInitial(name || identity);
    return h('div', { class: 'cm-member-item' },
        h('div', { class: 'cm-member-avatar', style: avatarStyle(color) },
            h('span', { class: 'cm-member-status' + (status === 'online' ? ' online' : '') }),
            initial
        ),
        h('span', { class: 'cm-member-name' }, name || identity)
    );
}

// Skeleton rows for a cold member-list load, matching FileSkeleton/session
// skeleton shape (icon + title placeholder), never a bare spinner.
function MemberListSkeleton({ rows = 6 } = {}) {
    return h('div', { class: 'cm-member-list cm-member-skeleton open', 'aria-hidden': 'true' },
        ...Array.from({ length: rows }, (_, i) => h('div', { key: 'msk' + i, class: 'cm-member-item-skeleton' },
            h('span', { class: 'ds-skel ds-skel-icon' }), h('span', { class: 'ds-skel ds-skel-title' }))));
}

export function MemberList({ categories = [], open, loading = false } = {}) {
    if (loading) return MemberListSkeleton();
    const total = categories.reduce((n, cat) => n + (cat.members ? cat.members.length : 0), 0);
    return h('div', { class: 'cm-member-list' + (open ? ' open' : '') },
        total === 0
            ? h('div', { key: '_empty', class: 'cm-member-empty', role: 'status' },
                Icon('members', { size: 20 }),
                h('span', { class: 'cm-member-empty-text' }, 'no members in this channel yet'))
            : null,
        ...categories.flatMap(cat => [
            h('div', { class: 'cm-member-category', key: cat.label }, `${cat.label} — ${cat.members.length}`),
            ...cat.members.map((m, i) => MemberItem({ ...m, key: m.identity || i }))
        ])
    );
}

export function VoiceStrip({ channelName, status, muted, deafened, onMute, onDeafen, onLeave, open } = {}) {
    return h('div', { class: 'cm-voice-strip' + (open ? ' open' : ''), role: 'region', 'aria-label': 'voice controls' },
        h('div', { class: 'cm-vs-label' },
            h('span', { class: 'cm-vs-channel' }, Icon('speaker'), ' ' + (channelName || 'voice')),
            h('span', { class: 'cm-vs-status' }, status || 'connected')
        ),
        h('button', {
            class: 'cm-vs-btn', type: 'button', onclick: onMute,
            title: muted ? 'Unmute' : 'Mute',
            'aria-label': muted ? 'unmute microphone' : 'mute microphone',
            'aria-pressed': muted ? 'true' : 'false'
        }, Icon(muted ? 'mic-off' : 'mic')),
        h('button', {
            class: 'cm-vs-btn', type: 'button', onclick: onDeafen,
            title: deafened ? 'Undeafen' : 'Deafen',
            'aria-label': deafened ? 'undeafen' : 'deafen',
            'aria-pressed': deafened ? 'true' : 'false'
        }, Icon(deafened ? 'speaker-off' : 'speaker')),
        h('button', {
            class: 'cm-vs-btn danger', type: 'button', onclick: onLeave,
            title: 'Leave voice', 'aria-label': 'leave voice channel'
        }, Icon('x'))
    );
}
