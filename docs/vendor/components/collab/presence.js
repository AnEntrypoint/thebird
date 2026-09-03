// AgentPresenceChip + PresenceBar — small avatar-chip-in-a-row collaborator
// presence, generalized from community/presence.js's Discord-style VoiceUser/
// MemberItem chips (same avatar-circle-with-initial + name-label shape, same
// --avatar-bg custom-property color hook) but for arbitrary collaborator
// identity rather than voice/member semantics specifically — prefixed
// ds-collab-chip (not cm-*) since this is a conceptually different feature
// living in its own group.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { avatarInitial } from '../content.js';
const h = webjsx.createElement;

// AgentPresenceChip({ userId, label, color, status })
//   status: 'active' | 'idle' | 'offline' — mirrors MemberItem's status dot.
export function AgentPresenceChip({ userId, label, color, status = 'active', key } = {}) {
    const initial = avatarInitial(label || userId);
    return h('div', { key, class: 'ds-collab-chip', title: label || userId },
        h('div', { class: 'ds-collab-chip-avatar', style: color ? `--avatar-bg:${color}` : null },
            h('span', { class: 'ds-collab-chip-status ds-collab-chip-status-' + status }),
            initial),
        h('span', { class: 'ds-collab-chip-name' }, label || userId));
}

// PresenceBar({ users }) — users: [{ userId, label, color, status }]
export function PresenceBar({ users = [] } = {}) {
    if (!users.length) return h('div', { class: 'ds-collab-bar ds-collab-bar-empty', role: 'status' }, 'no collaborators online');
    return h('div', { class: 'ds-collab-bar', role: 'group', 'aria-label': 'collaborators online' },
        ...users.map((u) => AgentPresenceChip({ ...u, key: u.userId })));
}
