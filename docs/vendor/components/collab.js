// Collab — real-time multiplayer co-editing presence: live remote cursors,
// selection rings, recent-edit flashes, and a generalized collaborator
// presence chip/bar (visually related to community/presence.js's Discord-
// style voice/member chips but for arbitrary collaborator identity, not
// voice/member semantics). Group barrel over ./collab/*.js submodules,
// following the same group-barrel pattern as community.js/editor-primitives.js.

import { LiveCursorOverlay, RemoteSelectionRings, RecentEditHighlightFlash } from './collab/cursors.js';
import { AgentPresenceChip, PresenceBar } from './collab/presence.js';

export { LiveCursorOverlay, RemoteSelectionRings, RecentEditHighlightFlash, AgentPresenceChip, PresenceBar };
