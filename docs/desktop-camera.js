import { createMachine, createActor, assign } from 'xstate';

// The desktop is an INFINITE pannable/zoomable surface. The window layer
// (.wm-canvas, inside the fixed .wm-root viewport) carries a single CSS
// transform `translate(panX,panY) scale(scale)` with transform-origin 0 0.
// The camera {scale, panX, panY} is the source of truth and is an xstate actor
// so it persists across refresh (resume-on-refresh contract) per instance.
//
// Coordinate spaces:
//   screen = clientX/clientY relative to the .wm-root viewport top-left
//   canvas = where windows actually live (what wm.js stores as window bounds)
//   screen = canvas * scale + pan      <=>     canvas = (screen - pan) / scale
//
// Gestures (bound on .wm-root, ignored when started inside a window's body so
// in-window scroll / right-click still work):
//   shift + wheel            -> zoom toward cursor
//   ctrl + wheel             -> zoom toward cursor (touchpad pinch emits this)
//   shift + rightbutton drag -> pan (contextmenu suppressed while shift held)
//   two-finger touch drag    -> pan
//   two-finger pinch         -> zoom toward the pinch midpoint

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const PAN_LIMIT = 1e7;
const clampScale = s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(s) ? s : 1));
// Pan is unbounded by design (infinite canvas) but must stay finite and within a
// sane numeric envelope so a corrupt persisted snapshot can't produce a NaN/Infinity
// transform that blanks the desktop.
const clampPan = p => Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, Number.isFinite(p) ? p : 0));

export const cameraMachine = createMachine({
    id: 'camera',
    context: ({ input }) => ({
        scale: clampScale(input?.scale ?? 1),
        panX: clampPan(input?.panX ?? 0),
        panY: clampPan(input?.panY ?? 0),
    }),
    initial: 'idle',
    states: { idle: {} },
    on: {
        // Zoom by `factor` keeping the screen point (sx,sy) anchored under the
        // cursor: the canvas point under the cursor must map to the same screen
        // point before and after, so pan' = s - canvasPoint * scale'.
        ZOOM_AT: {
            actions: assign(({ context, event }) => {
                const next = clampScale(context.scale * event.factor);
                if (next === context.scale) return context;
                const cx = (event.sx - context.panX) / context.scale;
                const cy = (event.sy - context.panY) / context.scale;
                return { scale: next, panX: clampPan(event.sx - cx * next), panY: clampPan(event.sy - cy * next) };
            }),
        },
        PAN_BY: {
            actions: assign({
                panX: ({ context, event }) => clampPan(context.panX + event.dx),
                panY: ({ context, event }) => clampPan(context.panY + event.dy),
            }),
        },
        RESET: { actions: assign({ scale: 1, panX: 0, panY: 0 }) },
        SET: {
            actions: assign({
                scale: ({ event }) => clampScale(event.scale),
                panX: ({ event }) => clampPan(event.panX),
                panY: ({ event }) => clampPan(event.panY),
            }),
        },
    },
});

// Attach the camera to a fixed viewport element. Moves the viewport's existing
// children into a new inner .wm-canvas (the transformed layer) and returns a
// handle wm.js uses for coord conversion + persistence.
export function attachDesktopCamera({ viewport, onChange = null, snapshot = null } = {}) {
    if (!viewport) throw new Error('attachDesktopCamera: viewport required');

    // Build the transformed canvas layer and reparent existing children into it.
    let canvas = viewport.querySelector(':scope > .wm-canvas');
    if (!canvas) {
        canvas = document.createElement('div');
        canvas.className = 'wm-canvas';
        // Functional (not design) layout: the canvas is the infinite window
        // substrate. transform-origin 0 0 so screen=canvas*scale+pan holds.
        // The .wm-canvas class is styled upstream in anentrypoint-design/src/kits/os/theme.css
        // (position:absolute inset:0 transform-origin:0 0 will-change:transform).
        while (viewport.firstChild) canvas.appendChild(viewport.firstChild);
        viewport.appendChild(canvas);
    }
    // Force-disable CSS transitions on the canvas transform via inline
    // !important. The upstream design system's reduced-motion reset
    // (`.ds-247420 *, .app * { transition-duration:.01ms !important }`)
    // matches this element too, and since .wm-canvas has no transition rule
    // of its own it inherits the `transition` shorthand's implicit
    // `transition-property: all` default — so that forced non-zero duration
    // creates a REAL (if tiny) CSS transition on `transform`. Every pan/zoom
    // tick writes `transform` again before the prior transition resolves, so
    // the rendered transform perpetually lags/sticks behind the camera's
    // actual {scale,panX,panY}, breaking 1:1 drag tracking and the pan/zoom
    // math entirely. Inline `!important` always outranks a stylesheet
    // `!important`, so this reliably wins regardless of reduced-motion state.
    canvas.style.setProperty('transition', 'none', 'important');
    // The viewport itself must clip the panned/zoomed canvas.
    if (getComputedStyle(viewport).overflow === 'visible') viewport.style.overflow = 'hidden';

    // When a plain {scale, panX, panY} snapshot is supplied, validate it at the
    // boundary and pass as input so the actor starts in the correct state without
    // a post-hoc SET event. cameraMachine's context init re-clamps the values, so
    // a poisoned snapshot cannot produce NaN/Infinity in the transform.
    // Restoration via a raw xstate persisted snapshot is deliberately NOT supported
    // here; callers must pass the plain camera triple so validation is always applied.
    let initInput = {};
    if (snapshot && Number.isFinite(snapshot.scale) && Number.isFinite(snapshot.panX) && Number.isFinite(snapshot.panY) &&
        Math.abs(snapshot.panX) <= PAN_LIMIT && Math.abs(snapshot.panY) <= PAN_LIMIT) {
        initInput = { scale: snapshot.scale, panX: snapshot.panX, panY: snapshot.panY };
    } else if (snapshot) {
        console.warn('[camera] attachDesktopCamera: invalid snapshot ignored:', snapshot);
    }
    const actor = createActor(cameraMachine, { input: initInput });
    actor.start();

    const cam = () => actor.getSnapshot().context;
    function applyCamera() {
        const c = cam();
        // Defense-in-depth: a snapshot-restored actor bypasses the context-init
        // clamp, so re-validate before writing the transform — a NaN/Infinity here
        // blanks the whole desktop.
        const scale = clampScale(c.scale), panX = clampPan(c.panX), panY = clampPan(c.panY);
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        if (onChange) try { onChange({ scale, panX, panY }); } catch (err) { console.warn('[camera] onChange failed:', err); }
    }
    actor.subscribe(applyCamera);
    applyCamera();

    // Cached viewport rect — getBoundingClientRect() forces a synchronous layout
    // read, which is too costly to pay on every wheel/pointer event page-wide
    // (the window-level listeners below fire for scrolling anywhere, including
    // deep inside window content). Cache once, invalidate on resize/scroll of
    // the layout — cheap staleness window, correctness preserved for the common
    // case (viewport geometry only changes on resize or scroll-affecting layout).
    let cachedRect = null;
    function viewportRect() {
        if (!cachedRect) cachedRect = viewport.getBoundingClientRect();
        return cachedRect;
    }
    const invalidateRect = () => { cachedRect = null; };
    window.addEventListener('resize', invalidateRect, true);
    window.addEventListener('scroll', invalidateRect, true);

    // screen (relative to viewport) -> canvas
    function vpPoint(clientX, clientY) {
        const r = viewportRect();
        return { x: clientX - r.left, y: clientY - r.top };
    }
    function screenToCanvas(clientX, clientY) {
        const { scale, panX, panY } = cam();
        const p = vpPoint(clientX, clientY);
        return { x: (p.x - panX) / scale, y: (p.y - panY) / scale };
    }

    // Gestures bind on WINDOW (capture) — NOT on the viewport — because the
    // upstream theme sets `.wm-root { pointer-events:none }`, so events over the
    // empty desktop never reach the viewport element (they hit <body>). Listening
    // on window catches them everywhere; we gate behavior by hit-testing the
    // target. This is what fixes the "works over a window, dead over empty
    // desktop / fails after interaction" intermittency.
    function inViewport(clientX, clientY) {
        const r = viewportRect();
        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }
    // Is the point over a real window (so the desktop gesture should yield to it)?
    function overWindow(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        return !!(el && el.closest && el.closest('.wm-win'));
    }

    // --- wheel ---
    //   ctrl+wheel  = pinch-zoom (trackpad). The browser synthesizes ctrl+wheel for
    //                 trackpad pinch; the SAME physical gesture also emits plain-wheel
    //                 events for any residual two-finger movement, often interleaved.
    //                 We treat pinch as "active trackpad gesture": apply deltaX/deltaY
    //                 as pan FIRST (so simultaneous pan+zoom feels natural), then zoom.
    //                 For ~250ms after a pinch tick, plain-wheel events also pan the
    //                 canvas even over a window — the user has declared they're driving
    //                 the desktop, not scrolling window content.
    //   shift+wheel = zoom toward cursor (mouse).
    //   plain wheel = trackpad TWO-FINGER PAN when over empty desktop; over a window
    //                 it is left alone so the window content scrolls normally
    //                 (unless a pinch gesture is active — see above).
    let lastPinchTs = 0;
    const onWheel = (e) => {
        if (!inViewport(e.clientX, e.clientY)) return;
        const p = vpPoint(e.clientX, e.clientY);
        const now = performance.now();
        if (e.ctrlKey) {                               // trackpad pinch (active gesture)
            e.preventDefault();
            lastPinchTs = now;
            // Pan by any concurrent two-finger drift first, then zoom toward cursor.
            if (e.deltaX || e.deltaY) {
                // During pinch, deltaY is mostly the zoom signal; trackpads typically
                // emit pure-X for pan during pinch. Still pass both — small deltaY
                // contribution to pan is dwarfed by the zoom anchor math.
                actor.send({ type: 'PAN_BY', dx: -e.deltaX, dy: 0 });
            }
            const d = e.deltaY * 2.2; // pinch deltas are tiny; amplify
            actor.send({ type: 'ZOOM_AT', factor: Math.exp(-d * 0.0015), sx: p.x, sy: p.y });
            return;
        }
        if (e.shiftKey) {                              // mouse shift+wheel = zoom
            e.preventDefault();
            actor.send({ type: 'ZOOM_AT', factor: Math.exp(-e.deltaY * 0.0015), sx: p.x, sy: p.y });
            return;
        }
        // Plain wheel. If a pinch gesture is active (last pinch tick <250ms ago),
        // continue panning the canvas even over a window — the trackpad gesture owns
        // the desktop until the fingers lift.
        const pinchActive = (now - lastPinchTs) < 250;
        if (!pinchActive && overWindow(e.clientX, e.clientY)) return; // let window scroll
        e.preventDefault();
        actor.send({ type: 'PAN_BY', dx: -e.deltaX, dy: -e.deltaY });
    };
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });

    // --- shift + right-button drag = pan (mouse) ---
    let panning = null; // { id, lastX, lastY }
    const onPointerDown = (e) => {
        if (e.button !== 2 || !e.shiftKey) return;
        if (!inViewport(e.clientX, e.clientY)) return;
        e.preventDefault();
        panning = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    };
    const onPointerMove = (e) => {
        if (!panning || e.pointerId !== panning.id) return;
        actor.send({ type: 'PAN_BY', dx: e.clientX - panning.lastX, dy: e.clientY - panning.lastY });
        panning.lastX = e.clientX; panning.lastY = e.clientY;
    };
    const onPointerUp = (e) => { if (panning && e.pointerId === panning.id) panning = null; };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    // Suppress the context menu only while shift is held (so shift+rightclick is a
    // pan gesture, not a menu). Plain right-click context menu still works.
    const onContextMenu = (e) => { if (e.shiftKey && inViewport(e.clientX, e.clientY)) e.preventDefault(); };
    window.addEventListener('contextmenu', onContextMenu, true);

    // --- macOS Safari trackpad: gesturestart/gesturechange (no ctrl+wheel there) ---
    let gestureScale0 = null, gestureMid = { x: 0, y: 0 }, gestureId = 0, gestureActiveId = -1;
    const onGestureStart = (e) => {
        // Always reset stale state from a previous gesture; only arm the zoom
        // baseline when the gesture starts inside the viewport.
        const thisId = ++gestureId;
        gestureScale0 = null;
        gestureActiveId = -1;
        if (!inViewport(e.clientX, e.clientY)) return;
        e.preventDefault();
        gestureScale0 = cam().scale;
        gestureActiveId = thisId;
        gestureMid = vpPoint(e.clientX, e.clientY);
    };
    const onGestureChange = (e) => {
        if (gestureScale0 === null || gestureActiveId !== gestureId) return; // stale or unarmed gesture
        e.preventDefault();
        const target = clampScale(gestureScale0 * e.scale);
        const f = target / cam().scale;
        if (Math.abs(f - 1) > 0.001) actor.send({ type: 'ZOOM_AT', factor: f, sx: gestureMid.x, sy: gestureMid.y });
    };
    window.addEventListener('gesturestart', onGestureStart, true);
    window.addEventListener('gesturechange', onGestureChange, true);

    // --- touch: two-finger pan + pinch zoom ---
    let touch = null; // { mid:{x,y}, dist }
    const touchMid = (t0, t1) => ({ x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 });
    const touchDist = (t0, t1) => Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    const onTouchStart = (e) => {
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            const mid = touchMid(a, b);
            if (!inViewport(mid.x, mid.y)) return;
            // Listener is registered passive:false specifically so a two-finger
            // gesture over the desktop is claimed for pan/zoom instead of the
            // browser's native page scroll/zoom.
            e.preventDefault();
            touch = { mid, dist: touchDist(a, b) };
        }
    };
    const onTouchMove = (e) => {
        if (!touch || e.touches.length !== 2) { touch = null; return; }
        e.preventDefault();
        const [a, b] = e.touches;
        const mid = touchMid(a, b), dist = touchDist(a, b);
        // pan by midpoint delta
        const dx = mid.x - touch.mid.x, dy = mid.y - touch.mid.y;
        if (dx || dy) actor.send({ type: 'PAN_BY', dx, dy });
        // zoom by pinch ratio toward midpoint
        if (touch.dist > 0 && dist > 0) {
            const factor = dist / touch.dist;
            if (Math.abs(factor - 1) > 0.005) {
                const p = vpPoint(mid.x, mid.y);
                actor.send({ type: 'ZOOM_AT', factor, sx: p.x, sy: p.y });
            }
        }
        touch = { mid, dist };
    };
    const onTouchEnd = (e) => {
        // A 3+ finger gesture lifting down to exactly 2 fingers leaves no
        // touchstart to re-arm pan/zoom (only touchstart fires that). Re-arm
        // here from the remaining pair so the gesture continues seamlessly
        // instead of going dead until a fresh clean 2-finger touch begins.
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            const mid = touchMid(a, b);
            if (inViewport(mid.x, mid.y)) touch = { mid, dist: touchDist(a, b) };
            else touch = null;
            return;
        }
        if (e.touches.length < 2) touch = null;
    };
    window.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    window.addEventListener('touchend', onTouchEnd, true);
    window.addEventListener('touchcancel', onTouchEnd, true);

    const handle = {
        canvas,
        get scale() { return clampScale(cam().scale); },
        get pan() { const c = cam(); return { x: clampPan(c.panX), y: clampPan(c.panY) }; },
        screenToCanvas,
        // Reject non-finite inputs at the boundary (matching setSnapshot) so the
        // public API is consistently honest: invalid args warn+no-op rather than
        // being silently clamped (e.g. a NaN dx would otherwise snap pan to 0).
        zoomAt: (factor, sx, sy) => {
            if (!Number.isFinite(factor) || !Number.isFinite(sx) || !Number.isFinite(sy)) {
                console.warn('[camera] zoomAt ignored invalid args:', { factor, sx, sy });
                return;
            }
            actor.send({ type: 'ZOOM_AT', factor, sx, sy });
        },
        panBy: (dx, dy) => {
            if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
                console.warn('[camera] panBy ignored invalid args:', { dx, dy });
                return;
            }
            actor.send({ type: 'PAN_BY', dx, dy });
        },
        reset: () => actor.send({ type: 'RESET' }),
        // Frame a canvas-space rect into the viewport (the "fit to windows" /
        // "go home" affordance for the infinite surface). Centers the rect with
        // padding; clamps scale to the allowed range.
        fitToRect: (rect, pad = 60) => {
            pad = Math.max(0, Number.isFinite(pad) ? pad : 60);
            const vr = viewport.getBoundingClientRect();
            const vw = vr.width, vh = vr.height;
            if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.w) || !Number.isFinite(rect.h) || rect.w <= 0 || rect.h <= 0 || vw <= 0 || vh <= 0) { actor.send({ type: 'RESET' }); return; }
            // Excessive padding would drive (vw - pad*2) negative, silently collapsing
            // the fit to MIN_SCALE; cap pad so the available area stays positive.
            // Clamp to [0, maxAllowedPad] in one step so pad never goes transiently
            // negative on a tiny viewport.
            const maxAllowedPad = Math.floor((Math.min(vw, vh) - 20) / 2);
            pad = Math.max(0, Math.min(pad, maxAllowedPad));
            const fit = clampScale(Math.min((vw - pad * 2) / rect.w, (vh - pad * 2) / rect.h));
            // center: pan so rect center maps to viewport center
            const cxCanvas = rect.x + rect.w / 2, cyCanvas = rect.y + rect.h / 2;
            actor.send({ type: 'SET', scale: fit, panX: vw / 2 - cxCanvas * fit, panY: vh / 2 - cyCanvas * fit });
        },
        getPersistedSnapshot: () => actor.getPersistedSnapshot(),
        setSnapshot: (snap) => {
            if (!snap || !Number.isFinite(snap.scale) || !Number.isFinite(snap.panX) || !Number.isFinite(snap.panY) ||
                Math.abs(snap.panX) > PAN_LIMIT || Math.abs(snap.panY) > PAN_LIMIT) {
                console.warn('[camera] setSnapshot ignored invalid snapshot:', snap);
                return;
            }
            actor.send({ type: 'SET', scale: snap.scale, panX: snap.panX, panY: snap.panY });
        },
        dispose() {
            actor.stop();
            window.removeEventListener('wheel', onWheel, true);
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            window.removeEventListener('pointercancel', onPointerUp, true);
            window.removeEventListener('contextmenu', onContextMenu, true);
            window.removeEventListener('gesturestart', onGestureStart, true);
            window.removeEventListener('gesturechange', onGestureChange, true);
            window.removeEventListener('touchstart', onTouchStart, true);
            window.removeEventListener('touchmove', onTouchMove, true);
            window.removeEventListener('touchend', onTouchEnd, true);
            window.removeEventListener('touchcancel', onTouchEnd, true);
        },
    };
    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.desktopCamera = handle;
    }
    return handle;
}
