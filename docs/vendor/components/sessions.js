// Session surfaces — a persistent conversation list (left-rail "Chats") and a
// live multi-session dashboard. Pure factories: props in, webjsx vnode out, all
// interaction via host callbacks. Styling lives in chat.css (.ds-session*,
// .ds-dash*) using kit tokens; no transport, no decorative glyphs.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./sessions/, and the public export surface here is unchanged
// — no consumer import needs to move.

import { fmtTime, fmtAgo, fmtDuration } from './sessions/format.js';
import { ConversationList } from './sessions/conversation-list.js';
import { SessionMeta, AgentListSkeleton } from './sessions/detail-bits.js';
import { SessionCard } from './sessions/session-card.js';
import { SessionDashboard } from './sessions/dashboard.js';

export {
    fmtTime, fmtAgo, fmtDuration,
    ConversationList,
    SessionMeta, AgentListSkeleton,
    SessionCard,
    SessionDashboard,
};
