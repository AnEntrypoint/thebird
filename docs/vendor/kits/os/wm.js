// Window manager paint surface — pure DOM rendering, no state machine.
// Consumer (thebird) owns z-order, focus stack, alt-tab, drag/resize math.
// renderWindow returns a handle whose setBounds is called from pointermove.
//
// Visuals are bible-aligned: mac-less chip buttons (SVG minimize/maximize/
// close icons via ./icons.js, not raw ASCII glyphs — matches every other
// icon surface in this kit), inset 4px rail for focus, CSS-gradient resize
// affordance (no glyph), pointer-events:none on .wm-bar with auto on
// title+close so phone @media auto-maximize can suppress drag without a JS
// branch.

import { icons } from './icons.js';

// Shared aria-live announcer for window open/close/focus-change events.
// Visually hidden, one instance per document, lazily created so importing
// this module has no side effect until a window actually renders. Screen
// readers get no other signal that a floating, non-modal window opened,
// closed, or changed focus -- there is no page navigation or route change
// to announce it implicitly, unlike a normal document flow.
let _announcer = null;
function getAnnouncer() {
    if (_announcer && _announcer.isConnected) return _announcer;
    _announcer = document.getElementById('wm-announcer');
    if (_announcer) return _announcer;
    _announcer = document.createElement('div');
    _announcer.id = 'wm-announcer';
    _announcer.setAttribute('aria-live', 'polite');
    _announcer.setAttribute('aria-atomic', 'true');
    _announcer.className = 'sr-only';
    // Inline fallback in case the consuming page's stylesheet doesn't define
    // .sr-only (this module has no guaranteed CSS import of its own) --
    // standard clip-based visually-hidden-but-AT-visible technique.
    _announcer.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
    document.body.appendChild(_announcer);
    return _announcer;
}
function announce(text) {
    const a = getAnnouncer();
    // Clear-then-set on a microtask forces a re-announcement even if the
    // text is identical to what's already there (e.g. focusing the same
    // window twice in a row) -- aria-live only fires on a DOM mutation.
    a.textContent = '';
    requestAnimationFrame(() => { a.textContent = text; });
}

export function renderWindow(opts = {}) {
    const {
        title = 'window',
        body = null,
        bounds = { x: 60, y: 60, w: 480, h: 320 },
        focused = false,
        maximized = false,
        minimized = false,
        instanceId = '',
        kind = 'div',
        callbacks = {},
    } = opts;

    // Keep at least MIN px of the window horizontally inside the container and
    // the titlebar (BAR px) vertically reachable, so a window can always be
    // grabbed by pointer (persisted bounds from a larger viewport included).
    const MIN_VISIBLE = 60;
    const BAR_H = 36;
    function clampBounds(b, p) {
        const pw = p ? p.clientWidth : window.innerWidth;
        const ph = p ? p.clientHeight : window.innerHeight;
        const out = { ...b };
        if (typeof out.w === 'number') out.w = Math.min(out.w, pw);
        if (typeof out.h === 'number') out.h = Math.min(out.h, ph);
        if (typeof out.x === 'number') {
            const w = typeof out.w === 'number' ? out.w : MIN_VISIBLE;
            out.x = Math.max(MIN_VISIBLE - w, Math.min(out.x, pw - MIN_VISIBLE));
        }
        if (typeof out.y === 'number') out.y = Math.max(0, Math.min(out.y, ph - BAR_H));
        return out;
    }

    const el = document.createElement('div');
    el.className = 'wm-win';
    el.dataset.kind = kind;
    if (instanceId) el.dataset.instanceId = instanceId;
    // Floating window chrome is a dialog surface: role="dialog" (not
    // aria-modal, since sibling windows stay operable — this is a
    // non-modal multi-window desktop, not a blocking modal) + aria-label
    // from the titlebar text so AT announces which window has focus.
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    const b0 = clampBounds(bounds, null);
    el.style.left = b0.x + 'px';
    el.style.top = b0.y + 'px';
    el.style.width = b0.w + 'px';
    el.style.height = b0.h + 'px';

    const bar = document.createElement('div');
    bar.className = 'wm-bar';
    const titleEl = document.createElement('span');
    titleEl.className = 'wm-title';
    titleEl.textContent = title;
    const btns = document.createElement('div');
    btns.className = 'wm-btns';
    const minBtn = mkBtn(icons.minimize, 'minimize');
    const maxBtn = mkBtn(icons.maximize, 'maximize');
    const closeBtn = mkBtn(icons.close, 'close');
    btns.append(minBtn, maxBtn, closeBtn);
    bar.append(titleEl, btns);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'wm-body';
    setBodyContent(bodyEl, body);

    // Resize affordances: one grip per edge + corner. `data-dir` carries the
    // direction (n/s/e/w/ne/nw/se/sw) to the consumer's resize math. The SE
    // corner keeps the visible diagonal grip glyph (.wm-resize); the other
    // seven are invisible hit-zones (.wm-edge) styled in wm.css.
    // NOT KEYBOARD ACCESSIBLE: these grips only wire pointerdown (see below);
    // resize math is owned entirely by the consumer's pointermove handler
    // (module comment at top of file), so there is no keydown-driven delta to
    // wire without reaching into consumer-owned drag state. role="separator"
    // + aria-orientation give a screen reader a name for the affordance even
    // though it cannot be operated without a pointer -- an honest partial
    // label, not a claim of full keyboard support.
    const ORIENT = { n: 'horizontal', s: 'horizontal', ne: 'horizontal', nw: 'horizontal', se: 'horizontal', sw: 'horizontal', e: 'vertical', w: 'vertical' };
    const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    const grips = DIRS.map(dir => {
        const g = document.createElement('div');
        g.className = dir === 'se' ? 'wm-resize' : 'wm-edge';
        g.dataset.dir = dir;
        g.setAttribute('role', 'separator');
        g.setAttribute('aria-orientation', ORIENT[dir] || 'horizontal');
        g.setAttribute('aria-label', 'resize ' + dir + ' (pointer only)');
        return g;
    });

    el.append(bar, bodyEl, ...grips);

    minBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onMinimize && callbacks.onMinimize(); });
    maxBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onMaximize && callbacks.onMaximize(); });

    // Closing a window is destructive and unrecoverable (no undo), so it goes
    // through the same second-click-to-confirm arm/commit idiom as the
    // launcher dock's instance-close button: first click arms (visual +
    // aria-label cue), a second click within the window commits; losing
    // focus or the timeout elapsing disarms silently.
    let closeArmed = false;
    let closeArmTimer = null;
    function disarmClose() {
        closeArmed = false;
        if (closeArmTimer) { clearTimeout(closeArmTimer); closeArmTimer = null; }
        closeBtn.classList.remove('confirm');
        closeBtn.setAttribute('aria-label', 'close');
    }
    closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!closeArmed) {
            closeArmed = true;
            closeBtn.classList.add('confirm');
            closeBtn.setAttribute('aria-label', 'confirm close');
            closeArmTimer = setTimeout(disarmClose, 3000);
            return;
        }
        disarmClose();
        announce('closed ' + titleEl.textContent);
        callbacks.onClose && callbacks.onClose();
    });
    closeBtn.addEventListener('blur', disarmClose);

    const focus = () => {
        if (!el.classList.contains('wm-focused')) announce(titleEl.textContent + ' focused');
        callbacks.onFocus && callbacks.onFocus();
    };

    el.addEventListener('pointerdown', () => focus());

    // Basic focus trap: while this window carries .wm-focused, Tab/Shift+Tab
    // cycles only within its own focusable set instead of escaping to a
    // sibling window or the page behind it. Scoped to keydown on `el` itself
    // (additive listener, no DOM structure change) and gated on the class the
    // consumer already toggles via setFocused/applyFocused below, so an
    // unfocused window is completely untouched by this handler.
    el.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || !el.classList.contains('wm-focused')) return;
        const focusable = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });

    bar.addEventListener('pointerdown', e => {
        if (e.target.closest('.wm-btn')) return;
        e.stopPropagation();
        focus();
        if (callbacks.onDragStart) callbacks.onDragStart(e, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    });

    grips.forEach(g => g.addEventListener('pointerdown', e => {
        e.stopPropagation();
        focus();
        if (callbacks.onResizeStart) callbacks.onResizeStart(e, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, dir: g.dataset.dir });
    }));

    applyFocused(el, focused);
    applyMaximized(el, maximized);
    applyMinimized(el, minimized);
    announce('opened ' + title);

    return {
        el,
        setTitle(t) { titleEl.textContent = t; },
        setBody(b) { setBodyContent(bodyEl, b); },
        setBounds(b) {
            const c = clampBounds({
                ...b,
                w: typeof b.w === 'number' ? b.w : el.offsetWidth,
            }, el.offsetParent);
            if (typeof c.x === 'number') el.style.left = c.x + 'px';
            if (typeof c.y === 'number') el.style.top = c.y + 'px';
            if (typeof b.w === 'number') el.style.width = c.w + 'px';
            if (typeof b.h === 'number') el.style.height = c.h + 'px';
        },
        setFocused(v) { applyFocused(el, v); },
        setMaximized(v) { applyMaximized(el, v); },
        setMinimized(v) { animateMinimize(el, v); },
        setInstanceId(id) { if (id) el.dataset.instanceId = id; else delete el.dataset.instanceId; },
        setZIndex(z) { el.style.zIndex = String(z); },
        getBounds() { return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; },
        dispose() { if (closeArmTimer) clearTimeout(closeArmTimer); animateClose(el); },
    };
}

function mkBtn(svg, ttl) {
    const b = document.createElement('button');
    b.className = 'wm-btn';
    b.innerHTML = svg;
    b.title = ttl;
    b.setAttribute('aria-label', ttl);
    return b;
}

function setBodyContent(host, body) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (body instanceof Node) host.appendChild(body);
    else if (typeof body === 'string') host.innerHTML = body;
}

function applyFocused(el, v) { el.classList.toggle('wm-focused', !!v); }
function applyMaximized(el, v) { el.classList.toggle('wm-max', !!v); }
function applyMinimized(el, v) { el.classList.toggle('wm-min', !!v); }

function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// wm.css's `.wm-win.wm-min{display:none}` cannot be CSS-transitioned (display
// has no interpolable intermediate value), so a real minimize animation needs
// the display swap deferred until a scale+fade transition actually finishes.
// `.wm-minimizing`/`.wm-restoring` (theme.css) carry the transform+opacity
// keyframes; this only sequences when `wm-min` itself flips. 220ms fallback
// timer guards against a transitionend that never fires (element removed
// mid-transition, browser tab backgrounded and rAF/transitions paused, etc.)
// so a window can never get stuck invisible-but-not-display:none.
function animateMinimize(el, v) {
    if (reducedMotion()) { applyMinimized(el, v); return; }
    if (v) {
        el.classList.add('wm-minimizing');
        const done = () => { el.classList.remove('wm-minimizing'); applyMinimized(el, true); };
        el.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 220);
    } else {
        applyMinimized(el, false);
        el.classList.add('wm-restoring');
        setTimeout(() => el.classList.remove('wm-restoring'), 220);
    }
}

// Same display-can't-transition problem as minimize, but for the terminal
// close path: el.remove() used to happen synchronously, so a window vanished
// instantly with no close animation at all (the literal gap named in the
// "no animation on open/close" request). Fade+scale out, then remove.
function animateClose(el) {
    if (!el.isConnected) return;
    if (reducedMotion()) { el.remove(); return; }
    el.classList.add('wm-closing');
    const done = () => el.remove();
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 220);
}
