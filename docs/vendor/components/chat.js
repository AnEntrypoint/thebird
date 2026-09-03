// Chat surface — matches upstream signatures (parts, typing, reactions,
// receipts, aicat). Pure factories — props in, vnode out.
// Includes ChatMessage, ChatComposer, Chat, AICat, AICatPortrait.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./chat/, and the public export surface here is unchanged
// — no consumer import needs to move.

import { fmtFileSize } from './files.js';
import { safeUrl as sharedSafeUrl, renderInline as sharedRenderInline, injectCodeCopy as sharedInjectCodeCopy } from './chat-message-parts.js';
import { hasSelectionInside, makeThreadAutoScroll } from './chat/thread-scroll.js';
import { ChatMessage } from './chat/message.js';
import { ChatComposer } from './chat/composer.js';
import { flashComposerNote } from './chat/composer-affordances.js';
import { Chat, AICat, AICatPortrait, ChatSuggestions, AICAT_FACE } from './chat/threads.js';
// Imported for its side effect: registers the 'chat' snapshot into the single
// window.__debug registry at module load, exactly as this file did before the
// split. Nothing here consumes the symbol directly.
import './chat/stats.js';

// ONE byte format across the kit: fmtFileSize (files.js) is canonical; the old
// divergent fmtBytes ('0.0 KB' for zero, no B tier) is gone — this alias keeps
// existing imports working while rendering the same string as the Files grid.
export const fmtBytes = fmtFileSize;

// safeUrl / renderInline now live in chat-message-parts.js (the shared
// message-part renderer both this file and agent-chat.js render parts
// through) — re-exported here under their original names so every existing
// consumer of chat.js's public API (components.js barrel, any host importing
// directly from './components/chat.js') keeps working unchanged.
export const safeUrl = sharedSafeUrl;
export const renderInline = sharedRenderInline;

// injectCodeCopy / MdNode / CodeNode / ToolCallNode / ThinkingNode /
// PART_RENDERERS all now live in chat-message-parts.js — the one dispatch
// table this file, agent-chat.js, and any future chat surface render message
// parts through. injectCodeCopy stays exported here (re-exported, same
// signature) since it was part of this file's public surface before the
// extraction, even though nothing in-repo imports it directly today.
export const injectCodeCopy = sharedInjectCodeCopy;

export {
    hasSelectionInside, makeThreadAutoScroll,
    ChatMessage,
    ChatComposer, flashComposerNote,
    Chat, AICat, AICatPortrait, ChatSuggestions, AICAT_FACE,
};
