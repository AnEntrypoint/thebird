// Shared message-PART renderer — the one place a single message's `parts`
// array ({kind, ...}) becomes DOM. Extracted out of chat.js so agent-chat.js
// (and any future chat surface) render text/code/image/markdown/tool parts
// through the exact same code path instead of a second hand-rolled copy.
//
// Pure factory surface: every export takes plain data in, returns a vnode (or
// void for the imperative copy-button wiring) — no module-level render state
// beyond the markdown/Prism cache singletons chat-cache.js already owns.
//
// This module is a barrel: the renderers live in single-responsibility
// submodules under ./chat-message-parts/ (inline utilities, the markdown/code
// prose nodes, the agent tool/thinking nodes, and the PART_RENDERERS dispatch
// table plus attachment kinds), and the public export surface here is
// unchanged — no consumer import needs to move.

import { safeUrl, renderInline, copyToClipboardWithFeedback, injectCodeCopy } from './chat-message-parts/inline.js';
import { PART_RENDERERS, renderMessagePart, renderMessageParts } from './chat-message-parts/renderers.js';

export {
    safeUrl, renderInline, copyToClipboardWithFeedback, injectCodeCopy,
    PART_RENDERERS, renderMessagePart, renderMessageParts,
};
