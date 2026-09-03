// Window spawn/placement geometry for the desktop shell: how big a new window
// should be for the current desktop area, where it cascades to, and how open
// windows are pulled back into range when the viewport shrinks.

// Small-viewport threshold: below this, a floating window (with drag/resize
// chrome meant for a pointer+large-canvas paradigm) is awkward — spawn apps
// maximized instead of as a small floating rect. Matches the coarse-pointer
// tablet/phone class, not just narrow desktop windows.
export const SMALL_VIEWPORT_W = 768;

// Scale a fixed-px default spawn size against the actual desktop area so a
// 4K/ultrawide viewport doesn't cage every window at the same handful of
// pixels: the requested size is nudged toward a fraction of the available
// area, clamped between the app's own default (floor) and a generous
// multiple of it (ceiling) so windows still cascade/overlap sensibly instead
// of each spawning full-bleed.
export function scaleSpawnSize(sz, vw, vh) {
    const targetW = Math.round(vw * 0.42);
    const targetH = Math.round(vh * 0.52);
    const w = Math.max(sz.w, Math.min(targetW, sz.w * 2, vw));
    const h = Math.max(sz.h, Math.min(targetH, sz.h * 2, vh));
    return { w, h };
}

// Resolve the full spawn rect for a new window. Clamp spawn bounds to the
// desktop area so cascaded windows never open with their chrome (titlebar/
// resize grip) off-screen. Below the tablet breakpoint a floating window is
// awkward (no room to drag/resize around it) — spawn maximized instead of a
// small floating rect. Above it, scale the default size toward the available
// desktop area so 4K/ultrawide viewports don't cage every window at the same
// fixed handful of pixels.
export function computeSpawnRect(sz, openCount) {
    const host = document.querySelector('.wm-root');
    const vw = host ? host.clientWidth : window.innerWidth;
    const vh = host ? host.clientHeight : window.innerHeight;
    const small = vw < SMALL_VIEWPORT_W;
    const scaled = small ? sz : scaleSpawnSize(sz, vw, vh);
    const w = Math.min(scaled.w, vw);
    const h = Math.min(scaled.h, vh);
    const x = Math.max(0, Math.min(100 + (openCount * 36) % 288, vw - w));
    const y = Math.max(0, Math.min(80 + (openCount * 28) % 224, vh - h));
    return { w, h, x, y, maximized: small };
}

// Keep open windows reachable when the viewport shrinks (rotation, browser
// resize): pull any window whose titlebar left the desktop back in range.
export function reflowWindows(wm) {
    for (const w of wm.list()) {
        const el = document.querySelector('.wm-win[data-id="' + w.id + '"]');
        if (!el) continue;
        const p = el.offsetParent;
        if (!p) continue;
        const nx = Math.min(el.offsetLeft, Math.max(0, p.clientWidth - 60));
        const ny = Math.min(el.offsetTop, Math.max(0, p.clientHeight - 36));
        if (nx === el.offsetLeft && ny === el.offsetTop) continue;
        if (typeof wm.setBounds === 'function') wm.setBounds(w.id, { x: nx, y: ny });
        else if (w.handle && typeof w.handle.setBounds === 'function') w.handle.setBounds({ x: nx, y: ny });
    }
}
