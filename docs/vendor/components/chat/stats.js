// Chat-surface debug counters + the markdown/Prism cache warm-up, registered
// into the single `window.__debug` client-side registry. Kept in its own
// module so ChatMessage (which increments the counters) and the registration
// call in the barrel share one live object rather than two copies.

import { initializeCachesEagerly, getCacheStats } from '../../markdown-cache.js';
import { register } from '../../debug.js';
import { renderMessagePart as sharedRenderMessagePart } from '../chat-message-parts.js';

const _stats = { messages: 0, lastKindCounts: {} };
let _cacheInitialized = false;

// Eagerly warm the markdown + Prism caches on first chat-surface mount, once.
export function ensureCachesInit() {
    if (_cacheInitialized) return;
    _cacheInitialized = true;
    initializeCachesEagerly().catch((err) => console.warn('[247420] cache init error:', err));
}

export function countMessage() { _stats.messages += 1; }

// Thin wrapper around the shared renderer that keeps this file's own debug
// counter (_stats.lastKindCounts, surfaced via register('chat', ...) below)
// wired exactly as before. sharedRenderMessagePart already applies the
// 'p' + key VElement key itself.
export function renderPart(p, key) {
    return sharedRenderMessagePart(p, key, (kind) => {
        _stats.lastKindCounts[kind] = (_stats.lastKindCounts[kind] || 0) + 1;
    });
}

register('chat', () => ({
    messages: _stats.messages,
    lastKindCounts: { ..._stats.lastKindCounts },
    cacheStats: getCacheStats(),
}));
