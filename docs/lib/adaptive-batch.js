// Adaptive send/flush batching primitive (C7).
//
// STATUS: this is a ready-to-use UTILITY, not wired to any live event
// stream today. thebird's chat is confirmed single-shot request/response —
// callLLM awaits one full completion per turn (see docs/freddie-chat.js
// runAgentTurn's comment above its STREAMING_START emit, ~line 440) and
// ChatEvent.STREAMING_PROGRESS (docs/lib/chat.js) has zero emit
// sites anywhere in docs/ as of this pass (grep confirmed). There is
// therefore no real per-token/per-chunk traffic to batch against yet.
// High-priority events (message_created, streaming_complete/error/cancelled)
// already flush immediately via direct DOM append in freddie-chat.js's
// pushUser/pushFreddie (no batching needed — each is a single, already-cheap
// full-message append, not a firehose). This file exists so that WHEN real
// token-streaming lands in a future pass, wiring STREAMING_PROGRESS handlers
// through createAdaptiveBatcher is a one-line change instead of a new
// subsystem. Do not fabricate synthetic progress events to exercise this —
// that would prove nothing about real streaming traffic.
//
// Mechanism: coalesces rapid-fire flushFn-worthy updates into a single
// requestAnimationFrame-driven flush, widening the batch window under
// main-thread pressure. Pressure is measured as the actual gap between
// successive rAF callbacks (a rAF that should fire every ~16ms firing every
// 40ms means the main thread is busy) — no separate profiling API needed,
// the rAF cadence itself is the signal.
//
// opts:
//   minIntervalMs (default 16)  — lower bound of the flush window (one frame)
//   maxIntervalMs (default 100) — upper bound under heavy main-thread load
//   pressureSampleSize (default 8) — how many recent rAF gaps to average
//
// createAdaptiveBatcher(flushFn, opts) returns:
//   push(item)     — enqueue one item; schedules a flush if not already pending
//   flushNow()     — synchronously flush whatever is queued, cancels pending rAF
//   dispose()      — cancel any pending rAF, drop the queue without flushing
export function createAdaptiveBatcher(flushFn, opts = {}) {
    if (typeof flushFn !== 'function') throw new Error('createAdaptiveBatcher: flushFn must be a function');
    const minIntervalMs = opts.minIntervalMs ?? 16;
    const maxIntervalMs = opts.maxIntervalMs ?? 100;
    const pressureSampleSize = opts.pressureSampleSize ?? 8;

    let queue = [];
    let rafId = null;
    let lastRafTime = null;
    const recentGaps = [];
    let flushTimer = null;

    function recordRafGap(now) {
        if (lastRafTime != null) {
            const gap = now - lastRafTime;
            recentGaps.push(gap);
            if (recentGaps.length > pressureSampleSize) recentGaps.shift();
        }
        lastRafTime = now;
    }

    function averageGap() {
        if (!recentGaps.length) return minIntervalMs;
        const sum = recentGaps.reduce((a, b) => a + b, 0);
        return sum / recentGaps.length;
    }

    // Scale the flush window linearly between min/max based on observed rAF
    // cadence: at the ideal ~16ms cadence we stay at minIntervalMs; as the
    // gap grows toward (and past) maxIntervalMs we widen the window so we
    // batch harder rather than fighting a busy main thread with more work.
    function currentIntervalMs() {
        const gap = averageGap();
        if (gap <= minIntervalMs) return minIntervalMs;
        if (gap >= maxIntervalMs) return maxIntervalMs;
        return gap;
    }

    function doFlush() {
        if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
        if (!queue.length) return;
        const items = queue;
        queue = [];
        try { flushFn(items); } catch (e) { console.warn('[adaptive-batch] flushFn error:', e); }
    }

    function scheduleFlush() {
        if (rafId != null || flushTimer != null) return; // already scheduled
        const hasRaf = typeof requestAnimationFrame === 'function';
        if (!hasRaf) {
            // Non-browser/test-like environment fallback: plain setTimeout at
            // the currently-estimated interval.
            flushTimer = setTimeout(() => { flushTimer = null; doFlush(); }, currentIntervalMs());
            return;
        }
        rafId = requestAnimationFrame((now) => {
            rafId = null;
            recordRafGap(now);
            const interval = currentIntervalMs();
            if (interval <= minIntervalMs) {
                doFlush();
            } else {
                // Widen the window: wait out the remainder via setTimeout
                // instead of chaining more rAFs (which would just re-measure
                // the same pressure and never actually wait longer).
                flushTimer = setTimeout(() => { flushTimer = null; doFlush(); }, interval - minIntervalMs);
            }
        });
    }

    function push(item) {
        queue.push(item);
        scheduleFlush();
    }

    function flushNow() {
        if (rafId != null && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(rafId); rafId = null; }
        if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
        doFlush();
    }

    function dispose() {
        if (rafId != null && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(rafId); rafId = null; }
        if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
        queue = [];
    }

    return { push, flushNow, dispose };
}

export default createAdaptiveBatcher;
