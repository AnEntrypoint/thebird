// game-loop.js — reusable fixed-timestep game-loop primitives layered ON TOP
// of the existing OffscreenCanvas worker substrate (docs/instance-worker.js).
// This module does NOT modify instance-worker.js's xstate machine or
// message-passing protocol. It is a standalone library any app can import
// (main thread OR inside instance-worker.js's WORKER_BODY, since the API
// used — requestAnimationFrame/setTimeout/cancelAnimationFrame — is available
// in both contexts) that gives a canvas a real fixed-timestep loop instead of
// the raw per-frame `draw()` currently hand-rolled in instance-worker.js.
//
// SCOPE: primitives only. Wiring this into instance-worker.js's mount() flow
// (replacing its inline WORKER_BODY draw loop) is a distinct, deliberate
// future pass — see the wiring note at the bottom of this file.

// ---------------------------------------------------------------------------
// createGameLoop(canvas, opts)
// ---------------------------------------------------------------------------
// Fixed-timestep approach chosen: classic "fix your timestep" ACCUMULATOR
// pattern (Gaffer On Games). Real elapsed wall-clock time between animation
// frames is accumulated; the update callback is stepped in fixed `dt`
// increments (default 1000/60 ms) as many times as the accumulator allows,
// draining it down below one step. The leftover fractional accumulator
// (accumulator / fixedDt, in [0,1)) is passed to onRender callbacks as the
// interpolation factor, so a renderer that wants smooth motion between
// physics steps can lerp(prevState, curState, interpolation) — callers that
// don't care about interpolation can simply ignore the argument and render
// straight from current state (both are supported; non-interpolated
// rendering is explicitly fine per the task spec, this implementation just
// makes the interpolation value available for free since the accumulator
// pattern computes it as a side effect at ~zero extra cost).
//
// A capped max-frame-time guards against the "spiral of death" (a huge
// elapsed gap — e.g. tab backgrounded then foregrounded — flooding the
// accumulator and causing an unbounded catch-up burst of update() calls);
// elapsed is clamped to opts.maxFrameMs (default 250ms) before accumulating.
export function createGameLoop(canvas, opts = {}) {
    const fixedDt = opts.fixedDt || (1000 / 60);
    const maxFrameMs = opts.maxFrameMs || 250;

    // requestAnimationFrame availability check: per the OffscreenCanvas spec,
    // a DedicatedWorkerGlobalScope that owns an OffscreenCanvas gets its own
    // rAF (window.requestAnimationFrame's worker-scope equivalent, exposed as
    // a global inside the worker, same signature). This has been verified
    // available in instance-worker.js's own WORKER_BODY, which already calls
    // `requestAnimationFrame(draw)` / `cancelAnimationFrame(raf)` directly
    // inside the worker with no shim (see instance-worker.js lines 15/34/36/50).
    // So: real rAF is used whenever the global exists (worker or main thread).
    // Fallback only fires in a runtime that truly lacks it (defensive, not
    // expected to trigger inside instance-worker.js's actual worker context).
    const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
    const hasRaf = typeof scope.requestAnimationFrame === 'function';
    const raf = hasRaf
        ? (fn) => scope.requestAnimationFrame(fn)
        : (fn) => scope.setTimeout(() => fn(nowMs()), 16); // ~60fps fallback
    const cancelRaf = hasRaf
        ? (h) => scope.cancelAnimationFrame(h)
        : (h) => scope.clearTimeout(h);
    const usingFallback = !hasRaf;

    function nowMs() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
        return Date.now();
    }

    const updateFns = [];
    const renderFns = [];

    let running = false;
    let handle = 0;
    let lastTime = 0;
    let accumulator = 0;

    function tick(t) {
        if (!running) return;
        const now = typeof t === 'number' ? t : nowMs();
        let elapsed = now - lastTime;
        lastTime = now;
        if (elapsed < 0) elapsed = 0;
        if (elapsed > maxFrameMs) elapsed = maxFrameMs; // spiral-of-death guard
        accumulator += elapsed;

        while (accumulator >= fixedDt) {
            for (let i = 0; i < updateFns.length; i++) updateFns[i](fixedDt);
            accumulator -= fixedDt;
        }

        const interpolation = accumulator / fixedDt; // [0,1)
        for (let i = 0; i < renderFns.length; i++) renderFns[i](interpolation);

        handle = raf(tick);
    }

    return {
        onUpdate(fn) { updateFns.push(fn); return () => { const i = updateFns.indexOf(fn); if (i >= 0) updateFns.splice(i, 1); }; },
        onRender(fn) { renderFns.push(fn); return () => { const i = renderFns.indexOf(fn); if (i >= 0) renderFns.splice(i, 1); }; },
        start() {
            if (running) return;
            running = true;
            lastTime = nowMs();
            accumulator = 0;
            handle = raf(tick);
        },
        stop() {
            if (!running) return;
            running = false;
            cancelRaf(handle);
            handle = 0;
        },
        get running() { return running; },
        get usingFallback() { return usingFallback; }, // true only if rAF genuinely absent
        get fixedDt() { return fixedDt; },
    };
}

// ---------------------------------------------------------------------------
// createSpriteBatch(ctx)
// ---------------------------------------------------------------------------
// Minimal queue-then-draw-all batching helper. Not texture-atlas batching —
// per the task spec, a simple queue drained in flush() is sufficient. Groups
// consecutive-by-fillStyle draws to cut down on redundant ctx.fillStyle
// writes (a cheap, correct nice-to-have) without building real
// image/texture-atlas batching machinery.
export function createSpriteBatch(ctx) {
    let queue = [];
    return {
        // sprite: { x, y, w, h, image? , color? }. `image` (a CanvasImageSource,
        // e.g. an ImageBitmap — the OffscreenCanvas-worker-safe image type) takes
        // precedence over `color` (a fillStyle string) if both are present.
        add(sprite) {
            queue.push(sprite);
        },
        flush() {
            let lastColor = null;
            for (let i = 0; i < queue.length; i++) {
                const s = queue[i];
                if (s.image) {
                    ctx.drawImage(s.image, s.x, s.y, s.w, s.h);
                } else {
                    const color = s.color || '#fff';
                    if (color !== lastColor) { ctx.fillStyle = color; lastColor = color; }
                    ctx.fillRect(s.x, s.y, s.w, s.h);
                }
            }
            queue = [];
        },
        get pending() { return queue.length; },
    };
}

// ---------------------------------------------------------------------------
// createInputPoller()
// ---------------------------------------------------------------------------
// HONEST GAP: this module runs standalone and may be loaded inside
// instance-worker.js's Worker context, which has no DOM and no direct
// keyboard events. instance-worker.js's CURRENT message protocol only
// forwards pointer input via `sendInput(kind, x, y)` -> `{ type: 'input',
// kind, x, y }` (see instance-worker.js lines 40-44, 207-211) — there is NO
// keyboard-forwarding message type today. This poller is therefore a
// READY-TO-USE PRIMITIVE, NOT YET FED REAL KEYBOARD EVENTS: dispatch(key,
// 'down'|'up') must be called explicitly by whatever wiring later bridges
// real events into this worker/module. On the main thread, `attachDom()` DOES
// wire it to real `keydown`/`keyup` listeners (useful for apps that don't run
// inside the worker sandbox); inside instance-worker.js's worker context,
// attachDom() is a no-op (no `document` global) and only dispatch() works
// until a future pass adds a keyboard message type + main-thread forwarding
// (see wiring note below).
export function createInputPoller() {
    const downFns = new Map(); // key -> Set<fn>
    const upFns = new Map();
    const state = new Set();
    let domCleanup = null;

    function fire(map, key, event) {
        const set = map.get(key);
        if (!set) return;
        for (const fn of set) fn(event);
    }

    function dispatch(key, kind, event) {
        if (kind === 'down') {
            if (!state.has(key)) fire(downFns, key, event);
            state.add(key);
        } else if (kind === 'up') {
            state.delete(key);
            fire(upFns, key, event);
        }
    }

    // Optional: on the main thread only, attach real DOM keyboard listeners so
    // this poller works standalone outside the worker sandbox too. No-op if
    // there is no `document` (e.g. inside instance-worker.js's Worker scope).
    function attachDom(target) {
        const doc = target || (typeof document !== 'undefined' ? document : null);
        if (!doc || typeof doc.addEventListener !== 'function') return () => {};
        const onDown = e => dispatch(e.key, 'down', e);
        const onUp = e => dispatch(e.key, 'up', e);
        doc.addEventListener('keydown', onDown);
        doc.addEventListener('keyup', onUp);
        domCleanup = () => {
            doc.removeEventListener('keydown', onDown);
            doc.removeEventListener('keyup', onUp);
        };
        return domCleanup;
    }

    return {
        onKeyDown(key, fn) {
            if (!downFns.has(key)) downFns.set(key, new Set());
            downFns.get(key).add(fn);
            return () => downFns.get(key)?.delete(fn);
        },
        onKeyUp(key, fn) {
            if (!upFns.has(key)) upFns.set(key, new Set());
            upFns.get(key).add(fn);
            return () => upFns.get(key)?.delete(fn);
        },
        isDown(key) { return state.has(key); },
        // Manual feed path — the only path available inside instance-worker.js's
        // worker context today. A future instance-worker.js message type (e.g.
        // { type: 'key', key, kind }) forwarded from the main thread's real
        // keydown/keyup listeners would call this.
        dispatch,
        // Main-thread convenience: wires real DOM events into this poller.
        attachDom,
        dispose() {
            downFns.clear();
            upFns.clear();
            state.clear();
            if (domCleanup) { domCleanup(); domCleanup = null; }
        },
    };
}

// ---------------------------------------------------------------------------
// FUTURE WIRING NOTE (not performed in this pass, standalone-only per spec)
// ---------------------------------------------------------------------------
// To adopt these primitives inside instance-worker.js's existing xstate/
// message-passing architecture WITHOUT restructuring it:
//
// 1. In WORKER_BODY's `mount` handler (instance-worker.js lines 12-39),
//    replace the inline `draw()`/`raf = requestAnimationFrame(draw)` block
//    with: `import`-equivalent inline source (WORKER_BODY is a template
//    string blob, so game-loop.js's source would need to be inlined into the
//    string, or the worker switched from a Blob URL to a real module Worker
//    with `{ type: 'module' }` so it can `import { createGameLoop, ... }
//    from './lib/game-loop.js'`) then call
//    `const loop = createGameLoop(canvas, { fixedDt: 1000/60 });
//    loop.onUpdate(dt => { t += 1; }); loop.onRender(interp => { ...existing
//    ctx drawing... }); loop.start();` — this is a straight lift of the
//    existing draw body into onUpdate/onRender.
// 2. Store `loop` alongside the existing `canvas`/`ctx`/`raf` worker-scope
//    variables; the `stop` message handler calls `loop.stop()` instead of
//    `cancelAnimationFrame(raf)`.
// 3. For keyboard: add a new message type in the main-thread `mount()`/API
//    surface (createInstanceWorker's returned `api`, instance-worker.js lines
//    183-227), e.g. `sendKey(key, kind)` that posts `{ type: 'key', key,
//    kind }`; WORKER_BODY's `self.onmessage` gains a `m.type === 'key'`
//    branch calling `poller.dispatch(m.key, m.kind)` on a
//    worker-scope `createInputPoller()` instance. This is additive to the
//    existing protocol (new message type, same shape/pattern as the existing
//    `input` type) — no restructuring of the xstate machine required, since
//    the machine only tracks mount/stop lifecycle, not per-frame or per-key
//    traffic.
//
// Neither change is made in this pass — this file is the standalone,
// import-ready primitive library only.
