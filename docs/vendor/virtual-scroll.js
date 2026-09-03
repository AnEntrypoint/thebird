// Windowed list virtualization for long message threads. Framework-agnostic:
// consumes a live scroll-container element + an items array, returns which
// index range to actually mount plus spacer heights for the rest, so a host
// component (chat.js's thread, freddie.js's chat page) only ever creates DOM
// nodes for items near the visible viewport instead of the whole history.
//
// Height-measurement strategy: real message bubbles vary in height (markdown,
// code blocks, images), so a fixed-row-height virtualizer would under/over-
// estimate scroll extent. This tracks a per-index height cache, seeded with
// an estimate and corrected once each item's real DOM node is measured after
// mount -- the same "measure on mount, estimate until then" approach used by
// react-window/react-virtualized, implemented directly over ResizeObserver
// with no new dependency.

import { register as registerDebug } from './debug.js';

const DEFAULT_ESTIMATE_PX = 72;
const DEFAULT_OVERSCAN = 6;
let _instanceCounter = 0;

export function createVirtualizer({ estimateHeight = DEFAULT_ESTIMATE_PX, overscan = DEFAULT_OVERSCAN } = {}) {
    const heights = new Map(); // index -> measured px height
    let itemCount = 0;

    function heightOf(i) {
        return heights.has(i) ? heights.get(i) : estimateHeight;
    }

    function offsetOf(i) {
        let sum = 0;
        for (let k = 0; k < i; k++) sum += heightOf(k);
        return sum;
    }

    function totalHeight() {
        return offsetOf(itemCount);
    }

    // setCount MUST be called before computeRange on every render pass -- the
    // item array can grow/shrink (new messages, session switch) and stale
    // itemCount would compute a range against the wrong list length.
    function setCount(n) {
        itemCount = n;
        // Drop cached heights for indices beyond the new count so a shrunk
        // list (e.g. switching to a shorter session) doesn't leak stale
        // measurements back in if the count grows again later.
        for (const k of heights.keys()) if (k >= n) heights.delete(k);
    }

    // Report a real measured height for index i (called from a ref callback
    // once the actual DOM node exists). Returns true if the height changed
    // enough to require a re-layout (avoids a re-render storm from sub-pixel
    // ResizeObserver noise).
    function reportHeight(i, px) {
        const prev = heights.get(i);
        if (prev != null && Math.abs(prev - px) < 1) return false;
        heights.set(i, px);
        return true;
    }

    // computeRange(scrollTop, viewportHeight) -> {startIndex, endIndex, topSpacerPx, bottomSpacerPx}
    // endIndex is exclusive. startIndex/endIndex already include `overscan`
    // items on each side so fast scrolling doesn't flash blank rows before
    // the next range recomputes.
    function computeRange(scrollTop, viewportHeight) {
        if (itemCount === 0) return { startIndex: 0, endIndex: 0, topSpacerPx: 0, bottomSpacerPx: 0 };
        let acc = 0;
        let startIndex = 0;
        for (; startIndex < itemCount; startIndex++) {
            const h = heightOf(startIndex);
            if (acc + h > scrollTop) break;
            acc += h;
        }
        const topSpacerPx = acc;
        let endIndex = startIndex;
        let visibleAcc = 0;
        for (; endIndex < itemCount; endIndex++) {
            if (visibleAcc > viewportHeight) break;
            visibleAcc += heightOf(endIndex);
        }
        startIndex = Math.max(0, startIndex - overscan);
        endIndex = Math.min(itemCount, endIndex + overscan);
        const topSpacer = offsetOf(startIndex);
        const bottomSpacer = totalHeight() - offsetOf(endIndex);
        return { startIndex, endIndex, topSpacerPx: topSpacer, bottomSpacerPx: Math.max(0, bottomSpacer) };
    }

    // Scroll-position-preserving resize: when content is prepended (e.g. the
    // user scrolls up and older history is revealed) the browser's native
    // scroll-anchoring is unreliable across a full DOM replace via applyDiff.
    // Callers capture {scrollTop, scrollHeight} before the mutation and pass
    // both here with the NEW scrollHeight after, to compute the delta to
    // re-apply so the visually-anchored content doesn't jump.
    function preserveScrollOnPrepend(prevScrollTop, prevScrollHeight, newScrollHeight) {
        return prevScrollTop + (newScrollHeight - prevScrollHeight);
    }

    const instanceId = 'virtualizer-' + (_instanceCounter++);
    registerDebug(instanceId, () => ({ itemCount, measuredCount: heights.size, totalHeightPx: totalHeight() }));

    return { setCount, reportHeight, computeRange, totalHeight, heightOf, preserveScrollOnPrepend };
}

// A ref-callback factory: wraps a per-item render so its real rendered height
// is measured via ResizeObserver and reported back into the virtualizer.
// Usage: h('div', {ref: measureRef(virtualizer, index)}, ...itemContent)
export function measureRef(virtualizer, index) {
    return (el) => {
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect?.height;
            if (h != null) virtualizer.reportHeight(index, h);
        });
        ro.observe(el);
        el.__vsResizeObserver = ro;
    };
}
