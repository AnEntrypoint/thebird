// Window manager state machine. Paint surface is upstream
// (anentrypoint-design/src/desktop/wm.js -> vendored at vendor/kits/os/wm.js).
// This module owns z-order, focused id, alt-tab cycling, drag/resize math,
// and persistence callbacks. Renders each window via renderWindow handle.

import { renderWindow } from './vendor/kits/os/index.js';
import { attachDesktopCamera } from './desktop-camera.js';
import { createMachine, createActor, assign } from 'xstate';
import { t } from './vendor/i18n.js';

// Per-window xstate machine. Context is the canonical window state; the DOM
// handle (renderWindow) is a pure paint surface driven from this machine.
// Events carry the mutation; transitions assign into context. Persisting a
// window === actor.getPersistedSnapshot(); restoring === createActor(machine,
// {snapshot}). This is what lets a refresh resume a window's exact geometry +
// min/max/focus without replaying DOM button clicks.
export const windowMachine = createMachine({
    id: 'window',
    context: ({ input }) => {
        const fin = (v, d) => (Number.isFinite(v) ? v : d);
        return {
            x: fin(input?.x, 60), y: fin(input?.y, 60), w: fin(input?.w, 480), h: fin(input?.h, 320),
            minimized: !!input?.minimized, maximized: !!input?.maximized,
            z: fin(input?.z, 0), focused: !!input?.focused,
            title: input?.title ?? t('wm.defaultWindowTitle', 'window'), kind: input?.kind ?? 'div',
            instanceId: input?.instanceId ?? '', appId: input?.appId ?? '',
        };
    },
    initial: 'open',
    states: { open: {} },
    on: {
        MOVE: { actions: assign({ x: ({ event }) => event.x, y: ({ event }) => event.y }) },
        RESIZE: { actions: assign({ w: ({ event }) => event.w, h: ({ event }) => event.h }) },
        BOUNDS: {
            actions: assign({
                x: ({ context, event }) => event.x ?? context.x,
                y: ({ context, event }) => event.y ?? context.y,
                w: ({ context, event }) => event.w ?? context.w,
                h: ({ context, event }) => event.h ?? context.h,
            }),
        },
        MAXIMIZE: { actions: assign({ maximized: ({ event }) => event.value, minimized: ({ context, event }) => event.value ? false : context.minimized }) },
        MINIMIZE: { actions: assign({ minimized: ({ event }) => event.value, maximized: ({ context, event }) => event.value ? false : context.maximized }) },
        FOCUS: { actions: assign({ focused: true, z: ({ event }) => event.z }) },
        BLUR: { actions: assign({ focused: false }) },
        SET_APP: { actions: assign({ appId: ({ event }) => event.appId }) },
    },
});

const STYLE_ID = 'thebird-wm-style';
const WM_CSS_URL = new URL('./vendor/kits/os/wm.css', import.meta.url).href;

let _persistCallback = null;
export function setWmPersistCallback(cb) { _persistCallback = cb; }
function notifyChange() { if (_persistCallback) try { _persistCallback(); } catch { /* swallow: persist callback is host-supplied and best-effort; a throw there must not break wm state transitions */ } }

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const l = document.createElement('link');
    l.id = STYLE_ID;
    l.rel = 'stylesheet';
    l.href = WM_CSS_URL;
    document.head.appendChild(l);
}

function ensureRoot() {
    let r = document.getElementById('wm-root');
    if (!r) {
        r = document.createElement('div');
        r.id = 'wm-root';
        r.className = 'wm-root';
        document.body.appendChild(r);
    }
    return r;
}

function getBarH() {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--os-bar-h').trim();
        if (v) {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) return n;
        }
    } catch { /* swallow: getComputedStyle/custom-property read may fail before styles are attached; fall back to the default bar height */ }
    return 32;
}

function getDockH() {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--os-dock-h').trim();
        if (v) {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) return n;
        }
        const tb = document.querySelector('.os-taskbar');
        if (tb) {
            const h = tb.getBoundingClientRect().height;
            if (h > 0) return h;
        }
    } catch { /* swallow: getComputedStyle/DOM query may fail before styles/taskbar are attached; fall back to the default dock height */ }
    return 44;
}

// Window bounds are stored relative to .wm-root, which is positioned between
// the menubar and the taskbar (top: var(--os-bar-h); bottom: var(--os-dock-h)).
// So y=0 means flush against menubar, and the max y is wmRoot.height - window.h.
// No need to subtract barH/dockH from clamps — .wm-root geometry already excludes both.
function getWmRootSize() {
    const r = document.getElementById('wm-root');
    if (r) {
        const rect = r.getBoundingClientRect();
        if (rect.height > 0) return { w: rect.width, h: rect.height };
    }
    return { w: window.innerWidth, h: window.innerHeight - getBarH() - getDockH() };
}

function clampMove(x, y, w, h) {
    // Infinite canvas: window placement is UNBOUNDED — a window may live anywhere
    // on the plane (pan/zoom or the "fit to windows" action gets you back to it).
    // No viewport clamp; the only floor is a sane finite coordinate to avoid NaN.
    const lim = 1e7;
    return { x: Math.max(-lim, Math.min(lim, x)), y: Math.max(-lim, Math.min(lim, y)) };
}

function clampSize(x, y, w, h) {
    // Infinite canvas: no viewport ceiling on size; just enforce a usable minimum.
    return { w: Math.max(200, w), h: Math.max(120, h) };
}

function leftHalfGeom() {
    const { w: rw, h: rh } = getWmRootSize();
    return { x: 0, y: 0, w: Math.floor(rw / 2), h: rh };
}
function rightHalfGeom() {
    const { w: rw, h: rh } = getWmRootSize();
    const halfW = Math.floor(rw / 2);
    return { x: halfW, y: 0, w: rw - halfW, h: rh };
}

let contextMenuEl = null;
let contextMenuId = null;
let contextMenuTeardown = null;
function showWindowMenu(winId, x, y, openingEvent = null) {
    // Clean up old menu AND its document listeners — removing only the element
    // (without unbinding the prior closeMenu/onKey) leaves stale handlers on
    // document that fire on the next click against the wrong menu context.
    if (contextMenuTeardown) contextMenuTeardown();
    if (contextMenuEl) contextMenuEl.remove();
    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'wm-context-menu';
    contextMenuEl.setAttribute('role', 'menu');
    contextMenuEl.setAttribute('aria-label', t('wm.contextMenuLabel', 'Window menu'));
    const rootSize = getWmRootSize();
    contextMenuEl.style.left = Math.min(x, rootSize.w - 200) + 'px';
    contextMenuEl.style.top = Math.min(y, rootSize.h - 150) + 'px';
    contextMenuId = winId;
    const items = [
        { label: t('wm.contextMenuMaximize', 'Maximize'), action: 'maximize' },
        { label: t('wm.contextMenuMinimize', 'Minimize'), action: 'minimize' },
        { label: t('wm.contextMenuClose', 'Close'), action: 'close' },
    ];
    for (const item of items) {
        const btn = document.createElement('button');
        btn.className = 'wm-context-menu-item';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = item.label;
        btn.addEventListener('click', () => {
            contextMenuEl?.remove();
            contextMenuEl = null;
            contextMenuId = null;
            // Action will be handled by the caller
            if (item.action === 'maximize') window.dispatchEvent(new CustomEvent('wm-context', { detail: { winId, action: 'maximize' } }));
            if (item.action === 'minimize') window.dispatchEvent(new CustomEvent('wm-context', { detail: { winId, action: 'minimize' } }));
            if (item.action === 'close') window.dispatchEvent(new CustomEvent('wm-context', { detail: { winId, action: 'close' } }));
        });
        contextMenuEl.appendChild(btn);
    }
    document.body.appendChild(contextMenuEl);
    // Move DOM focus into the menu on open — an ARIA role="menu" that opens
    // without shifting focus gives keyboard/AT users no indication it opened
    // and no way to reach it without tabbing past unrelated page content.
    contextMenuEl.querySelector('.wm-context-menu-item')?.focus();
    // Dismiss on outside-click OR Escape — a context menu that ignores Esc is an
    // unpredictable dead-end. Both paths tear down the menu and unbind together.
    const teardown = () => {
        contextMenuEl?.remove();
        contextMenuEl = null;
        contextMenuId = null;
        contextMenuTeardown = null;
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('keydown', onKey);
    };
    contextMenuTeardown = teardown;
    // Attach listeners SYNCHRONOUSLY (no setTimeout race window where an outside
    // click between open and the deferred attach is missed). The opening gesture's
    // own click can bubble to document in the same tick and self-close the menu, so
    // the caller passes the originating event and we ignore exactly that one object.
    // (Passed in explicitly rather than read from the deprecated window.event, which
    // is null under any async boundary and unreliable across browsers.)
    const closeMenu = (e) => {
        if (e === openingEvent) return;            // ignore the gesture that opened us
        if (!contextMenuEl?.contains(e.target)) teardown();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); teardown(); return; }
        // ArrowUp/ArrowDown/Home/End move focus among menuitems per ARIA menu
        // authoring practice, wrapping at the ends.
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
        const menuItems = Array.from(contextMenuEl?.querySelectorAll('.wm-context-menu-item') || []);
        if (!menuItems.length) return;
        e.preventDefault();
        const curIdx = menuItems.indexOf(document.activeElement);
        let nextIdx;
        if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = menuItems.length - 1;
        else if (e.key === 'ArrowDown') nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % menuItems.length;
        else nextIdx = curIdx < 0 ? menuItems.length - 1 : (curIdx - 1 + menuItems.length) % menuItems.length;
        menuItems[nextIdx].focus();
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', onKey);
}

export function createWM(opts) {
    const getActiveInstanceId = (opts && typeof opts.getActiveInstanceId === 'function') ? opts.getActiveInstanceId : null;
    ensureStyle();
    const root = ensureRoot();
    // The desktop is an infinite zoom/pan surface: windows live in .wm-canvas
    // (transformed), while .wm-root is the fixed clipping viewport. `camera`
    // converts screen<->canvas coords for the drag/resize/open math below.
    // Pan/zoom changes must persist too (camera is a resumable surface), so the
    // camera's onChange routes through the same persist callback as window moves.
    // Debounced downstream in os-shell.schedulePersist.
    const camera = attachDesktopCamera({ viewport: root, onChange: () => notifyChange() });
    const canvas = camera.canvas;
    const windows = new Map();
    let zCounter = 100;
    let focused = null;
    let nextId = 1;
    let _showDesktopMemo = null;

    // .wm-win.wm-max fills its positioned ancestor (.wm-canvas) at
    // {left:0,top:0,width:100%,height:100%} (wm.css) — a canvas-space box.
    // .wm-canvas itself carries the camera's pan/zoom transform, so that box
    // only coincides with the actual visible screen when the camera is at
    // identity. If the user has panned/zoomed (or a cascaded spawn drifted
    // the camera), maximizing a window fills 100% of a transformed box that
    // may itself sit partly or wholly off-screen — the titlebar (and the
    // rest of the "maximized" window) stays unreachable, same failure class
    // as the off-screen cascade bug this fixes for spawn. Reset the camera to
    // identity on an interactive (user-clicked) maximize so "maximize" always
    // means "fill the actual viewport" — never called on the restore path
    // (wm.setMaximized), which must not clobber a persisted camera snapshot.
    function resetCameraForMaximize(willMaximize) {
        if (willMaximize) { try { camera.reset(); } catch { /* swallow: camera reset is best-effort UX polish, never a hard requirement for maximize to still flip the state flag */ } }
    }

    // Snap preview overlay
    let snapPreviewEl = null;
    function getSnapPreview() {
        if (!snapPreviewEl) {
            snapPreviewEl = document.createElement('div');
            snapPreviewEl.className = 'wm-snap-preview';
            root.appendChild(snapPreviewEl);
        }
        return snapPreviewEl;
    }
    function showSnapPreview(rect) {
        const el = getSnapPreview();
        el.style.left = rect.x + 'px';
        el.style.top = rect.y + 'px';
        el.style.width = rect.w + 'px';
        el.style.height = rect.h + 'px';
        el.style.display = 'block';
    }
    function hideSnapPreview() {
        // Remove + null rather than just hiding (mirrors contextMenuEl/switcherEl
        // teardown) so no idle overlay element lingers in the DOM between drags;
        // getSnapPreview() lazily recreates it on the next gesture.
        if (snapPreviewEl) { snapPreviewEl.remove(); snapPreviewEl = null; }
    }

    // Alt+Tab switcher overlay
    let switcherEl = null;
    let switcherIds = null;
    let switcherIdx = 0;
    let altHeld = false;
    function buildSwitcher() {
        if (switcherEl) switcherEl.remove();
        switcherEl = document.createElement('div');
        switcherEl.className = 'wm-switcher';
        // Keyboard-only overlay (Alt+Tab) with no visible-focus DOM element
        // to land on — without ARIA a screen reader announces nothing when
        // it opens or the active row changes. listbox/option + aria-live
        // gives the same "switching to window X" signal a sighted user gets
        // from the highlighted row.
        switcherEl.setAttribute('role', 'listbox');
        switcherEl.setAttribute('aria-label', 'Window switcher');
        switcherEl.setAttribute('aria-live', 'assertive');
        renderSwitcher();
        document.body.appendChild(switcherEl);
    }
    function renderSwitcher() {
        if (!switcherEl || !switcherIds) return;
        switcherEl.replaceChildren();
        const live = switcherIds.filter(id => windows.has(id));
        live.forEach((id, i) => {
            const w = windows.get(id);
            const row = document.createElement('div');
            const title = w.titleEl ? w.titleEl.textContent : id;
            row.textContent = id + '  ' + title;
            row.className = 'wm-switcher-item' + (i === switcherIdx ? ' active' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(i === switcherIdx));
            switcherEl.appendChild(row);
        });
    }
    function closeSwitcher(commit) {
        if (switcherEl) { switcherEl.remove(); switcherEl = null; }
        if (commit && switcherIds) {
            // Windows may have closed during Alt+Tab; only focus a live one.
            const live = switcherIds.filter(id => windows.has(id));
            if (live.length) {
                const idx = Math.min(Math.max(switcherIdx, 0), live.length - 1);
                focus(live[idx]);
            }
        }
        switcherIds = null;
        switcherIdx = 0;
    }

    // zCounter grows by one on every focus()/open() call for the life of the
    // WM instance (a long-running session can rack up an unbounded integer,
    // persisted into every window's snapshot as `z`). Once it crosses this
    // ceiling, compact the z-order back to a small dense range starting at
    // 100 -- relative order (current z ranking) is preserved, only the
    // magnitude shrinks. Cheap (O(n log n) over currently-open windows) and
    // safe to call any time no gesture depends on an exact z delta.
    const Z_RENORMALIZE_THRESHOLD = 1e6;
    function renormalizeZ() {
        const ordered = [...windows.values()].sort((a, b) => a.z - b.z);
        let z = 100;
        for (const w of ordered) {
            z++;
            w.handle.setZIndex(z);
            if (w.actor) w.actor.send({ type: 'FOCUS', z });
        }
        zCounter = z;
    }

    function focus(id) {
        const w = windows.get(id);
        if (!w) return;
        if (focused && focused !== id) {
            const prev = windows.get(focused);
            if (prev) { prev.handle.setFocused(false); if (prev.actor) prev.actor.send({ type: 'BLUR' }); }
        }
        focused = id;
        if (w.minimized) {
            w.actor.send({ type: 'MINIMIZE', value: false });
            w.handle.setMinimized(false);
            notifyChange();
        }
        if (zCounter >= Z_RENORMALIZE_THRESHOLD) renormalizeZ();
        w.handle.setFocused(true);
        w.handle.setZIndex(++zCounter);
        if (w.actor) w.actor.send({ type: 'FOCUS', z: zCounter });
        // a11y: move DOM focus into the window on focus/alt-tab-activate so
        // keyboard/AT users land somewhere useful instead of on a stale element.
        // Prefer the first focusable descendant; fall back to the window root
        // itself (tabindex -1 makes an otherwise-inert dialog root focusable
        // programmatically without adding it to the normal Tab order).
        //
        // Guard: skip the steal when DOM focus is already inside this window
        // (root.contains(document.activeElement)). Without this, every
        // pointerdown anywhere in the window bubbles to the window-root
        // pointerdown listener that calls focus(id) -- including pointerdown
        // on the titlebar's own close/minimize/maximize buttons -- which
        // then yanks focus off whichever button the user just pressed onto
        // the FIRST focusable descendant (always the minimize button, by DOM
        // order) before that button's own click handler runs. The close
        // button's second-click-to-confirm arm/commit idiom listens for
        // `blur` to disarm, so the button's own click sequence was blurring
        // itself via this steal and permanently resetting closeArmed to
        // false right before its click handler read it -- the confirm click
        // was silently demoted back to an arm click every time.
        try {
            const root = w.handle.el;
            if (root && typeof root.focus === 'function' && !root.contains(document.activeElement)) {
                const focusable = root.querySelector(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusable && typeof focusable.focus === 'function') {
                    focusable.focus({ preventScroll: true });
                } else {
                    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
                    root.focus({ preventScroll: true });
                }
            }
        } catch { /* swallow: focus is a best-effort a11y nicety, never a hard requirement */ }
    }

    // open(opts) -- opens or restores a window.
    // Parameter precedence: when `snapshot` is provided it is the sole source of
    // truth for geometry, min/max, and focus state (xstate rehydration); all
    // explicit geometry parameters (x, y, width, height, minimized, maximized)
    // are ignored on the snapshot path. Pass snapshot=null to use explicit params.
    function open({ title = t('wm.defaultWindowTitle', 'window'), x = 60, y = 60, width = 480, height = 320, body = null, kind = 'div', instanceId = '', appId = '', snapshot = null, minimized = false, maximized = false } = {}) {
        const id = 'w' + (nextId++);
        // Fresh spawns (no snapshot) hand x/y computed against SCREEN-space
        // viewport dimensions (shell-geometry.js computeSpawnRect measures
        // .wm-root.clientWidth/Height and clamps into [0, vw-w]/[0, vh-h]).
        // But window bounds are stored and rendered in CANVAS space (this
        // window's DOM lives inside .wm-canvas, which carries the camera's
        // translate/scale transform) — screen and canvas coordinates only
        // coincide when the camera is at its identity {scale:1,panX:0,panY:0}.
        // Once the user has panned/zoomed (shift+wheel, pinch, "fit to
        // windows"), storing the raw screen-space cascade coordinates as
        // canvas coordinates places the new window's titlebar wherever the
        // pan happens to put it — including above y=0 / off the top edge,
        // unreachable because you can't grab a titlebar you can't see. Map
        // the incoming screen-space rect through the live camera transform so
        // a freshly spawned window's titlebar always lands inside the
        // currently visible screen rect, exactly like a restored/dragged
        // window already does via clampMove. Restore path (snapshot) is
        // unaffected — persisted bounds are already canvas-space truth.
        if (!snapshot) {
            const s = camera.scale || 1;
            const pan = camera.pan || { x: 0, y: 0 };
            x = (x - pan.x) / s;
            y = (y - pan.y) / s;
        }
        // The window actor is the canonical state holder. When a persisted
        // snapshot is passed (restore path) the actor rehydrates from it, so
        // geometry + min/max/focus come back exactly without DOM replay.
        const actor = snapshot
            ? createActor(windowMachine, { snapshot })
            : createActor(windowMachine, { input: { x, y, w: width, h: height, minimized, maximized, title, kind, instanceId, appId, z: ++zCounter } });
        actor.start();
        // Synchronize zCounter with restored z so new windows always receive
        // a higher z than any restored window, preserving the focus order invariant.
        if (snapshot) {
            const restoredZ = actor.getSnapshot().context.z;
            if (restoredZ >= zCounter) zCounter = restoredZ;
        }
        // `state` is a thin live view over the actor's context so the existing
        // pointer handlers keep reading state.maximized/state.minimized.
        const state = {
            get minimized() { return actor.getSnapshot().context.minimized; },
            get maximized() { return actor.getSnapshot().context.maximized; },
            get z() { return actor.getSnapshot().context.z; },
        };
        let snapTarget = null; // 'top'|'left'|'right'|null
        let dragInProgress = false; // re-entrancy guard so a rapid re-press can't stack drag listeners
        let resizeInProgress = false; // same guard for the resize gesture
        let gestureTeardown = null; // unbinds the active drag/resize document listeners; close() must call this mid-gesture

        const handle = renderWindow({
            title,
            body,
            kind,
            instanceId,
            bounds: { x, y, w: width, h: height },
            focused: false,
            callbacks: {
                onFocus: () => focus(id),
                onClose: () => close(id),
                onMinimize: () => {
                    const v = !state.minimized;
                    actor.send({ type: 'MINIMIZE', value: v });
                    handle.setMinimized(v);
                    notifyChange();
                },
                onMaximize: () => {
                    const v = !state.maximized;
                    resetCameraForMaximize(v);
                    actor.send({ type: 'MAXIMIZE', value: v });
                    handle.setMaximized(v);
                    notifyChange();
                },
                onDragStart: (e, frame) => {
                    // Guard against a second pointerdown landing before onUp tore the
                    // first gesture down — without this, a rapid re-press stacks a
                    // second onMove/onUp pair on document and they never all unbind.
                    if (dragInProgress) return;
                    dragInProgress = true;
                    const pid = e.pointerId;
                    const sx = e.clientX, sy = e.clientY;
                    const ox = frame.x, oy = frame.y;
                    const fw = frame.w, fh = frame.h;
                    e.preventDefault();
                    try { e.target.setPointerCapture(pid); } catch { /* swallow: pointer capture is an optimization for tracking drags off-element; drag still works via the document-level listeners below without it */ }
                    snapTarget = null;
                    // Coarse pointers (touch) jitter a few px during a tap; require a
                    // small minimum movement before committing to a drag so a tap-to-
                    // focus on the titlebar doesn't nudge the window.
                    const DRAG_THRESHOLD = 5;
                    let dragEngaged = e.pointerType !== 'touch';
                    if (dragEngaged) handle.el.classList.add('wm-dragging');
                    const onMove = ev => {
                        if (ev.pointerId !== pid) return;
                        if (!dragEngaged) {
                            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
                            dragEngaged = true;
                            handle.el.classList.add('wm-dragging');
                        }
                        // Screen pixel deltas are canvas/scale because the window
                        // layer is zoomed; divide so dragging tracks the cursor 1:1.
                        const s = camera.scale || 1;
                        const rawX = ox + (ev.clientX - sx) / s;
                        const rawY = oy + (ev.clientY - sy) / s;
                        const c = clampMove(rawX, rawY, fw, fh);
                        actor.send({ type: 'MOVE', x: c.x, y: c.y });
                        handle.setBounds({ x: c.x, y: c.y });
                        // Aero-snap detection
                        const px = ev.clientX, py = ev.clientY;
                        const barH = getBarH();
                        const snapMargin = ev.pointerType === 'touch' ? 36 : 12;
                        if (py <= barH + snapMargin) {
                            snapTarget = 'top';
                            const wr = getWmRootSize();
                            showSnapPreview({ x: 0, y: barH, w: wr.w, h: wr.h });
                        } else if (px <= snapMargin) {
                            snapTarget = 'left';
                            const g = leftHalfGeom();
                            showSnapPreview({ x: g.x, y: g.y + barH, w: g.w, h: g.h });
                        } else if (px >= getWmRootSize().w - snapMargin) {
                            snapTarget = 'right';
                            const g = rightHalfGeom();
                            showSnapPreview({ x: g.x, y: g.y + barH, w: g.w, h: g.h });
                        } else {
                            snapTarget = null;
                            hideSnapPreview();
                        }
                        notifyChange();
                    };
                    const onUp = ev => {
                        if (ev.pointerId !== pid) return;
                        document.removeEventListener('pointermove', onMove);
                        document.removeEventListener('pointerup', onUp);
                        document.removeEventListener('pointercancel', onUp);
                        gestureTeardown = null;
                        try { e.target.releasePointerCapture(pid); } catch { /* swallow: capture may already have been released implicitly (e.g. pointercancel, element detached); nothing left to release */ }
                        handle.el.classList.remove('wm-dragging');
                        hideSnapPreview();
                        if (!windows.has(id)) { snapTarget = null; dragInProgress = false; return; }
                        if (snapTarget === 'top') {
                            actor.send({ type: 'MAXIMIZE', value: true });
                            handle.setMaximized(true);
                        } else if (snapTarget === 'left') {
                            const g = leftHalfGeom();
                            actor.send({ type: 'BOUNDS', x: g.x, y: g.y, w: g.w, h: g.h });
                            handle.setBounds(g);
                        } else if (snapTarget === 'right') {
                            const g = rightHalfGeom();
                            actor.send({ type: 'BOUNDS', x: g.x, y: g.y, w: g.w, h: g.h });
                            handle.setBounds(g);
                        }
                        snapTarget = null;
                        dragInProgress = false;
                        notifyChange();
                    };
                    try {
                        document.addEventListener('pointermove', onMove);
                        document.addEventListener('pointerup', onUp);
                        document.addEventListener('pointercancel', onUp);
                        gestureTeardown = () => {
                            document.removeEventListener('pointermove', onMove);
                            document.removeEventListener('pointerup', onUp);
                            document.removeEventListener('pointercancel', onUp);
                            gestureTeardown = null;
                        };
                    } catch (e) {
                        // If listener attachment fails, reset drag state so the guard
                        // doesn't permanently block future drags.
                        dragInProgress = false;
                        hideSnapPreview();
                    }
                },
                onResizeStart: (e, frame) => {
                    // Guard against a second pointerdown stacking another onMove/onUp
                    // pair before the first gesture's onUp unbinds them (mirrors drag).
                    if (resizeInProgress) return;
                    resizeInProgress = true;
                    const pid = e.pointerId;
                    const sx = e.clientX, sy = e.clientY;
                    const ow = frame.w, oh = frame.h;
                    const fx = frame.x, fy = frame.y;
                    // dir carries which edge/corner is grabbed (n/s/e/w + corners).
                    // Default 'se' preserves the legacy single-grip behaviour.
                    const dir = frame.dir || 'se';
                    const west = dir.includes('w'), east = dir.includes('e');
                    const north = dir.includes('n'), south = dir.includes('s');
                    e.preventDefault();
                    try { e.target.setPointerCapture(pid); } catch { /* swallow: pointer capture is an optimization for tracking resizes off-element; resize still works via the document-level listeners below without it */ }
                    handle.el.classList.add('wm-resizing');
                    const onMove = ev => {
                        if (ev.pointerId !== pid) return;
                        const s = camera.scale || 1;
                        const dx = (ev.clientX - sx) / s;
                        const dy = (ev.clientY - sy) / s;
                        // Width/height grow from the anchored (opposite) edge. West/north
                        // edges also translate the origin so the far edge stays put.
                        let rawW = ow + (east ? dx : west ? -dx : 0);
                        let rawH = oh + (south ? dy : north ? -dy : 0);
                        const c = clampSize(fx, fy, rawW, rawH);
                        // Re-derive origin from the clamped size so the min-size floor
                        // pins the dragged edge instead of the anchored one.
                        const nx = west ? fx + ow - c.w : fx;
                        const ny = north ? fy + oh - c.h : fy;
                        // BOUNDS (not RESIZE) so west/north origin shifts persist too.
                        actor.send({ type: 'BOUNDS', x: nx, y: ny, w: c.w, h: c.h });
                        handle.setBounds({ x: nx, y: ny, w: c.w, h: c.h });
                        notifyChange();
                    };
                    const onUp = ev => {
                        if (ev.pointerId !== pid) return;
                        document.removeEventListener('pointermove', onMove);
                        document.removeEventListener('pointerup', onUp);
                        document.removeEventListener('pointercancel', onUp);
                        gestureTeardown = null;
                        try { e.target.releasePointerCapture(pid); } catch { /* swallow: capture may already have been released implicitly (e.g. pointercancel, element detached); nothing left to release */ }
                        handle.el.classList.remove('wm-resizing');
                        if (!windows.has(id)) { resizeInProgress = false; return; }
                        resizeInProgress = false;
                        notifyChange();
                    };
                    document.addEventListener('pointermove', onMove);
                    document.addEventListener('pointerup', onUp);
                    document.addEventListener('pointercancel', onUp);
                    gestureTeardown = () => {
                        document.removeEventListener('pointermove', onMove);
                        document.removeEventListener('pointerup', onUp);
                        document.removeEventListener('pointercancel', onUp);
                        gestureTeardown = null;
                    };
                },
            },
        });

        canvas.appendChild(handle.el);
        handle.el.dataset.id = id;
        // a11y: windows are dialogs in the desktop metaphor; expose role + an
        // accessible name bound to the (possibly-updated-later) title text.
        handle.el.setAttribute('role', 'dialog');
        handle.el.setAttribute('aria-label', title || t('wm.defaultWindowTitle', 'window'));

        // Double-click titlebar -> toggle maximize
        const bar = handle.el.querySelector('.wm-bar');
        if (bar) {
            bar.addEventListener('dblclick', () => {
                const v = !state.maximized;
                resetCameraForMaximize(v);
                actor.send({ type: 'MAXIMIZE', value: v });
                handle.setMaximized(v);
                notifyChange();
            });
            // Right-click titlebar -> context menu
            bar.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showWindowMenu(id, e.clientX, e.clientY, e);
            });
        }

        const w = {
            id,
            handle,
            actor,
            get el() { return handle.el; },
            get titleEl() { return handle.el.querySelector('.wm-title'); },
            get bodyEl() { return handle.el.querySelector('.wm-body'); },
            // The vendored kit's shell.js openApp (>=0.0.449) spawns async-app
            // windows with a 'loading…' placeholder and swaps the real content
            // in via win.setBody(node) once the factory promise resolves —
            // without this delegation every lazy-loaded app (notes/files/
            // snake/...) stayed on the placeholder forever. Pure pass-through
            // to the renderWindow handle's own setBody.
            setBody: (b) => handle.setBody(b),
            kind,
            instanceId,
            get minimized() { return state.minimized; },
            get maximized() { return state.maximized; },
            get z() { return actor.getSnapshot().context.z; },
            get x() { return actor.getSnapshot().context.x; },
            get y() { return actor.getSnapshot().context.y; },
            get width() { return actor.getSnapshot().context.w; },
            get height() { return actor.getSnapshot().context.h; },
            get _dragInProgress() { return dragInProgress; },
            get _resizeInProgress() { return resizeInProgress; },
            _endGesture: () => {
                gestureTeardown && gestureTeardown();
                // gestureTeardown only unbinds the document listeners; onUp (which
                // clears these flags) is one of the listeners just torn down and so
                // will never fire. Reset them here too, or any caller that ends a
                // gesture without immediately discarding the window permanently
                // wedges its drag/resize (pointerdown guard stays latched true).
                dragInProgress = false;
                resizeInProgress = false;
                snapTarget = null;
            },
            // Persistence unit: the actor's persisted snapshot is the canonical
            // serialization of this window's state.
            getPersistedSnapshot: () => actor.getPersistedSnapshot(),
            _dispose: () => {},
        };
        // appId is part of machine context; mirror it onto the actor when set.
        Object.defineProperty(w, 'appId', {
            get() { return actor.getSnapshot().context.appId; },
            set(v) { actor.send({ type: 'SET_APP', appId: v }); },
        });
        windows.set(id, w);
        if (zCounter >= Z_RENORMALIZE_THRESHOLD) renormalizeZ();

        // Paint min/max state for EVERY open path — fresh spawns can arrive
        // with the flags already set (shell-geometry computeSpawnRect marks
        // spawns maximized on sub-768px wm-root widths), while renderWindow
        // only applies the classes it is explicitly handed at creation. Without
        // this the actor flag and the DOM class desync: a maximized spawn
        // renders at its inline spawn rect (titlebar hidden under the menubar)
        // instead of the CSS maximized geometry.
        if (state.maximized) handle.setMaximized(true);
        if (state.minimized) handle.setMinimized(true);

        // Restore path: a rehydrated actor already carries the prior geometry.
        // Paint the handle to match so the DOM reflects machine state without
        // any button-click simulation (min/max painted unconditionally above).
        if (snapshot) {
            const c = actor.getSnapshot().context;
            handle.setBounds({ x: c.x, y: c.y, w: c.w, h: c.h });
            if (c.appId) { /* appId already in context */ }
        }

        // Context menu event listener for window actions
        const contextMenuHandler = (e) => {
            if (e.detail.winId !== id) return;
            if (e.detail.action === 'maximize') {
                const v = !state.maximized;
                resetCameraForMaximize(v);
                actor.send({ type: 'MAXIMIZE', value: v });
                handle.setMaximized(v);
                notifyChange();
            } else if (e.detail.action === 'minimize') {
                const v = !state.minimized;
                actor.send({ type: 'MINIMIZE', value: v });
                handle.setMinimized(v);
                notifyChange();
            } else if (e.detail.action === 'close') {
                close(id);
            }
        };
        window.addEventListener('wm-context', contextMenuHandler);
        w._dispose = () => { window.removeEventListener('wm-context', contextMenuHandler); };

        // On restore path, only focus the window whose persisted snapshot had
        // focused=true; focusing every restored window would leave the last-restored
        // window focused regardless of what the user was actually working on.
        if (!snapshot || actor.getSnapshot().context.focused) {
            focus(id);
        }
        // A new window changes wm.count, which the persist callback (also
        // driving the first-run hint's dismiss-on-first-window check) needs
        // to observe — every other window mutation already calls this, open()
        // was the one path that didn't, leaving the hint stuck open forever.
        notifyChange();
        return w;
    }

    function close(id) {
        const w = windows.get(id);
        if (!w) return;
        // Call the app's own dispose if shell.openApp attached one — without
        // this, app-level intervals (Workspaces refresh tick, GM polling, etc.)
        // keep running after the window closes.
        try { w._app && w._app.dispose && w._app.dispose(); } catch (e) { console.warn('[wm] _app.dispose threw:', e); }
        // Tear down any in-progress drag/resize gesture — without this, the dangling
        // document-level onMove keeps firing on a stopped actor / disposed handle.
        try { w._endGesture(); } catch { /* swallow: no gesture may be in progress (endGesture is a no-op guard already); closing must proceed regardless */ }
        // A mid-drag close tears down the gesture's own pointermove/pointerup listeners
        // above, so if a snap-preview overlay was showing, nothing left is responsible
        // for hiding it — clear it explicitly here too.
        try { hideSnapPreview(); } catch { /* swallow: hideSnapPreview is a no-op guard already */ }
        w._dispose && w._dispose();
        try { w.actor && w.actor.stop(); } catch { /* swallow: actor may already be stopped; window is being torn down either way */ }
        w.handle.dispose();
        windows.delete(id);
        if (focused === id) {
            focused = null;
            const next = [...windows.values()].sort((a, b) => b.z - a.z)[0];
            if (next && !next.minimized) focus(next.id);
        }
        // Persist like every other mutation — without this the closed (or now
        // empty) window set isn't saved, so a refresh resurrects the window.
        notifyChange();
    }

    function cycleFocus(reverse = false) {
        const ids = [...windows.keys()];
        if (!ids.length) return;
        const idx = focused ? ids.indexOf(focused) : -1;
        const nextIdx = reverse ? (idx <= 0 ? ids.length - 1 : idx - 1) : ((idx + 1) % ids.length);
        focus(ids[nextIdx]);
    }

    document.addEventListener('keydown', e => {
        // Alt+Tab switcher overlay
        if (e.altKey && e.key === 'Tab') {
            e.preventDefault();
            const ids = [...windows.keys()];
            if (!ids.length) return;
            if (!switcherIds) {
                switcherIds = ids;
                const curIdx = focused ? ids.indexOf(focused) : -1;
                switcherIdx = e.shiftKey
                    ? (curIdx <= 0 ? ids.length - 1 : curIdx - 1)
                    : ((curIdx + 1) % ids.length);
                altHeld = true;
                buildSwitcher();
            } else {
                switcherIdx = e.shiftKey
                    ? (switcherIdx <= 0 ? switcherIds.length - 1 : switcherIdx - 1)
                    : ((switcherIdx + 1) % switcherIds.length);
                renderSwitcher();
            }
            return;
        }

        // Ctrl+W: close focused
        if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
            e.preventDefault();
            if (focused) close(focused);
            return;
        }

        // Meta/Ctrl+0 or Meta+Home: fit-to-windows (frame all windows; infinite-canvas go-home).
        if (((e.metaKey || e.ctrlKey) && e.key === '0') || (e.metaKey && e.key === 'Home')) {
            e.preventDefault();
            fitToWindows();
            return;
        }
        // Meta/Ctrl+9: reset camera to 1:1 origin.
        if ((e.metaKey || e.ctrlKey) && e.key === '9') {
            e.preventDefault();
            camera.reset();
            return;
        }

        // Meta+D: show desktop toggle
        if (e.metaKey && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            if (_showDesktopMemo) {
                // Restore exactly the windows that show-desktop minimized (those
                // already minimized by the user before the toggle were never memoed,
                // so they stay minimized). One pass; setMinimized(false) is idempotent.
                for (const id of _showDesktopMemo) {
                    const w = windows.get(id);
                    if (w) {
                        w.actor.send({ type: 'MINIMIZE', value: false });
                        w.handle.setMinimized(false);
                    }
                }
                _showDesktopMemo = null;
            } else {
                _showDesktopMemo = new Set();
                for (const [id, w] of windows) {
                    if (!w.minimized) {
                        _showDesktopMemo.add(id);
                        w.actor.send({ type: 'MINIMIZE', value: true });
                        w.handle.setMinimized(true);
                    }
                }
            }
            notifyChange();
            return;
        }

        // Meta+ArrowLeft / Right / Up / Down
        if (e.metaKey && focused) {
            const w = windows.get(focused);
            if (!w) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const g = leftHalfGeom();
                w.handle.setBounds(g);
                w.actor.send({ type: 'BOUNDS', x: g.x, y: g.y, w: g.w, h: g.h });
                notifyChange();
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                const g = rightHalfGeom();
                w.handle.setBounds(g);
                w.actor.send({ type: 'BOUNDS', x: g.x, y: g.y, w: g.w, h: g.h });
                notifyChange();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                resetCameraForMaximize(true);
                w.handle.setMaximized(true);
                w.actor.send({ type: 'MAXIMIZE', value: true });
                notifyChange();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (w.maximized) {
                    w.handle.setMaximized(false);
                    w.actor.send({ type: 'MAXIMIZE', value: false });
                } else {
                    w.handle.setMinimized(true);
                    w.actor.send({ type: 'MINIMIZE', value: true });
                }
                notifyChange();
                return;
            }
        }

        // a11y: keyboard resize path for the focused window. Ctrl+Alt+Arrow is
        // unbound elsewhere (Meta+Arrow already owns move/snap/maximize/minimize
        // above; Alt+Tab owns plain Alt+Tab), so it's free for a non-invasive
        // step-resize that doesn't touch the existing mouse/touch resize handles.
        if (e.ctrlKey && e.altKey && focused) {
            const w = windows.get(focused);
            if (w && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                const STEP = 20;
                const b = w.handle.getBounds();
                let rawW = b.w + (e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0);
                let rawH = b.h + (e.key === 'ArrowDown' ? STEP : e.key === 'ArrowUp' ? -STEP : 0);
                const c = clampSize(b.x, b.y, rawW, rawH);
                w.handle.setBounds({ x: b.x, y: b.y, w: c.w, h: c.h });
                w.actor.send({ type: 'BOUNDS', x: b.x, y: b.y, w: c.w, h: c.h });
                notifyChange();
                return;
            }
        }
    }, { capture: true });

    document.addEventListener('keyup', e => {
        // Commit Alt+Tab switcher on Alt release
        if ((e.key === 'Alt' || e.altKey === false) && switcherIds) {
            closeSwitcher(true);
            altHeld = false;
        }
    }, { capture: true });

    window.addEventListener('blur', () => {
        // Focus left the document (native window switch, devtools, etc.) while
        // the switcher was open and Alt held -- no keyup will ever arrive here,
        // so close without committing to avoid a stale orphaned overlay/index.
        if (switcherIds) {
            closeSwitcher(false);
            altHeld = false;
        }
    });

    // (Removed the resize->re-clamp-into-viewport handler: on the infinite canvas
    // clampMove is unbounded, so re-clamping is a no-op. A window that grows
    // off-view when the host window resizes is intentional now — pan/zoom or
    // Meta+0 fitToWindows brings it back, which is the canvas's go-home affordance.)

    function get(id) {
        return windows.get(id) || null;
    }

    function list() {
        return [...windows.values()].map(w => {
            const b = w.handle.getBounds();
            return { id: w.id, title: w.titleEl ? w.titleEl.textContent : '', kind: w.kind, appId: w.appId || '', instanceId: w.instanceId || '', x: b.x, y: b.y, width: b.w, height: b.h, focused: w.id === focused, z: w.z, minimized: w.minimized, maximized: w.maximized };
        });
    }

    function move(id, x, y) {
        const w = windows.get(id);
        if (!w) return;
        if (w._dragInProgress || w._resizeInProgress) return;
        const b = w.handle.getBounds();
        const c = clampMove(x, y, b.w, b.h);
        w.handle.setBounds({ x: c.x, y: c.y });
        w.actor.send({ type: 'MOVE', x: c.x, y: c.y });
        notifyChange();
    }

    function resizeTo(id, w_, h) {
        const w = windows.get(id);
        if (!w) return;
        if (w._dragInProgress || w._resizeInProgress) return;
        const b = w.handle.getBounds();
        const c = clampSize(b.x, b.y, w_, h);
        w.handle.setBounds({ w: c.w, h: c.h });
        w.actor.send({ type: 'RESIZE', w: c.w, h: c.h });
        notifyChange();
    }

    // Direct min/max APIs — the restore path uses these to set window state
    // from a persisted snapshot WITHOUT simulating titlebar button clicks
    // (the prior approach was fragile: it depended on the kit's .wm-btn DOM).
    function setMaximized(id, value) {
        const w = windows.get(id);
        if (!w) return;
        const v = !!value;
        w.actor.send({ type: 'MAXIMIZE', value: v });
        w.handle.setMaximized(v);
        notifyChange();
    }
    function setMinimized(id, value) {
        const w = windows.get(id);
        if (!w) return;
        const v = !!value;
        w.actor.send({ type: 'MINIMIZE', value: v });
        w.handle.setMinimized(v);
        notifyChange();
    }

    // "Fit to windows" / go-home: frame all visible windows (optionally for one
    // instance) into the viewport. The recovery affordance for the unbounded
    // infinite canvas — you can always get back to where your windows are.
    function fitToWindows(instanceId) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
        for (const w of windows.values()) {
            if (w.minimized) continue;
            if (instanceId && w.instanceId && w.instanceId !== instanceId) continue;
            const b = w.handle.getBounds();
            minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
            n++;
        }
        if (!n) { camera.reset(); return; }
        camera.fitToRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }

    // A rotate/keyboard re-frame lands on a debounce timer, so it can fire
    // while a pointerdown drag/resize gesture is still live (e.g. mid-drag
    // when a nested input's focus pops the OS keyboard and shrinks the
    // visualViewport). The gesture's onMove keeps converting screen->canvas
    // coordinates off the ORIGINAL captured anchor; rewriting camera
    // scale/pan underneath it mid-gesture makes the window jump/diverge
    // from the pointer. Skip the fit while any window is mid-gesture —
    // fitToWindows() is best-effort recovery, not correctness-critical, so
    // dropping this one debounced call is safe (the next resize/orientation
    // event re-fires it after the gesture ends).
    function anyGestureInProgress() {
        for (const w of windows.values()) {
            if (w._dragInProgress || w._resizeInProgress) return true;
        }
        return false;
    }

    // Touch-only orientation recovery. The desktop infinite canvas intentionally
    // lets windows live off-view (pan/zoom or Meta+0 brings them back). But a
    // touch phone/tablet has no keyboard Meta+0, so after a portrait<->landscape
    // rotate a window stranded below the fold is unreachable. On a coarse pointer
    // only, re-frame all windows into the (re-measured) viewport after a rotate
    // so nothing is left off-canvas. Desktop behavior is untouched.
    // Listener refs are stored so dispose() can remove them when the shell tears down.
    let _orientationMq = null;
    let _onRotate = null;
    if (typeof window !== 'undefined' && window.matchMedia) {
        const coarse = window.matchMedia('(pointer: coarse)');
        let rotateTimer = null;
        _onRotate = () => {
            if (!coarse.matches) return;
            // debounce: the viewport metrics settle a frame or two after the event
            if (rotateTimer) clearTimeout(rotateTimer);
            rotateTimer = setTimeout(() => { try { if (!anyGestureInProgress()) fitToWindows(getActiveInstanceId ? getActiveInstanceId() : undefined); } catch (e) { /* swallow: re-frame after rotate is best-effort; a transient DOM/measurement error here shouldn't surface to the user */ } }, 250);
        };
        window.addEventListener('orientationchange', _onRotate);
        _orientationMq = window.matchMedia('(orientation: portrait)');
        if (_orientationMq) {
            try { _orientationMq.addEventListener('change', _onRotate); } catch (e) { /* swallow: older browsers' MediaQueryList may lack addEventListener (addListener-only); orientationchange listener above still covers rotation */ }
        }
    }

    // Mobile on-screen keyboard recovery. Most mobile browsers never fire a
    // window 'resize' when the virtual keyboard opens/closes and shrinks the
    // usable viewport — only visualViewport 'resize' does. A focused input
    // (composer/terminal) inside a window can end up covered by the
    // keyboard. This must NOT call fitToWindows() — that resets the whole
    // desktop camera's scale/pan to frame all windows, which fires on every
    // keyboard open AND close (visualViewport fires both ways) and discards
    // the user's pan/zoom position on every tap into a text field, without
    // even reliably uncovering the input (fitToRect frames window bounds,
    // not caret position). Instead, scroll only the currently-focused
    // element into view — targeted at the actual caret, camera untouched.
    // Coarse-pointer only, same rationale as the orientation handler above;
    // debounced the same way.
    let _onViewportResize = null;
    if (typeof window !== 'undefined' && window.visualViewport && window.matchMedia) {
        const coarseVv = window.matchMedia('(pointer: coarse)');
        let vvTimer = null;
        _onViewportResize = () => {
            if (!coarseVv.matches) return;
            if (vvTimer) clearTimeout(vvTimer);
            vvTimer = setTimeout(() => {
                try {
                    const el = document.activeElement;
                    if (el && el !== document.body && typeof el.scrollIntoView === 'function') {
                        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    }
                } catch (e) { /* swallow: keyboard-open scroll recovery is best-effort; a transient DOM/measurement error here shouldn't surface to the user */ }
            }, 250);
        };
        window.visualViewport.addEventListener('resize', _onViewportResize);
    }

    function dispose() {
        if (_onRotate) {
            try { window.removeEventListener('orientationchange', _onRotate); } catch { /* swallow: listener may already be removed or window may be gone during teardown */ }
            if (_orientationMq) {
                try { _orientationMq.removeEventListener('change', _onRotate); } catch { /* swallow: older browsers' MediaQueryList may lack removeEventListener, or listener already removed */ }
            }
            _onRotate = null;
            _orientationMq = null;
        }
        if (_onViewportResize && typeof window !== 'undefined' && window.visualViewport) {
            try { window.visualViewport.removeEventListener('resize', _onViewportResize); } catch { /* swallow: listener may already be removed or window may be gone during teardown */ }
            _onViewportResize = null;
        }
    }

    // get(id) returns the LIVE window handle (bodyEl, _app, actor, ...) as
    // opposed to list()'s intentionally-plain snapshots — needed by
    // docs/lib/hot-reload.js (node swap into bodyEl) and
    // docs/lib/user-apps.js (view-state stamping onto _app). Use list() for
    // anything that only reads geometry/appId.
    const wm = { open, close, focus, cycleFocus, get, list, move, resizeTo, setMaximized, setMinimized, camera, fitToWindows, dispose, get focused() { return focused; }, get count() { return windows.size; } };

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.wm = wm;
    }
    return wm;
}
