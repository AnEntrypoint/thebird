// Pure-DOM column state for WorkspaceShell: desktop collapse toggles, the
// drag/keyboard resize handle and its clamps, the persisted-width seeder, and
// the mobile drawer open/close (with Esc + focus-trap + viewport auto-close).
// WorkspaceShell itself is stateless chrome, so all of this lives as classes
// and inline --ws-*-w vars on .ws-shell rather than in a host store.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { trapTab } from '../overlay-primitives.js';
const h = webjsx.createElement;

// Toggle a named WorkspaceShell column (left rail or right pane). Pure-DOM like
// toggleSide: WorkspaceShell is stateless chrome, the collapsed class lives on
// .ws-shell and is read by both CSS and the toggle buttons' aria-expanded.
export function toggleWs(which, fromEl) {
    // Scope to the shell owning the clicked control, like toggleSide — the
    // first-on-page querySelector toggles the WRONG shell with two instances.
    const shell = (fromEl && fromEl.closest && fromEl.closest('.ws-shell')) || document.querySelector('.ws-shell');
    if (!shell) return;
    const cls = which === 'pane' ? 'ws-pane-collapsed'
        : which === 'sessions' ? 'ws-sessions-collapsed'
        : 'ws-rail-collapsed';
    const nowCollapsed = shell.classList.toggle(cls);
    // Inline --ws-*-w beats the collapsed-class rule in the cascade, so a
    // persisted width would render a "collapsed" column 200-640px wide.
    if (nowCollapsed) shell.style.removeProperty('--ws-' + which + '-w');
    shell.querySelectorAll('.ws-' + which + '-toggle').forEach((btn) => {
        btn.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        const nextLabel = nowCollapsed ? 'expand ' + which : 'collapse ' + which;
        btn.setAttribute('aria-label', nextLabel);
        btn.setAttribute('title', nextLabel);
    });
    try {
        localStorage.setItem('ds.ws.' + which, nowCollapsed ? 'collapsed' : 'open');
    } catch (_) { /* swallow: persistence is best-effort, collapse state still applies in-memory */ }
    // Expanding restores the persisted width (seed skips collapsed columns, so
    // it must run after the open flag is written).
    if (!nowCollapsed) seedWsWidths(shell);
}

// Column resize: read the current rendered track width and write a clamped inline
// --ws-<col>-w on .ws-shell (inline overrides the fluid clamp base), persisted.
// Floors match the CSS fluid clamp() floors in app-shell.css (--ws-rail-w
// clamp(200,16vw,260); sessions clamp(248,22vw,360); pane clamp(288,24vw,420))
// so a drag/arrow can never shrink a column below its designed minimum (the
// collapsed rail is a SEPARATE class, not a resize target). The ceilings are
// INTENTIONALLY raised above the fluid clamp() mid-term ceilings: on wide
// viewports the 16/22/24vw mid term already pins each column to its clamp
// ceiling, so a ceiling-equals-clamp bound made the outward drag inert there.
// The higher resize ceilings let a deliberate drag/arrow grow a column past its
// auto-fluid width (the inline --ws-<col>-w override pins the chosen width past
// the clamp base).
const WS_RESIZE_CLAMP = { rail: [200, 320], sessions: [248, 520], pane: [288, 640] };
function wsResize(col, dx, persist = true, fromEl) {
    const shell = (fromEl && fromEl.closest && fromEl.closest('.ws-shell')) || document.querySelector('.ws-shell');
    if (!shell) return;
    const track = shell.querySelector('.ws-' + col);
    const cur = track ? track.getBoundingClientRect().width : 0;
    const [lo, hi] = WS_RESIZE_CLAMP[col] || [120, 600];
    const next = Math.max(lo, Math.min(hi, Math.round(cur + dx)));
    shell.style.setProperty('--ws-' + col + '-w', next + 'px');
    const handle = shell.querySelector('.ws-resizer-' + col);
    if (handle) { handle.setAttribute('aria-valuenow', String(next)); handle.setAttribute('aria-valuetext', next + ' pixels'); }
    // Commit to storage only on a settled move (pointerup / keyboard), not on
    // every pointermove frame (that fired dozens of synchronous writes per drag).
    if (persist) { try { localStorage.setItem('ds.ws.w.' + col, String(next)); } catch (_) { /* swallow: persistence is best-effort, resize still applies in-memory */ } }
}
// Per-column viewport caps for persisted widths: a width dragged on a wide
// monitor must not crush the content column when the page reloads on a
// narrower screen (rail 320 + sessions 520 would leave ~180px of content).
const WS_VW_CAP = { rail: '20vw', sessions: '30vw', pane: '32vw' };
export function seedWsWidths(el) {
    if (!el) return;
    ['rail', 'sessions', 'pane'].forEach((col) => {
        try {
            // A persisted-collapsed column must stay collapsed: the inline var
            // would beat the .ws-*-collapsed class rule in the cascade.
            if (wsCollapsed(col, false)) return;
            const v = localStorage.getItem('ds.ws.w.' + col);
            if (v && /^\d+$/.test(v)) el.style.setProperty('--ws-' + col + '-w', `min(${v}px, ${WS_VW_CAP[col]})`);
        } catch (_) { /* swallow: localStorage unavailable, seeding is best-effort */ }
    });
}
export function WsResizer(col) {
    const onKey = (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); wsResize(col, -16, true, e.currentTarget); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); wsResize(col, 16, true, e.currentTarget); }
    };
    const onDown = (e) => {
        e.preventDefault();
        const handleEl = e.currentTarget;
        handleEl.classList.add('ws-resizer-active');
        let lastX = e.clientX;
        const move = (ev) => { const dx = ev.clientX - lastX; lastX = ev.clientX; wsResize(col, dx, false, handleEl); };
        const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            document.body.style.cursor = '';
            handleEl.classList.remove('ws-resizer-active');
            wsResize(col, 0, true, handleEl); // commit the settled width once
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.body.style.cursor = 'col-resize';
    };
    const [lo, hi] = WS_RESIZE_CLAMP[col] || [120, 600];
    // Seed aria-valuenow from the rendered track width so AT announces real
    // widths. Deferred a frame: the resizers are rendered as the LAST children
    // of .ws-shell, so at ref time the .ws-<col> track is not in the DOM yet
    // and this measured nothing — aria-valuenow was simply never set, which is
    // what `aria-required-attr` (role=separator requires it) was reporting.
    // The markup below now also ships a valid value up-front, so the attribute
    // is present even if this correction never runs.
    const seedNow = (el) => {
        if (!el) return;
        const measure = () => {
            const shell = el.closest('.ws-shell');
            const track = shell && shell.querySelector('.ws-' + col);
            if (!track) return;
            const w = Math.round(track.getBoundingClientRect().width);
            if (!w) return;
            el.setAttribute('aria-valuenow', String(w));
            el.setAttribute('aria-valuetext', w + ' pixels');
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
        else measure();
    };
    return h('div', {
        class: 'ws-resizer ws-resizer-' + col, role: 'separator', tabindex: '0',
        'aria-orientation': 'vertical', 'aria-label': 'resize ' + col + ' column (arrow keys)',
        // valuenow/valuetext seeded at the clamp MINIMUM (and corrected to the
        // measured width by seedNow on the next frame). The previous markup
        // omitted aria-valuenow entirely — required by role=separator when it
        // is focusable — and hardcoded valuetext to the clamp MAXIMUM, so the
        // announced width contradicted the actual one.
        'aria-valuemin': String(lo), 'aria-valuemax': String(hi),
        'aria-valuenow': String(lo), 'aria-valuetext': String(lo) + ' pixels',
        onpointerdown: onDown, onkeydown: onKey, ref: seedNow,
    });
}

// Toggle a mobile WorkspaceShell DRAWER (sessions or pane). Distinct from the
// desktop width-collapse (toggleWs): on mobile the columns are fixed overlays
// revealed by .ws-sessions-open / .ws-pane-open. Opening one closes the other
// (only one drawer at a time over the content). Esc + scrim dismiss call this
// with open=false. Pure-DOM, matching the AppShell toggleSide pattern.
export function toggleWsDrawer(which, open, fromEl) {
    const shell = (fromEl && fromEl.closest && fromEl.closest('.ws-shell')) || document.querySelector('.ws-shell');
    if (!shell) return;
    const cls = which === 'pane' ? 'ws-pane-open' : 'ws-sessions-open';
    const other = which === 'pane' ? 'ws-sessions-open' : 'ws-pane-open';
    const next = open != null ? open : !shell.classList.contains(cls);
    shell.classList.toggle(cls, next);
    if (next) shell.classList.remove(other);
    const btn = shell.querySelector('.ws-' + which + '-drawer-toggle');
    if (btn) btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (!next) { removeWsDrawerHandlers(shell); return; }
    // When opening, move focus into the drawer, arm an Esc-to-close, and trap
    // Tab/Shift+Tab inside the drawer (a real focus trap, matching the kit's
    // own dialogs - Tab from inside an open drawer previously walked focus out
    // into the scrim/background content behind it).
    const drawer = shell.querySelector(which === 'pane' ? '.ws-pane' : '.ws-sessions');
    const focusable = drawer && drawer.querySelector('button, a, input, [tabindex]');
    if (focusable) try { focusable.focus(); } catch (_) { /* swallow: focus() can throw on a detached/hidden element, drawer still opens */ }
    removeWsDrawerHandlers(shell); // replace, never stack (opening one drawer over the other)
    const onKey = (e) => {
        if (e.key === 'Escape') { toggleWsDrawer(which, false, shell); if (btn) try { btn.focus(); } catch (_) { /* swallow: focus() can throw on a detached/hidden element */ } return; }
        if (drawer) trapTab(drawer, e);
    };
    shell._wsEscHandler = onKey;
    document.addEventListener('keydown', onKey);
    // The drawer CSS stops applying above its breakpoint; auto-close when the
    // viewport grows past it so the open class and armed Esc/focus-trap
    // handlers do not linger invisibly in desktop layout.
    const mq = window.matchMedia('(max-width: 1480px)');
    const onMq = () => { if (!mq.matches) closeWsDrawers(shell); };
    shell._wsDrawerMq = { mq, onMq };
    mq.addEventListener('change', onMq);
}
function removeWsDrawerHandlers(shell) {
    // Remove Esc/focus-trap handler armed by toggleWsDrawer (prevents ghost
    // close on next Esc) and the viewport-growth auto-close listener.
    if (shell._wsEscHandler) { document.removeEventListener('keydown', shell._wsEscHandler); shell._wsEscHandler = null; }
    if (shell._wsDrawerMq) { shell._wsDrawerMq.mq.removeEventListener('change', shell._wsDrawerMq.onMq); shell._wsDrawerMq = null; }
}
export function closeWsDrawers(fromEl) {
    const shell = (fromEl && fromEl.closest && fromEl.closest('.ws-shell')) || document.querySelector('.ws-shell');
    if (!shell) return;
    shell.classList.remove('ws-sessions-open', 'ws-pane-open');
    shell.querySelectorAll('.ws-sessions-drawer-toggle, .ws-pane-drawer-toggle').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    removeWsDrawerHandlers(shell);
}

// Read persisted collapse state for a WorkspaceShell column so the layout is
// predictable across reloads (Claude-Desktop keeps the rail where you left it).
export function wsCollapsed(which, fallback) {
    try {
        const v = localStorage.getItem('ds.ws.' + which);
        if (v === 'collapsed') return true;
        if (v === 'open') return false;
    } catch (_) { /* swallow: localStorage unavailable, fall back to caller-supplied default */ }
    return !!fallback;
}
