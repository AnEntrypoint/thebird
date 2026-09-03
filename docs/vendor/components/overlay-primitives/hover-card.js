// HoverCard — Popover composed with a delayed hover trigger. Wraps `trigger`
// in a span with pointerenter/pointerleave listeners that manage open state
// via a pair of setTimeout delays (open delay on enter, close delay on
// leave), clearing any pending timer before scheduling a new one so a quick
// re-enter cancels a pending close. Popover itself is controlled — this
// component owns the open/close timers and calls back into the caller so the
// caller can hold `open` in state (same controlled-component pattern as
// every other overlay in this group).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Popover } from './popover.js';
import { kids } from './floating.js';
const h = webjsx.createElement;

const _timers = new WeakMap();

function _clear(el) {
    const t = _timers.get(el);
    if (t) { clearTimeout(t.open); clearTimeout(t.close); }
}

// HoverCard({ trigger, content, open, onOpenChange, openDelay=700, closeDelay=300, placement, ariaLabel })
//   trigger      : a single webjsx VElement (e.g. a link or button) — the hover target.
//   content      : Popover children (rendered only while open).
//   open         : caller-owned boolean — HoverCard schedules onOpenChange(true/false)
//                  via the hover timers rather than holding its own state.
//   onOpenChange : callback(nextOpen) — required to actually see the card open.
// The wrapper span itself doubles as the Popover anchor element. Popover is
// imperative (it owns a WeakMap keyed on anchorEl and creates/tears down its
// own body-level node outside the webjsx diff), so it is invoked from the
// anchor's ref callback via queueMicrotask rather than inline during this
// declarative render pass — mirrors CommandPalette/EmojiPicker's own
// ref-then-queueMicrotask imperative-child pattern in this same group.
export function HoverCard({ trigger, content, open, onOpenChange, openDelay = 700, closeDelay = 300, placement = 'top', ariaLabel } = {}) {
    const child = kids(trigger)[0];
    if (!child) return null;
    const schedule = (el, kind, ms) => {
        _clear(el);
        const timers = _timers.get(el) || {};
        if (kind === 'open') timers.open = setTimeout(() => onOpenChange && onOpenChange(true), ms);
        else timers.close = setTimeout(() => onOpenChange && onOpenChange(false), ms);
        _timers.set(el, timers);
    };
    const runPopover = (el) => Popover({
        open: Boolean(open), anchorEl: el, onClose: () => onOpenChange && onOpenChange(false),
        placement, ariaLabel, children: content,
    });
    const anchorRef = (el) => {
        if (!el) return;
        queueMicrotask(() => runPopover(el));
        if (el._dsHoverCard) return;
        el._dsHoverCard = true;
        el.addEventListener('pointerenter', () => schedule(el, 'open', openDelay));
        el.addEventListener('pointerleave', () => schedule(el, 'close', closeDelay));
        el.addEventListener('focusin', () => schedule(el, 'open', openDelay));
        el.addEventListener('focusout', () => schedule(el, 'close', closeDelay));
    };
    return h('span', { class: 'ds-hovercard', ref: anchorRef },
        webjsx.createElement(child.type, { ...(child.props || {}) }, ...(child.children || [])));
}
