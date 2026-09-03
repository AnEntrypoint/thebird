// ChatMinimap — a compact scroll-position overview for a long chat thread.
//
// Ported from pi-web's ChatMinimap.tsx (github.com/agegr/pi-web) behavior,
// reimplemented as a pure webjsx factory over this kit's own DOM-ref pattern
// (no React refs/hooks — a single `ref` callback owns measurement + listeners,
// matching makeThreadAutoScroll's shape in chat.js).
//
// What it does:
//   - Renders one dot per message that has visible text, positioned/spaced
//     proportionally to that message's real position within the thread's
//     scrollHeight (a message-density map, not a fixed-step list).
//   - Color-codes dots by role: user vs assistant (two tones, tokens only).
//   - Draws a viewport-position box (drag to scroll) reflecting scrollTop/
//     scrollHeight ratios, updated on the thread's own scroll events.
//   - Click (or drag) anywhere in the strip scrolls the thread so that point
//     maps to the equivalent scroll ratio.
//   - Hover reveals collision-resolved preview tooltips (message text, first
//     ~200 chars) to the left of the strip; the nearest dot to the cursor is
//     highlighted (scaled) while hovering.
//   - Re-measures on ResizeObserver (thread container + content) and on
//     message-count change (debounced), never synchronously in the scroll
//     handler — scroll only updates the (cheap) viewport ratio.
//
// Usage: mount inside the same flex row as the scrollable thread, e.g.
//   h('div', { class: 'chat-minimap-row' },
//     h('div', { class: 'chat-thread', ref: threadRef, ... }, ...),
//     ChatMinimap({ getThreadEl: () => threadEl, messages }))
//
// Props:
//   messages     : [{ role: 'user'|'assistant'|..., text?, content?, parts? }]
//                  — same shape chat.js/agent-chat.js already carry. Only
//                  'user'/'assistant' roles get a node; others are skipped
//                  (matches upstream, which only maps user/assistant).
//   getThreadEl  : () => HTMLElement | null — returns the live scroll
//                  container to observe/scroll. A getter (not the element
//                  itself) so the minimap can be built before the thread ref
//                  fires and still resolve the container lazily on measure.
//   getMessageEl : optional (index) => HTMLElement | null — returns the DOM
//                  node for message `index` (its top/height inside the
//                  thread drive the dot's position). Falls back to querying
//                  '[data-msg-index]' children of the thread element when
//                  omitted, so a host that tags its message rows with
//                  data-msg-index="N" needs no extra wiring.
//   width        : minimap strip width in px (default 36, matches upstream).
//
// This module is a barrel: the message-shape helpers, the imperative paint,
// and the component's own lifecycle live in single-responsibility submodules
// under ./chat-minimap/, and the public export surface here is unchanged —
// no consumer import needs to move.

import { ChatMinimap, CHAT_MINIMAP_WIDTH } from './chat-minimap/minimap.js';

export { ChatMinimap, CHAT_MINIMAP_WIDTH };
