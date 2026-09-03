// LiveCursorOverlay + RemoteSelectionRings + RecentEditHighlightFlash — the
// real-time multiplayer layer: remote collaborators' pointer positions, text
// selections, and just-edited regions. No existing precedent in this kit
// (community/presence.js is Discord-style voice/member presence, a different
// shape entirely) — these three are full-bleed overlays meant to sit inside
// a positioned editor/canvas container, `pointer-events: none` throughout so
// they never intercept the local user's own input.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

// LiveCursorOverlay({ cursors }) — cursors: [{ userId, x, y, color, label }]
export function LiveCursorOverlay({ cursors = [] } = {}) {
    return h('div', { class: 'ds-collab-cursor-overlay', 'aria-hidden': 'true' },
        ...cursors.map((c) => h('div', {
            key: c.userId, class: 'ds-collab-cursor', style: `left:${c.x}px;top:${c.y}px;color:${c.color}`,
        },
            Icon('cursor', { size: 18 }),
            c.label ? h('span', { class: 'ds-collab-cursor-label', style: `background:${c.color}` }, c.label) : null)));
}

// LiveCursorOverlay above takes FLAT `x`/`y`, so a caller reasonably passes the
// same flat shape here — and `s.rect.left` on a flat object throws a bare
// TypeError during synchronous mount, which blanks the WHOLE kit rather than one
// specimen. Accept either shape, and if neither is present fail loudly naming
// the offending entry, per the fail-fast-with-exact-state invariant.
function rectOf(entry, component) {
    const r = entry.rect || entry;
    const has = (v) => typeof v === 'number' && Number.isFinite(v);
    const left = has(r.left) ? r.left : r.x;
    const top = has(r.top) ? r.top : r.y;
    if (!has(left) || !has(top) || !has(r.width) || !has(r.height)) {
        throw new Error(`${component}: entry needs {rect:{top,left,width,height}} or flat {x,y,width,height}; got ${JSON.stringify(entry)}`);
    }
    return { left, top, width: r.width, height: r.height };
}

// RemoteSelectionRings({ selections }) — selections: [{ userId, rect: {top,left,width,height}, color }]
// A flat { x, y, width, height } entry is accepted too, matching LiveCursorOverlay.
export function RemoteSelectionRings({ selections = [] } = {}) {
    return h('div', { class: 'ds-collab-selection-overlay', 'aria-hidden': 'true' },
        ...selections.map((s) => {
            const r = rectOf(s, 'RemoteSelectionRings');
            return h('div', {
                key: s.userId,
                class: 'ds-collab-selection-ring',
                style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--ring-color:${s.color}`,
            });
        }));
}

// RecentEditHighlightFlash({ edits }) — edits: [{ rect, color, timestamp }]
// A flat { x, y, width, height } entry is accepted too, matching LiveCursorOverlay.
// Brief fade-out background flash per recently-edited region. Reduced-motion
// users get an instant flash with no animation (the `ds-no-anim` modifier
// class, toggled off any transition/animation in CSS) instead of a fade.
export function RecentEditHighlightFlash({ edits = [] } = {}) {
    return h('div', { class: 'ds-collab-flash-overlay', 'aria-hidden': 'true' },
        ...edits.map((e, i) => {
            const r = rectOf(e, 'RecentEditHighlightFlash');
            return h('div', {
                key: e.timestamp != null ? String(e.timestamp) + i : i,
                class: 'ds-collab-flash',
                style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--flash-color:${e.color}`,
            });
        }));
}
