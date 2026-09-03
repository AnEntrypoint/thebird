// Community surface — matches upstream signatures.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./community/, and the public export surface here is unchanged
// — no consumer import needs to move.

import { ServerIcon, ServerRail, ChannelItem, ChannelCategory, ChannelSidebar } from './community/navigation.js';
import { VoiceUser, UserPanel, MemberItem, MemberList, VoiceStrip } from './community/presence.js';
import { ChatHeader, MobileHeader, ReplyBar, Banner } from './community/chrome.js';
import { ThreadPanel, ForumView, PageView } from './community/views.js';
import { CommunityShell } from './community/shell.js';

export {
    ServerIcon, ServerRail, ChannelItem, ChannelCategory, ChannelSidebar,
    VoiceUser, UserPanel, MemberItem, MemberList, VoiceStrip,
    ChatHeader, MobileHeader, ReplyBar, Banner,
    ThreadPanel, ForumView, PageView,
    CommunityShell,
};
