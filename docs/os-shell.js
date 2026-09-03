import { createWM, setWmPersistCallback } from './wm.js';
import { createFs } from './instance-fs.js';
import { createInstanceWorker } from './instance-worker.js';
import { createAppRegistry, resolveInstance } from './apps.js';
import { registerUserApps } from './lib/user-apps.js';
import { createDesktopShell } from './vendor/kits/os/index.js';
import { applyTheme, getTheme, resolvedTheme, onThemeChange } from './vendor/theme.js';
import { bootHost } from './freddie-loader.js';
import { getInstanceSW, installSwMessageRouter } from './sw-client.js';
import { loadGuiState, saveGuiState } from './gui-state.js';
import { attachSessionUI } from './session-ui.js';
import { createMachine, createActor, assign } from 'xstate';
import { t } from './vendor/i18n.js';
import './i18n-es.js'; // side effect: registers thebird's 'es' catalog against the vendored i18n primitive
import { MAX_RESTORE_INSTANCES } from './lib/instance-cap.js';
import { registerInstanceSource } from './lib/instance-registry.js';
import { setIcon } from './lib/dom.js';
import { kvGet, kvPut } from './lib/idb-kv.js';
import * as webjsx from './vendor/webjsx/index.js';
import { EmptyState, Icon, ShortcutList } from './vendor/components.js';

const LAST_INSTANCE_LS = 'thebird-last-instance';

// Bound on how long a worker's ready promise may stay unsettled during
// newInstance(). A crashed/misconfigured Worker that never signals ready
// would otherwise hang newInstance() forever — status stays 'booting'
// indefinitely with no 'error' transition and no boot-error toast.
const WORKER_READY_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Snapshot schema version. Bump when the persisted shape changes incompatibly;
// restore discards a mismatched snapshot and fresh-boots (see xstate-snapshot
// -version-migration). Lives in the persisted blob as `v`.
const SNAPSHOT_VERSION = 1;

// Hard ceiling on instances materialized from a persisted snapshot. A corrupt
// or pathological snapshot (each entry spawns an SW + IDB + Worker + host) must
// not be able to wedge boot by spawning an unbounded number of instances. Far
// above any realistic session (the switcher is menubar chips); excess is
// dropped. Shared with scripts/gen-static-sws.mjs via docs/lib/instance-cap.js
// (single source of truth) — see that file's comment for the invariant.

// The OS shell's restorable scalar state lives in this xstate machine's
// context. Live per-instance objects (worker/fs/sw handles) are NOT
// serializable and stay in the `instances` Map; the machine owns only what a
// refresh must resume: the instance-id roster, which one is active, the window
// counter, and the bars-hidden flag. Persisting === actor.getPersistedSnapshot;
// resuming === createActor(shellMachine, {snapshot}).
export const shellMachine = createMachine({
    id: 'shell',
    context: ({ input }) => ({
        counter: input?.counter ?? 0,
        activeInstance: input?.activeInstance ?? null,
        barsHidden: !!input?.barsHidden,
        // Per-instance lifecycle status: id -> 'booting'|'ready'|'error'.
        // Extends this SAME actor's context (xstate-everywhere: no parallel enum,
        // no second machine) rather than tracking status outside the shell actor.
        // 'booting' is set the moment newInstance() starts creating an id; 'ready'
        // on successful creation; 'error' if creation throws. There is no
        // genuine in-shell "installing" concept (any npm install runs inside a
        // terminal shell instance, not during instance boot), so that value was
        // removed rather than kept as unused dead accommodation.
        instanceStatus: input?.instanceStatus ?? {},
    }),
    initial: 'booting',
    states: {
        booting: { on: { READY: 'ready' } },
        ready: {},
    },
    on: {
        SET_COUNTER: { actions: assign({ counter: ({ event }) => event.counter }) },
        BUMP_COUNTER: { actions: assign({ counter: ({ context }) => context.counter + 1 }) },
        SET_ACTIVE: { actions: assign({ activeInstance: ({ event }) => event.id }) },
        SET_BARS_HIDDEN: { actions: assign({ barsHidden: ({ event }) => event.value }) },
        SET_INSTANCE_STATUS: {
            actions: assign({
                instanceStatus: ({ context, event }) => ({ ...context.instanceStatus, [event.id]: event.status }),
            }),
        },
        CLEAR_INSTANCE_STATUS: {
            actions: assign({
                instanceStatus: ({ context, event }) => {
                    const next = { ...context.instanceStatus };
                    delete next[event.id];
                    return next;
                },
            }),
        },
    },
});

// Inject a 3-state theme toggle (auto / paper / ink) into the OS menubar's
// tray region. Reuses the upstream theme controller — applyTheme writes
// localStorage('247420:theme') and sets <html data-theme>, which the kit CSS
// rules in colors_and_type.css consume. Without this surface the system
// theme is fixed by whatever <html data-theme> the page boots with.
function mountThemeToggle(menubar) {
    const tray = menubar.querySelector('.os-tray');
    if (!tray) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'os-btn os-theme';
    btn.title = t('shell.themeToggleTitle', 'theme');
    const labelEl = document.createElement('span');
    labelEl.className = 'os-theme-label';
    btn.appendChild(labelEl);
    // Theme-toggle icons come from the upstream kit's icon table (no decorative
    // glyph literals in thebird source). auto=contrast, paper=sun, ink=moon.
    const ICON = { auto: 'contrast', paper: 'sun', ink: 'moon' };
    function paint() {
        const mode = getTheme();
        const res = resolvedTheme();
        setIcon(labelEl, ICON[mode] || ICON.auto);
        btn.dataset.themeMode = mode;
        btn.dataset.themeResolved = res;
        btn.setAttribute('aria-label', t('shell.themeAriaLabel', 'theme: {mode} ({res})', { mode, res }));
    }
    btn.addEventListener('click', () => {
        const next = { auto: 'paper', paper: 'ink', ink: 'auto' }[getTheme()] || 'auto';
        applyTheme(next);
    });
    onThemeChange(paint);
    paint();
    // Insert before the clock so the toggle reads left of the time.
    const clock = tray.querySelector('.os-clock');
    if (clock) tray.insertBefore(btn, clock); else tray.appendChild(btn);
}

// Reorganize the apps menu: essential apps stay at top, system apps collapse
// under a collapsible 'System' expander. Reads `system: true` flag from the registry.
function mountSystemSubmenu(appsMenu, registry) {
    if (!appsMenu) return;
    const apps = typeof registry.list === 'function' ? registry.list() : [...registry.values()];
    const systemIds = new Set(apps.filter(a => a.system).map(a => a.id));
    const buttons = [...appsMenu.querySelectorAll(':scope > button.os-btn')];
    const sysButtons = [];
    for (const btn of buttons) {
        const label = (btn.textContent || '').trim();
        const app = apps.find(a => a.name === label);
        if (app && systemIds.has(app.id)) sysButtons.push(btn);
    }
    if (!sysButtons.length) return;
    const group = document.createElement('div');
    group.className = 'os-menu-group os-menu-system';
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'os-btn os-menu-system-toggle';
    header.setAttribute('aria-label', t('shell.systemAppsAriaLabel', 'System apps'));
    header.setAttribute('aria-expanded', 'false');
    const arrow = document.createElement('span');
    arrow.className = 'os-menu-system-arrow';
    setIcon(arrow, 'chevron-right');
    const label = document.createElement('span');
    label.textContent = t('shell.systemMenuLabel', 'System');
    header.append(arrow, label);
    const list = document.createElement('div');
    list.className = 'os-menu-system-list';
    list.id = 'os-menu-system-list';
    header.setAttribute('aria-controls', list.id);
    // Zero inline style: open/closed display is driven entirely by upstream CSS
    // (.os-menu-system-toggle[aria-expanded="true"] + .os-menu-system-list).
    // aria-expanded is the single source of truth; the JS only flips it + swaps
    // the chevron icon.
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = header.getAttribute('aria-expanded') !== 'true';
        header.setAttribute('aria-expanded', String(open));
        setIcon(arrow, open ? 'chevron-down' : 'chevron-right');
    });
    for (const b of sysButtons) list.appendChild(b);
    group.append(header, list);
    appsMenu.appendChild(group);
}

// --- First-run desktop hint --------------------------------------------
// Shown when the desktop has zero open windows (fresh boot, or every window
// closed) and the user hasn't dismissed it before. Persisted via IDB
// (idb-kv), never localStorage — matches the "only thebird-last-instance in
// shared localStorage" rule. Deliberately shell-wide rather than
// per-instance: the show condition (wm.count===0) is itself shell-wide, so
// tying dismissal to one instance would just make it reappear the moment a
// different instance briefly has no windows.
const ONBOARDING_DB = 'thebird-shell-kv';
const ONBOARDING_STORE = 'prefs';
const ONBOARDING_KEY = 'onboarding-dismissed';

// Rendered as a native <dialog class="tb-sess-modal"> (same vocabulary as
// session-ui's create/rename/destroy dialogs) rather than a floating div
// planted inside .wm-root/.os-root: both of those ancestors are
// `pointer-events: none` by design (so an empty desktop doesn't eat clicks
// meant for whatever's beneath it), which would make a dismiss button inside
// them unclickable without a bespoke `pointer-events: auto` rule — i.e. new
// CSS. The native <dialog> sidesteps that (its own top-layer + UA centering)
// and gets ESC/backdrop-click/focus-trap for free, same as openShortcutsOverlay.
function mountFirstRunHint(wm) {
    let dismissed = null; // null = not yet loaded from IDB
    let dialogEl = null;
    function paint() {
        const show = dismissed === false && wm.count === 0;
        if (!show) {
            if (dialogEl) {
                dialogEl.close();
                // The modal dialog traps focus while open; a window that
                // opened while this hint was still showing had its own
                // open-time focus() call swallowed by the trap. Once the
                // dialog releases focus, re-assert it on whichever window
                // is now focused so the a11y focus-on-open contract holds
                // even when a window opens before the hint auto-dismisses.
                if (wm.focused) { try { wm.focus(wm.focused); } catch { /* swallow: best-effort focus restore, window may have closed in the interim */ } }
            }
            return;
        }
        if (dialogEl) return; // already open
        dialogEl = document.createElement('dialog');
        dialogEl.className = 'tb-sess-modal';
        const head = document.createElement('div');
        head.className = 'tb-sess-modal-head';
        const title = document.createElement('span');
        title.className = 'tb-sess-modal-title';
        title.textContent = t('shell.firstRunTitle', 'welcome');
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tb-sess-modal-x';
        closeBtn.setAttribute('aria-label', t('session.closeModalAriaLabel', 'Close'));
        setIcon(closeBtn, 'x');
        head.append(title, closeBtn);
        const body = document.createElement('div');
        body.className = 'tb-sess-modal-body';
        webjsx.applyDiff(body, [EmptyState({
            text: t('shell.firstRunHint', 'open a terminal · start a chat · press ? for shortcuts'),
            glyph: Icon('square'),
        })]);
        dialogEl.append(head, body);
        document.body.appendChild(dialogEl);
        // Any way of closing (X, Escape, backdrop click) counts as a
        // permanent dismissal — there's no separate "remind me later" path.
        dialogEl.addEventListener('close', () => { dialogEl.remove(); dialogEl = null; dismiss(); }, { once: true });
        closeBtn.addEventListener('click', () => dialogEl.close());
        dialogEl.addEventListener('click', e => { if (e.target === dialogEl) dialogEl.close(); });
        dialogEl.showModal();
    }
    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        kvPut(ONBOARDING_DB, ONBOARDING_STORE, ONBOARDING_KEY, true)
            .catch(e => console.warn('[thebird] onboarding dismiss persist failed:', e));
    }
    kvGet(ONBOARDING_DB, ONBOARDING_STORE, ONBOARDING_KEY)
        .then(v => { dismissed = !!v; paint(); })
        .catch(() => { dismissed = false; paint(); });
    return { refresh: paint };
}

// --- Keyboard shortcuts overlay -----------------------------------------
// The real, currently-wired bindings only — sourced from wm.js's keydown
// handler (alt-tab/ctrl-w/meta-0/meta-9/meta-d/meta-arrows), freddie-chat's
// vendored ChatComposer (Enter to send, Shift+Enter for newline — see
// vendor/components/chat.js), the tilde bars-toggle below, and the standard
// POSIX keys xterm forwards straight to the shell process (no thebird-level
// JS binding for those, but they work today). Kept as one flat list so a
// stale/invented entry is easy to spot and delete.
const REAL_SHORTCUTS = [
    { combo: 'Alt+Tab', scope: 'window', label: 'Cycle windows (hold Shift to reverse)' },
    { combo: 'Ctrl+W', scope: 'window', label: 'Close focused window' },
    { combo: 'Meta+0', scope: 'window', label: 'Fit all windows into view' },
    { combo: 'Meta+9', scope: 'window', label: 'Reset camera to 1:1' },
    { combo: 'Meta+D', scope: 'window', label: 'Show desktop (minimize all)' },
    { combo: 'Meta+←', scope: 'window', label: 'Snap window to left half' },
    { combo: 'Meta+→', scope: 'window', label: 'Snap window to right half' },
    { combo: 'Meta+↑', scope: 'window', label: 'Maximize focused window' },
    { combo: 'Meta+↓', scope: 'window', label: 'Minimize / restore focused window' },
    { combo: '`', scope: 'shell', label: 'Toggle menu bar & dock' },
    { combo: '?', scope: 'shell', label: 'Show this shortcuts help' },
    { combo: 'Enter', scope: 'chat', label: 'Send message' },
    { combo: 'Shift+Enter', scope: 'chat', label: 'Insert newline' },
    { combo: 'Ctrl+C', scope: 'terminal', label: 'Interrupt the running command' },
    { combo: 'Ctrl+D', scope: 'terminal', label: 'End input / exit the shell' },
    { combo: 'Tab', scope: 'terminal', label: 'Complete a command or path' },
];

function openShortcutsOverlay() {
    const dialog = document.createElement('dialog');
    dialog.className = 'tb-sess-modal';
    const head = document.createElement('div');
    head.className = 'tb-sess-modal-head';
    const title = document.createElement('span');
    title.className = 'tb-sess-modal-title';
    title.textContent = t('shell.shortcutsTitle', 'Keyboard shortcuts');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tb-sess-modal-x';
    closeBtn.setAttribute('aria-label', t('session.closeModalAriaLabel', 'Close'));
    setIcon(closeBtn, 'x');
    head.append(title, closeBtn);
    const body = document.createElement('div');
    body.className = 'tb-sess-modal-body';
    webjsx.applyDiff(body, [ShortcutList({ shortcuts: REAL_SHORTCUTS })]);
    dialog.append(head, body);
    document.body.appendChild(dialog);
    function close() { dialog.close(); }
    // Native <dialog> already gives ESC-to-close for free; only backdrop-click
    // and the explicit close button need wiring (same pattern as session-ui's
    // buildOverlay: click on the ::backdrop, i.e. the <dialog> element itself
    // rather than its content, closes it).
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    closeBtn.addEventListener('click', close);
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.showModal();
}

// --- Instance boot-error toast -------------------------------------------
// Reuses the vendored `.toast`/`.toast.error` CSS (kits/os/app-shell.css) —
// styled, fixed-position, already carries an error border-color — rather
// than the unstyled `ds-ep-toast` class the editor-primitives toast() helper
// emits (no CSS rule targets it anywhere in the vendored kit yet).
// `onRetry(id)` re-invokes the same boot sequence via `api.newInstance({forceId: id})`
// (os-shell's own retry path — see below) rather than the toast owning boot logic.
// Error toasts are NOT auto-dismissed: a transient boot failure needs an action
// (retry) and 6s is easy to miss for something that requires the user to act,
// unlike the happy-path toast lifetime this function used to share.
function showInstanceErrorToast(id, onRetry) {
    const elToast = document.createElement('div');
    elToast.className = 'toast error';
    elToast.setAttribute('role', 'status');
    elToast.setAttribute('aria-live', 'polite');
    const msg = document.createElement('span');
    msg.textContent = t('shell.instanceErrorToast', 'Workspace {id} failed to start', { id });
    elToast.appendChild(msg);
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'toast-action';
    retryBtn.textContent = t('shell.instanceErrorRetry', 'Retry');
    retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        Promise.resolve(onRetry(id)).catch(e => console.error(e)).finally(() => elToast.remove());
    });
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'toast-dismiss';
    dismissBtn.setAttribute('aria-label', t('shell.instanceErrorDismiss', 'Dismiss'));
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', () => elToast.remove());
    elToast.append(retryBtn, dismissBtn);
    document.body.appendChild(elToast);
}

// --- Instance destroy-error toast -----------------------------------------
// destroyInstance() proceeds through teardown unconditionally even when a
// step fails (SW purge, fs.destroy, worker.stop, ...) so partial cleanup
// (e.g. a leaked per-instance IDB store from a failed SW purge) previously
// left no trace once CLEAR_INSTANCE_STATUS removed the id from tracking.
// No retry action here (unlike the boot-error toast): the instance is
// already gone from `instances`, there's nothing to retry — this is a
// visibility-only surface for a leak a human/automation should know about.
function showInstanceDestroyErrorToast(id, failedSteps) {
    const elToast = document.createElement('div');
    elToast.className = 'toast error';
    elToast.setAttribute('role', 'status');
    elToast.setAttribute('aria-live', 'polite');
    const msg = document.createElement('span');
    msg.textContent = t('shell.instanceDestroyErrorToast', 'Workspace {id} did not clean up fully ({steps})', { id, steps: failedSteps.join(', ') });
    elToast.appendChild(msg);
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'toast-dismiss';
    dismissBtn.setAttribute('aria-label', t('shell.instanceErrorDismiss', 'Dismiss'));
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', () => elToast.remove());
    elToast.append(dismissBtn);
    document.body.appendChild(elToast);
}

export function createOSShell({ root = document.body, autoBoot = true } = {}) {
    const wm = createWM({ getActiveInstanceId: () => getActiveInstance() });
    const registry = createAppRegistry();
    // User-authored apps (apps/*.js in the instance fs) are per-instance while
    // the registry is shell-wide: userApps.activate(fs) on every instance
    // switch drops the previous instance's user-* entries and re-scans the new
    // instance's fs. Starts empty; first activate happens in setActiveInstance.
    // onRegistryChange re-syncs the kit's launcher surfaces (apps menu / side
    // rail / drawer) after every user-* registration batch. It only fires from
    // activate()/fs-event flushes — all of which run after createDesktopShell
    // below initializes `shell` — so closing over the later const is safe; the
    // typeof guard covers a vendored kit copy too old to have refreshApps.
    const userApps = registerUserApps({
        registry, fs: null, wm, resolveInstance,
        onRegistryChange: () => { if (typeof shell.refreshApps === 'function') shell.refreshApps(); },
    });
    const instances = new Map();
    let persistTimer = null;
    let pendingState = null;
    let restoring = false; // gates schedulePersist during boot restore (camera clobber guard)

    // Shell state machine: the single source of truth for restorable scalar
    // state. counter/activeInstance/barsHidden are read from / written to the
    // actor context (via getters + events) instead of free `let` variables.
    const shellActor = createActor(shellMachine, { input: {} });
    shellActor.start();
    shellActor.send({ type: 'READY' });
    // Accessors keep the rest of the module readable while routing through xstate.
    const ctx = () => shellActor.getSnapshot().context;
    const getActiveInstance = () => ctx().activeInstance;
    const getCounter = () => ctx().counter;
    const getInstanceStatus = (id) => ctx().instanceStatus[id] || null;

    // Single-writer registration: os-shell.js is the only module that calls
    // this. Everything else reads the active instance via
    // docs/lib/instance-registry.js's getActiveInstance()/getInstances()
    // instead of window.__debug (see docs/apps.js resolveInstance).
    registerInstanceSource({ instances, getActiveId: getActiveInstance });

    // Surface instance boot failures ('error' status) as a toast — the
    // shellActor already tracked this status, it just had no visible surface.
    // Tracks which ids have already been toasted so an error status that
    // simply persists across snapshot updates doesn't re-toast repeatedly;
    // clearing the id lets a later retry-and-fail-again toast once more.
    const toastedErrorInstances = new Set();
    shellActor.subscribe((snapshot) => {
        const statuses = (snapshot.context && snapshot.context.instanceStatus) || {};
        for (const [id, status] of Object.entries(statuses)) {
            if (status === 'error') {
                if (!toastedErrorInstances.has(id)) {
                    toastedErrorInstances.add(id);
                    // api.newInstance is defined further down in this closure but not yet
                    // called until the button click happens well after setup completes,
                    // so closing over `api` here (not calling it) is safe.
                    showInstanceErrorToast(id, () => api.newInstance({ forceId: id }));
                }
            } else {
                toastedErrorInstances.delete(id);
            }
        }
        // An id can vanish from `statuses` entirely (CLEAR_INSTANCE_STATUS on
        // destroyInstance) without ever passing through the else-branch above,
        // leaving a stale entry in toastedErrorInstances that would silently
        // suppress the toast if the id is later reused (forceId/session
        // restore) and errors again. Evict any tracked id no longer present.
        for (const id of toastedErrorInstances) {
            if (!(id in statuses)) toastedErrorInstances.delete(id);
        }
    });

    // First-run desktop hint.
    const firstRunHint = mountFirstRunHint(wm);

    setWmPersistCallback(() => { schedulePersist(); firstRunHint.refresh(); });

    const shell = createDesktopShell({
        root,
        wm,
        registry,
        brand: 'thebird',
        onNewInstance: () => api.newInstance().catch(e => console.error(e)),
    });

    mountThemeToggle(shell.elements.menubar);
    mountSystemSubmenu(shell.elements.appsMenu, registry);

    // Snapshot schema (v=SNAPSHOT_VERSION). Version mismatch triggers fresh-boot — no upgrade path.
    // Shape: { v:number, counter:number, activeInstance:string|null, barsHidden:boolean,
    //   instances: Array<{ id:string, windows: Array<{ appId:string, x:number, y:number,
    //     w:number, h:number, minimized:boolean, maximized:boolean, z:number,
    //     viewState:any }>, camera:{scale:number,panX:number,panY:number}|null,
    //     focus:string|null }> }
    function buildSnapshot() {
        // Group all windows by instanceId so restore can rebuild each instance's window set faithfully.
        const wins = wm.list();
        const active = getActiveInstance();
        const byInst = {};
        for (const w of wins) {
            // wm.open()'s own notifyChange() fires buildSnapshot() synchronously
            // DURING origOpenApp(appId), before openApp's tag() callback (a few
            // lines below in this file) gets to stamp w.instanceId — so a window's
            // very first buildSnapshot pass can transiently see no instanceId yet,
            // even though tag() always stamps it and reschedules a corrected persist
            // moments later. Falling back to the active instance here (same
            // resolution tag() itself uses) makes this first pass correct too,
            // instead of dropping the window and logging a false "orphaned" warning
            // for state that self-corrects within the same debounce window.
            const iid = w.instanceId || active || '';
            if (!iid) { console.warn('[thebird] buildSnapshot: orphaned window dropped from persist', w.id, w.appId); continue; }
            (byInst[iid] = byInst[iid] || []).push({
                v: SNAPSHOT_VERSION,
                appId: w.appId, x: w.x, y: w.y, w: w.width, h: w.height,
                minimized: w.minimized, maximized: w.maximized, z: w.z,
                viewState: collectViewState(w.id),
            });
        }
        // Z-order sort per instance — restore replays in ascending z so focus settles correctly.
        for (const iid of Object.keys(byInst)) byInst[iid].sort((a, b) => a.z - b.z);
        // Capture the ACTIVE instance's live camera (the others are already in
        // cameraByInstance, saved on switch-away). Per-instance pan/zoom persists.
        if (wm.camera && active) { try { cameraByInstance.set(active, { scale: wm.camera.scale, panX: wm.camera.pan.x, panY: wm.camera.pan.y }); } catch { /* swallow: wm.camera may be mid-teardown/unavailable; camera snapshot is best-effort, missing it just skips restore-to-exact-pan/zoom */ } }
        // Persist the shell machine's own snapshot alongside the derived window
        // map, stamped with the schema version for forward-compat guarding.
        return {
            v: SNAPSHOT_VERSION,
            counter: getCounter(),
            activeInstance: active,
            barsHidden: document.documentElement.classList.contains('bars-hidden'),
            // NOTE: shellMachine context is restored field-by-field on boot (counter,
            // activeInstance, barsHidden replayed via events), not via createActor({snapshot}).
            // We deliberately do NOT persist a full shellActor snapshot here — it was dead
            // storage (persisted, never read) and bloated every snapshot write.
            instances: [...instances.keys()].map(id => ({ id, windows: byInst[id] || [], camera: cameraByInstance.get(id) || null, focus: focusByInstance.get(id) || null })),
        };
    }

    // Pull in-app view state from a window's app handle, if it exposes one.
    // Capped: a runaway/malicious app's getViewState() (e.g. an ever-growing
    // log array) must not bloat every instance's persisted snapshot.
    var VIEW_STATE_MAX_BYTES = 64 * 1024; // 64KB per window's view state
    function collectViewState(winId) {
        try {
            const w = [...instances.values()].flatMap(i => i.windows || []).find(x => x && x.id === winId);
            const app = w && w._app;
            if (!app || typeof app.getViewState !== 'function') return null;
            const result = app.getViewState();
            if (result == null) return result;
            let size;
            try { size = JSON.stringify(result).length; } catch (e) {
                console.warn('[thebird] collectViewState: unserializable view state for win ' + winId + ', dropping', e);
                return null;
            }
            if (size > VIEW_STATE_MAX_BYTES) {
                console.warn('[thebird] collectViewState: oversized view state for win ' + winId + ' (' + size + ' bytes > ' + VIEW_STATE_MAX_BYTES + ' cap), dropping');
                return null;
            }
            return result;
        } catch (e) { console.warn('[thebird] collectViewState failed for win ' + winId + ':', e); }
        return null;
    }
    function schedulePersist() {
        // Suppress persistence while restoring — otherwise the newInstance /
        // setActiveInstance churn during boot captures the FRESH (reset) camera
        // and clobbers the saved per-instance camera before restore re-applies it.
        if (restoring) return;
        const state = buildSnapshot();
        pendingState = state;
        const active = getActiveInstance();
        if (active) {
            try { sessionStorage.setItem(LAST_INSTANCE_LS, active); } catch { /* swallow: sessionStorage may be disabled/full (private browsing, quota); losing this hint only affects instance-reuse-on-reload, not correctness */ }
        }
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            // Serialize persist cycles: chain onto any in-flight run so overlapping
            // schedulePersist bursts (rapid window open/close/move under agentic
            // automation) never race concurrent gui-save waves for the same
            // instance's SW — each cycle starts only after the previous one settles,
            // and always flushes the LATEST pendingState (not a stale snapshot).
            persistChain = persistChain.then(runPersistCycle, runPersistCycle);
        }, 250);
    }
    let persistChain = Promise.resolve();
    async function runPersistCycle() {
        const s = pendingState;
        if (s === null) return;
        pendingState = null;
        // Mirror the snapshot to EVERY instance's SW so any single instance can recover the full set.
        for (const inst of instances.values()) {
            if (!inst || !inst.sw) continue;
            try { await saveGuiState(inst.sw, s); } catch (err) { console.warn('[thebird] gui-save dropped:', err); }
        }
    }

    // Remember the focused window id per instance so switching back restores it.
    const focusByInstance = new Map();
    // Per-instance desktop camera (pan/zoom). The view re-frames to each
    // instance's saved camera on switch; persisted so refresh resumes it.
    const cameraByInstance = new Map();

    function setActiveInstance(id) {
        // Capture current instance's focused window before switching away.
        const prevActive = getActiveInstance();
        if (prevActive && prevActive !== id) {
            const cur = wm.list().find(w => w.focused && w.instanceId === prevActive);
            if (cur) focusByInstance.set(prevActive, cur.id);
            // Remember the leaving instance's camera so we can re-frame on return.
            // Guard with !restoring: during autoBoot restore, cameras are being loaded
            // from the snapshot; writing fresh (reset) camera state here would clobber them.
            if (!restoring) { try { if (wm.camera) cameraByInstance.set(prevActive, { scale: wm.camera.scale, panX: wm.camera.pan.x, panY: wm.camera.pan.y }); } catch { /* swallow: best-effort camera capture on instance switch; wm.camera may be mid-teardown, losing it just means the leaving instance re-frames via fitToWindows on return */ } }
        }
        // Brief crossfade signal on body — CSS transitions opacity of .wm-win briefly.
        document.body.classList.add('tb-switching');
        setTimeout(() => document.body.classList.remove('tb-switching'), 180);

        shellActor.send({ type: 'SET_ACTIVE', id });
        const inst = instances.get(id);
        // Only stamp activeContext.instance when the lookup actually found one;
        // setContext({instance: undefined,...}) propagates through kit shell.openApp
        // to app factories that destructure {instance} and access .id synchronously,
        // throwing 'Cannot read properties of undefined (reading id)' on every
        // chatApp/freddieApp/etc invocation.
        if (inst) {
            // Only prefix window titles with the instance id when more than one
            // workspace actually exists -- with a single instance the prefix is
            // pure redundant clutter repeated on every window ("i1 · assistant",
            // "i1 · terminal", ...) with no disambiguating value.
            shell.setContext({ instance: inst, titlePrefix: instances.size > 1 ? inst.id : '' });
        } else {
            // Not found: keep xstate activeInstance and activeContext.instance in
            // lockstep — clear BOTH rather than leaving xstate claiming an id the
            // context can't supply (P10 honest-interface). setContext replaces the
            // whole object, so instance: undefined is explicit, not a stale ref.
            shellActor.send({ type: 'SET_ACTIVE', id: null });
            shell.setContext({ instance: undefined, titlePrefix: '' });
        }
        if (inst && inst.fs) {
            window.__debug = window.__debug || {};
            window.__debug.idbSnapshot = inst.fs.snapshot;
            window.__debug.idbPersist = () => inst.fs.flush();
        }
        // Re-point user-app discovery at the entering instance's fs (or clear
        // it when the id resolved to nothing). Runs before any window restore
        // reopens user-* apps, so their factories are registered in time.
        userApps.activate(inst ? inst.fs : null);
        shell.setActiveInstance(id);
        // Re-frame the desktop to the entering instance's saved camera; if it has
        // none yet, fit to its windows so they're framed (never a blank void).
        if (wm.camera && prevActive !== id) {
            const snap = cameraByInstance.get(id);
            if (snap) { try { wm.camera.setSnapshot(snap); } catch { /* swallow: malformed/stale saved camera snapshot; leave camera at its current state rather than throw on switch */ } }
            else { try { wm.fitToWindows(id); } catch { /* swallow: fitToWindows may no-op or throw if the instance has no windows yet; non-fatal, camera just stays put */ } }
        }
        // Restore remembered focused window for the new instance — but only if that
        // window still exists. A window destroyed since we recorded the focus would
        // make wm.focus a no-op (or worse, focus a recycled id).
        const remembered = focusByInstance.get(id);
        if (remembered && wm.list && wm.list().some(w => w.id === remembered && w.instanceId === id)) {
            try { wm.focus(remembered); } catch { /* swallow: window may have closed between the existence check and this call (race); focus is best-effort, not fatal */ }
        }
        try { sessionStorage.setItem(LAST_INSTANCE_LS, id); } catch { /* swallow: sessionStorage may be disabled/full; losing this hint only affects instance-reuse-on-reload */ }
        schedulePersist();
    }

    async function newInstance(opts = {}) {
        let reuseId = null;
        if (opts.forceId && /^i\d+$/.test(opts.forceId)) {
            reuseId = opts.forceId;
        } else if (!opts.skipRestore && !instances.size) {
            try { reuseId = sessionStorage.getItem(LAST_INSTANCE_LS) || null; } catch { /* swallow: sessionStorage may be disabled (private browsing); fall back to reuseId=null and mint a fresh instance id */ }
            if (reuseId && !/^i\d+$/.test(reuseId)) reuseId = null;
        }
        let id;
        if (reuseId) {
            id = reuseId;
            const n = parseInt(reuseId.slice(1), 10);
            if (Number.isFinite(n) && n > getCounter()) shellActor.send({ type: 'SET_COUNTER', counter: n });
        } else {
            shellActor.send({ type: 'BUMP_COUNTER' });
            id = 'i' + getCounter();
        }
        // Mark booting the moment the id is resolved — wraps the existing creation
        // logic (getInstanceSW/createFs/createInstanceWorker/bootHost) rather than
        // replacing it, so a thrown error anywhere in that sequence flips this
        // instance's status to 'error' (caught below) instead of leaving no status
        // record at all. Errors still propagate to the caller unchanged (existing
        // onNewInstance: () => api.newInstance().catch(e => console.error(e))).
        shellActor.send({ type: 'SET_INSTANCE_STATUS', id, status: 'booting' });
        let inst;
        let sw;
        try {
            sw = await getInstanceSW(id);
            const fs = await createFs(id);
            const worker = createInstanceWorker(id);
            await withTimeout(worker.ready, WORKER_READY_TIMEOUT_MS, `instance ${id}: worker did not become ready within ${WORKER_READY_TIMEOUT_MS}ms`);
            inst = { id, fs, worker, shells: [], browser: null, windows: [], sw, asgiApps: new Map() };
            inst.host = opts.skipHost ? null : await bootHost({ fs, sw });
        } catch (err) {
            shellActor.send({ type: 'SET_INSTANCE_STATUS', id, status: 'error' });
            throw err;
        }
        shellActor.send({ type: 'SET_INSTANCE_STATUS', id, status: 'ready' });
        instances.set(id, inst);
        installSwMessageRouter();
        window.__debug = window.__debug || {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[id] = Object.assign(window.__debug.instances[id] || {}, inst);
        // The session-ui module owns the instSwitch chip rendering; no per-instance
        // <button class="os-btn"> from os-shell anymore. Just activate the instance —
        // session-ui's polling tick will rebuild chips on the next frame.
        setActiveInstance(id);
        // Restore gui state if any (saved snapshot lives in this instance's SW-owned IDB)
        let restored = null;
        if (reuseId) {
            try { restored = await loadGuiState(sw); } catch (e) { console.warn('[thebird] gui-load failed:', e); }
        }
        if (restored && typeof restored.counter === 'number' && restored.counter > getCounter()) {
            shellActor.send({ type: 'SET_COUNTER', counter: restored.counter });
        }
        schedulePersist();
        if (typeof window !== 'undefined') { if (!window.__debug) window.__debug = {}; window.__debug.shell = api; }
        inst._restoredGui = restored;
        return inst;
    }

    async function destroyInstance(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        // Individual teardown steps stay best-effort (one failure must not block
        // the rest), but failures are now collected instead of only logged, so a
        // partially-torn-down instance (e.g. failed SW purge leaking its IDB
        // store) is surfaced via a toast rather than vanishing without a trace.
        const failedSteps = [];
        for (const sh of inst.shells) { try { sh.dispose && sh.dispose(); } catch { failedSteps.push('shell'); } }
        try { inst.browser && inst.browser.dispose && inst.browser.dispose(); } catch { failedSteps.push('browser'); }
        try { await inst.worker.stop(); } catch { failedSteps.push('worker'); }
        // Copy before iterating: wm.close triggers _dispose which splices inst.windows.
        for (const w of [...inst.windows]) { try { wm.close(w.id); } catch { failedSteps.push('window'); } }
        inst.windows.length = 0;   // no zombie window refs outlive the instance
        try { await inst.fs.destroy(); } catch { failedSteps.push('fs'); }
        try { inst.sw && inst.sw.purge && await inst.sw.purge(); } catch { failedSteps.push('sw-purge'); }
        try { await inst.sw.dispose(); } catch { failedSteps.push('sw-dispose'); }
        if (window.__debug && window.__debug.instances) delete window.__debug.instances[id];
        instances.delete(id);
        focusByInstance.delete(id);   // don't let the focus map outlive its instances
        cameraByInstance.delete(id);
        if (failedSteps.length) {
            // Dedupe step names (e.g. multiple failed window closes -> one 'window' entry).
            showInstanceDestroyErrorToast(id, [...new Set(failedSteps)]);
        }
        shellActor.send({ type: 'CLEAR_INSTANCE_STATUS', id });
        schedulePersist();
        if (getActiveInstance() === id) {
            const next = [...instances.keys()][0] || null;
            if (next) {
                setActiveInstance(next);
            } else {
                // Last instance gone: clear xstate active AND the kit's
                // activeContext — which still holds the just-destroyed instance.
                // setContext replaces the whole object, dropping that dangling
                // ref so a later openApp can't hand a destroyed instance to an
                // app factory (P6-adversarial).
                shellActor.send({ type: 'SET_ACTIVE', id: null });
                shell.setContext({ instance: undefined, titlePrefix: '' });
                // No active instance left: drop its user-* registry entries and
                // unsubscribe the (now destroyed) fs's write listener.
                userApps.activate(null);
            }
        }
        return true;
    }

    const origOpenApp = shell.openApp;
    shell.openApp = (appId) => {
        // If the caller invokes openApp before an active instance is set
        // (e.g. an automated probe that opens an app immediately after boot),
        // re-stamp setContext now so the kit's activeContext has the current
        // instance handle. Without this, app factories that destructure
        // {instance} from ctx receive undefined and throw on .id.
        const active0 = getActiveInstance();
        if (active0) {
            const inst = instances.get(active0);
            if (inst) shell.setContext({ instance: inst, titlePrefix: instances.size > 1 ? inst.id : '' });
        }
        // Capture the active instance at INVOCATION time, not callback time: an
        // async app factory may resolve after the user switches instances, and the
        // window must attach to the instance that was active when openApp was called.
        const activeAtInvoke = active0;
        const result = origOpenApp(appId);
        const tag = (win) => {
            // Resolve to the active-at-invoke instance, falling back to the current
            // active instance if invocation raced ahead of instance init. This ensures
            // every opened window is tracked by some instance rather than orphaned.
            const resolvedInstId = activeAtInvoke || getActiveInstance();
            if (win && !resolvedInstId) {
                // No active instance at invocation or callback time — a window without
                // an instanceId is untrackable (silently dropped at persist). Fail fast
                // so the race surface (newInstance vs setActiveInstance) is visible.
                console.error('[thebird] openApp: no active instance to attach window to; window will be orphaned and lost on refresh');
            }
            if (win && resolvedInstId) {
                // Stamp win.instanceId directly: the vendored kit's own finish()
                // (shell.js) stamps win.instanceId from ITS kit-local
                // activeInstanceId, read at promise-resolution time — a narrower,
                // less race-resistant snapshot than the activeAtInvoke-first
                // resolution above. When those two diverge (activeInstanceId not
                // yet set this early in boot, or several openApp calls firing before
                // the kit's own state settles), win.instanceId is left '' even
                // though resolvedInstId here is correct — so wm.list() (and thus
                // buildSnapshot's persistence check) sees an "orphaned" window while
                // this instance-tracking path believes it succeeded. Write the
                // resolved id onto the actual wm-tracked window object so both reads
                // agree.
                win.instanceId = resolvedInstId;
                if (win.el) win.el.dataset.instanceId = resolvedInstId;
                // instances.get(resolvedInstId) can transiently miss even when
                // resolvedInstId itself is a real, correct id: newInstance() sends
                // SET_ACTIVE (which getActiveInstance() reads) BEFORE it finishes
                // `instances.set(id, inst)` a few lines later, so an openApp firing
                // in that narrow window resolves a truthy id whose Map entry isn't
                // there yet. Previously this silently dropped the window from
                // inst.windows forever (permanently undercounting the system-monitor
                // app's `windows` stat, which reads instance.windows.length) with no
                // retry and no signal. Fall back to whatever instance is live NOW —
                // still correct almost always, since resolvedInstId only lags by a
                // microtask — and warn instead of silently dropping so a genuine
                // miss (no instance at all) is visible.
                const attach = (target) => {
                    target.windows.push(win);
                    // Invariant: inst.windows holds only currently-open windows. Hook the
                    // existing wm _dispose so closing a window splices it out at write-time,
                    // instead of leaving stale entries for read-time isConnected filtering.
                    const origDispose = win._dispose || (() => {});
                    let _disposed = false;
                    win._dispose = () => {
                        origDispose();
                        if (_disposed) return;
                        _disposed = true;
                        const idx = target.windows.indexOf(win);
                        if (idx > -1) target.windows.splice(idx, 1);
                    };
                    schedulePersist();
                };
                let inst = instances.get(resolvedInstId);
                if (!inst) {
                    const fallbackId = getActiveInstance();
                    inst = fallbackId ? instances.get(fallbackId) : null;
                }
                if (inst) {
                    attach(inst);
                } else {
                    // Both the resolved instance and the live-fallback instance are missing
                    // from the Map — newInstance()'s SET_ACTIVE-before-instances.set() race
                    // (see above) lags by a microtask, not indefinitely. Retry once on a
                    // fresh macrotask before giving up, so a window opened immediately after
                    // newInstance() still lands in inst.windows and is swept by
                    // destroyInstance instead of becoming a permanently uncounted orphan.
                    setTimeout(() => {
                        const retryInst = instances.get(resolvedInstId) || (() => {
                            const fid = getActiveInstance();
                            return fid ? instances.get(fid) : null;
                        })();
                        if (retryInst) {
                            attach(retryInst);
                        } else {
                            console.warn('[thebird] openApp: resolved instance ' + resolvedInstId + ' still not registered after retry; window ' + (win.id || '?') + ' will be undercounted until the next persist');
                        }
                    }, 0);
                }
            }
            return win;
        };
        return (result && typeof result.then === 'function') ? result.then(tag) : tag(result);
    };

    const api = {
        wm,
        registry,
        openApp: (id) => shell.openApp(id),
        newInstance,
        destroyInstance,
        setActive: (id) => setActiveInstance(id),
        get instances() { return [...instances.values()]; },
        get active() { const a = getActiveInstance(); return a ? instances.get(a) : null; },
        get count() { return instances.size; },
        getInstanceStatus,
        get shellActor() { return shellActor; },
        toggleSheet: () => shell.toggleSheet && shell.toggleSheet(),
        elements: shell.elements,
        dispose: () => { userApps.dispose(); shell.dispose(); },
    };
    if (typeof window !== 'undefined') { if (!window.__debug) window.__debug = {}; window.__debug.shell = api; }

    // Mount the session-management UX over the kit's bare instSwitch slot.
    // sessionUI takes over the create-button + chip rendering + create/destroy modals.
    const sessionUI = attachSessionUI(api, {
        instSwitch: shell.elements.instSwitch,
        menubar: shell.elements.menubar,
    });
    api.sessionUI = sessionUI;

    // Tilde (`) toggles bar visibility. Ignored when typing in input/textarea/contenteditable.
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Backquote') return;
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        const ae = document.activeElement;
        if (ae) {
            const tn = (ae.tagName || '').toUpperCase();
            if (tn === 'INPUT' || tn === 'TEXTAREA' || ae.isContentEditable) return;
        }
        e.preventDefault();
        const hidden = document.documentElement.classList.toggle('bars-hidden');
        shellActor.send({ type: 'SET_BARS_HIDDEN', value: hidden });
        schedulePersist();
    }, { capture: true });

    // '?' opens the keyboard-shortcuts overlay. Ignored when typing in an
    // input/textarea/contenteditable (so it doesn't hijack a literal '?' typed
    // into chat/terminal), and skipped if a <dialog> is already open so it
    // can't stack a second modal over an existing one (e.g. session-ui's
    // create/rename/destroy dialogs).
    document.addEventListener('keydown', (e) => {
        if (e.key !== '?') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const ae = document.activeElement;
        if (ae) {
            const tn = (ae.tagName || '').toUpperCase();
            if (tn === 'INPUT' || tn === 'TEXTAREA' || ae.isContentEditable) return;
        }
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        openShortcutsOverlay();
    });

    async function restoreWindowFromState(inst, wState) {
        // Version-stamp guard: if the window entry carries a v field that does not
        // match the current schema, skip it rather than passing a stale shape to
        // restoreViewState. No v field means a pre-stamp snapshot — still restore
        // geometry/appId (safe), but skip viewState which may be incompatible.
        const windowVersionOk = !wState.v || wState.v === SNAPSHOT_VERSION;
        // Activate target instance so origOpenApp wrapping attaches windows to it.
        if (getActiveInstance() !== inst.id) setActiveInstance(inst.id);
        try {
            const win = await shell.openApp(wState.appId || 'terminal');
            if (!win) return null;
            if (typeof wState.x === 'number') wm.move(win.id, wState.x, wState.y);
            if (typeof wState.w === 'number') wm.resizeTo(win.id, wState.w, wState.h);
            // Use the xstate-backed wm APIs to set max/min state directly — no
            // more fragile titlebar-button-click simulation. The window actor
            // records the state and the handle paints it.
            if (wState.maximized) wm.setMaximized(win.id, true);
            if (wState.minimized) wm.setMinimized(win.id, true);
            // Rehydrate in-app view state (files cwd, freddie tab, gm verb, etc.)
            // if the app factory exposed a restoreViewState hook on the window.
            if (wState.viewState && windowVersionOk && win._app && typeof win._app.restoreViewState === 'function') {
                try { win._app.restoreViewState(wState.viewState); } catch (e) { console.error('[thebird] restoreViewState failed for app ' + (wState.appId || '?') + ' win ' + win.id + ':', e); }
            } else if (wState.viewState && !windowVersionOk) {
                console.warn('[thebird] skipping stale viewState for app ' + (wState.appId || '?') + ' (window snapshot v' + wState.v + ' != expected v' + SNAPSHOT_VERSION + ')');
            }
            return win;
        } catch (e) { console.error('restore window:', e); return null; }
    }

    // Structural guard: if state passes the version check but has a malformed shape
    // (wrong types, corrupt ids), treat it as missing so restore fresh-boots rather
    // than silently coercing bad data into the live instance map.
    function validateSnapshot(state) {
        if (!state) return false;
        if (!Array.isArray(state.instances)) return false;
        const idRe = /^i\d+$/;
        for (const si of state.instances) {
            if (!si || typeof si.id !== 'string' || !idRe.test(si.id)) return false;
            if (!Array.isArray(si.windows)) return false;
            for (const w of si.windows) {
                if (!w || typeof w.appId !== 'string') return false;
                if (typeof w.x !== 'number' || typeof w.y !== 'number' || typeof w.w !== 'number' || typeof w.h !== 'number') return false;
            }
            if (si.camera !== null && si.camera !== undefined) {
                if (typeof si.camera.scale !== 'number' || typeof si.camera.panX !== 'number' || typeof si.camera.panY !== 'number') return false;
            }
            if (si.focus !== null && si.focus !== undefined && typeof si.focus !== 'string') return false;
        }
        if (state.activeInstance !== null && state.activeInstance !== undefined && typeof state.activeInstance !== 'string') return false;
        return true;
    }

    if (autoBoot) {
        (async () => {
            restoring = true; // suppress persist until restore (incl. camera) is applied
            // Boot the saved active instance first so its SW gui-load surfaces the multi-instance snapshot.
            // Window restore is driven explicitly below via restoreWindowFromState;
            // newInstance only seeds the instance (and must reuse the saved active id
            // via LAST_INSTANCE_LS, so we do NOT pass skipRestore here).
            const seed = await api.newInstance();
            let state = seed._restoredGui;
            // Forward-compat guard: a snapshot written by an older deploy may
            // carry an incompatible shape. If the version stamp is present and
            // mismatched, discard it and fresh-boot rather than crash restore.
            if (state && typeof state.v === 'number' && state.v !== SNAPSHOT_VERSION) {
                console.warn('[thebird] discarding stale gui snapshot v' + state.v + ' (expected v' + SNAPSHOT_VERSION + ')');
                state = null;
            }
            if (state && !validateSnapshot(state)) {
                console.error('[thebird] discarding structurally malformed gui snapshot', state);
                state = null;
            }
            // Apply bars-hidden BEFORE restoring windows so geometry calc sees correct viewport.
            if (state && state.barsHidden) { document.documentElement.classList.add('bars-hidden'); shellActor.send({ type: 'SET_BARS_HIDDEN', value: true }); }
            let savedInstances = (state && Array.isArray(state.instances)) ? state.instances : null;
            if (savedInstances && savedInstances.length > MAX_RESTORE_INSTANCES) {
                console.warn('[thebird] snapshot lists ' + savedInstances.length + ' instances; capping restore at ' + MAX_RESTORE_INSTANCES);
                savedInstances = savedInstances.slice(0, MAX_RESTORE_INSTANCES);
            }
            if (savedInstances && savedInstances.length) {
                // Seed instance reused the saved active id (via LAST_INSTANCE_LS). Materialize the rest.
                for (const si of savedInstances) {
                    if (!instances.has(si.id)) {
                        try { await api.newInstance({ forceId: si.id }); }
                        catch (e) { console.error('restore instance', si.id, e); }
                    }
                }
                // Replay windows per instance in ascending z so focus stack ends correct.
                for (const si of savedInstances) {
                    const inst = instances.get(si.id);
                    if (!inst) continue;
                    for (const wState of (si.windows || [])) {
                        await restoreWindowFromState(inst, wState);
                    }
                    // Restore each instance's persisted camera (pan/zoom) and focused window id.
                    if (si.camera && instances.has(si.id)) cameraByInstance.set(si.id, si.camera);
                    if (si.focus && instances.has(si.id)) focusByInstance.set(si.id, si.focus);
                }
                // Warn if any saved instance failed to materialize (divergence between
                // savedInstances and the live instances Map after restore).
                for (const si of savedInstances) {
                    if (!instances.has(si.id)) console.warn('[thebird] restore: instance ' + si.id + ' from snapshot was not materialized');
                }
                if (state.activeInstance && instances.has(state.activeInstance)) {
                    setActiveInstance(state.activeInstance);
                }
                // Apply the active instance's persisted camera. persist is gated by
                // `restoring` until just before the final schedulePersist below, so
                // the fresh (reset) camera can't clobber the saved one mid-restore.
                // setActiveInstance on boot skips the in-switch re-frame because the
                // seed instance is already active, so we apply explicitly here.
                const activeForCam = (state.activeInstance && instances.has(state.activeInstance)) ? state.activeInstance : getActiveInstance();
                const camSnap = activeForCam && cameraByInstance.get(activeForCam);
                if (wm.camera && camSnap) { try { wm.camera.setSnapshot(camSnap); } catch (e) { console.warn('[thebird] camera restore:', e); } }
            } else if (state && state.windows && state.windows.length > 0 && (!state.instances || !state.instances.length)) {
                // Legacy single-instance snapshot fallback. Reject if state.instances is
                // present AND non-empty — that signals multi-instance data with intact instances
                // (no recovery needed). An empty instances array means partial corruption,
                // so route to legacy fallback rather than silently dropping windows.
                for (const wState of state.windows) {
                    await restoreWindowFromState(seed, wState);
                }
            } else {
                // Fresh-boot default surface. Open terminal FIRST, then freddie
                // LAST so freddie ends up focused and on top — otherwise the
                // later-opened window (terminal) cascades over freddie's center
                // and hides it at desktop/maximized viewports (witnessed: on a
                // 1920px viewport elementFromPoint at freddie's center returned
                // the terminal window; on tablet the kit stacks/fills so freddie
                // stayed reachable, which is why the bug looked viewport-specific).
                // freddie is the headline surface (chat + tools + OS routes), so
                // it must be the visible/focused window on landing.
                await api.openApp('terminal');
                const fwin = await api.openApp('freddie');
                try { if (fwin && fwin.id) wm.focus(fwin.id); } catch { /* swallow: freddie window may not have finished opening/may already be gone; focus is best-effort on fresh boot */ }
            }
            // Restore done — camera already applied above. Do NOT set restoring=false
            // here; leave the gate active until .finally() so no schedulePersist()
            // triggered by microtasks between here and .finally() can capture stale
            // (reset) camera state. .finally() is the single exit point.
        })().catch(e => { console.error('autoBoot:', e); })
            // Persist unconditionally — even if restore threw mid-way, the
            // partially-applied live state (incl. camera) must be captured so a
            // crash between restore and persist can't silently lose it on refresh.
            .finally(() => { restoring = false; schedulePersist(); });
    }
    return api;
}
