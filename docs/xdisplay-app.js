// xdisplay-app: the in-browser X11 server display surface. Extracted from
// docs/apps.js (pure code motion).
import { createXServer } from './x-server.js';
import { createXClient, X_PROGRAMS } from './x-client.js';
import { resolveInstance } from './apps.js';

export function xdisplayApp(ctx) {
    const instance = resolveInstance(ctx);
    const cv = document.createElement('canvas');
    cv.width = 640; cv.height = 400;
    cv.className = 'app-canvas x-display';
    const display = createXServer({ canvas: cv, displayName: ':' + instance.id });
    const X = createXClient(display);

    // Multiple xdisplay windows can be open at once for the same instance
    // (this app carries no singleton guard against the WM launching it
    // twice). Each window gets its own independent X server/client pair
    // (createXServer binds 1:1 to its own canvas, so servers cannot be
    // shared across windows), but instance.xdisplay/instance.xclient and
    // window.__debug.x[instance.id] are a single instance-wide slot that
    // every non-display-owning consumer (freddie-host X bridge, gm
    // dispatch, debug tooling) looks up through. Track every open window's
    // display/client in an ordered registry keyed by a unique per-window
    // token so the instance-wide slot always reflects a window that is
    // actually still open: closing any window (not just the most recently
    // opened) removes exactly its own entry, and if it was the one the
    // slot pointed at, promotes the next remaining open window instead of
    // leaving a stale/orphaned reference.
    if (!instance.__xdisplayWindows) instance.__xdisplayWindows = new Map();
    const windowToken = {};
    instance.__xdisplayWindows.set(windowToken, { display, client: X });

    const publishActive = () => {
        const last = Array.from(instance.__xdisplayWindows.values()).pop();
        instance.xdisplay = last ? last.display : null;
        instance.xclient = last ? last.client : null;
        if (typeof window !== 'undefined') {
            if (!window.__debug) window.__debug = {};
            window.__debug.x = window.__debug.x || {};
            if (last) {
                window.__debug.x[instance.id] = { display: last.display, client: last.client, programs: Object.keys(X_PROGRAMS) };
            } else {
                delete window.__debug.x[instance.id];
            }
        }
    };
    publishActive();
    let ro = null;
    let pendingResize = null;
    let resizeRaf = 0;
    const flushResize = () => {
        resizeRaf = 0;
        if (!pendingResize) return;
        const { w, h } = pendingResize;
        pendingResize = null;
        display.resizeRoot(w, h);
    };
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const box = entry.contentBoxSize && entry.contentBoxSize[0];
                const w = box ? Math.round(box.inlineSize) : Math.round(entry.contentRect.width);
                const h = box ? Math.round(box.blockSize) : Math.round(entry.contentRect.height);
                if (w > 0 && h > 0) pendingResize = { w, h };
            }
            if (pendingResize && !resizeRaf) {
                const schedule = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
                resizeRaf = schedule(flushResize);
            }
        });
        ro.observe(cv);
    }
    return {
        node: cv,
        dispose: () => {
            if (ro) ro.disconnect();
            if (resizeRaf) {
                const cancel = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;
                cancel(resizeRaf);
                resizeRaf = 0;
            }
            pendingResize = null;
            display.dispose();
            instance.__xdisplayWindows.delete(windowToken);
            publishActive();
        }
    };
}
