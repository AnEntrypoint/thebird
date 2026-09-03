// User-authored apps: any `apps/*.js` file in the ACTIVE instance's fs is a
// user app module, discovered at boot (and on instance switch) and hot-reloaded
// in place as the file is edited from a terminal / the notes app.
//
// MODULE CONTRACT (what `apps/foo.js` must look like)
// ---------------------------------------------------
// An ES module exporting EITHER a default export OR a named `createApp`
// export: a factory function
//
//   ({ instance }) => ({ node, dispose?, getViewState?, restoreViewState? })
//
// The factory may be async. `instance` is the live per-instance handle (the
// same object docs/apps.js factories resolve via resolveInstance — instance.fs,
// instance.id, instance.worker, ...). `node` is the DOM node mounted into the
// window body; `dispose` runs on window close / hot-reload swap;
// getViewState/restoreViewState carry in-memory view state across hot reloads
// (and across refresh via os-shell's window persistence).
//
// Modules are imported through a fresh `blob:` URL per load (instance.fs paths
// are not servable URLs), which means each module is SELF-CONTAINED: relative
// and bare specifiers cannot resolve from a blob:-URL module. Absolute
// https:// URL imports do work (e.g. an unpkg URL), but the common case is a
// single dependency-free file.
//
// REGISTRY / LIFECYCLE CONTRACT
// -----------------------------
// - Registered as `user-<basename>` (apps/foo.js -> id `user-foo`, name `foo`),
//   non-system, defaultSize {w:520,h:360}, icon '' (same fallback reg() uses).
// - The app registry is SHARED across instances (createAppRegistry() runs once
//   per shell) while user modules are PER-INSTANCE (they live in that
//   instance's fs). Only the ACTIVE instance's user apps are registered at any
//   time: activate(fs) drops every `user-*` entry and re-scans the new fs.
//   os-shell.js calls activate() from setActiveInstance()/destroyInstance().
// - A broken module (import throws, no factory export, factory throws, no node)
//   never throws into boot and never yields a silent dead window: its
//   registered factory resolves to a visible error pane (same error-boundary
//   idiom as docs/apps.js's withLazyLoadErrorBoundary, same app-pane/meta
//   classes). Fixing the file re-registers it on the debounced fs event.
// - Writes are debounced ~300ms (trailing edge, coalescing bursts): a write
//   re-registers the app AND hot-reloads any OPEN window of it in place via
//   docs/lib/hot-reload.js (view state carried). A failed reload leaves the
//   last-good module running in the open window; the next open surfaces the
//   error pane.
// - Deleting the file unregisters the app from the registry. An already-open
//   window KEEPS its loaded module — the module is evaluated JS, there is no
//   safe "unload", and yanking live UI out from under the user on a file
//   delete is worse than letting the window run until closed.
// - Blob URL lifecycle: one blob: URL per module load, revoked immediately
//   after the import() settles (the module is fully fetched+evaluated by
//   then; revoking does not unload it). No URL accumulation across edits.
//
// VIEW-STATE STAMPING
// -------------------
// The kit's shell.js openApp preserves the full factory result on win._app
// (hooks included) as of anentrypoint-design 0.0.457. This module still
// re-stamps win._app with the full handle after mount (matched exactly by
// the per-open dispose-closure identity, so multiple windows of the same app
// never cross-stamp): the vendored kit copy can be overwritten by an older
// npm tarball on refresh-design --npm, and the stamp is what lets os-shell's
// collectViewState and hot-reload's view-state carry see the hooks even then.

import { el } from './dom.js';
import { createHotReloadWatcher } from './hot-reload.js';

const APPS_PREFIX = 'apps/';
const ID_PREFIX = 'user-';
const DEBOUNCE_MS = 300;

// instance.fs paths are not URLs, so user modules are imported through a
// blob: URL. Pluggable as `importSource` for non-browser hosts (the Node
// smoke harness substitutes a data:-URL loader — Node cannot import blob:).
async function importSourceViaBlob(source) {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
        return await import(/* @vite-ignore */ url);
    } finally {
        // import() settling means the module is fetched+evaluated; the URL
        // is dead weight from here on. Revoke immediately so an edit session
        // doesn't accumulate one live blob URL per load.
        URL.revokeObjectURL(url);
    }
}

// `apps/foo.js` -> direct child of apps/ only (nested dirs and the
// `apps/.keep` mkdir marker are not apps).
function isUserAppPath(p) {
    return typeof p === 'string'
        && p.startsWith(APPS_PREFIX)
        && p.endsWith('.js')
        && p.indexOf('/', APPS_PREFIX.length) === -1;
}

function appIdFor(path) {
    return ID_PREFIX + path.slice(APPS_PREFIX.length, -'.js'.length);
}

function pickFactory(mod) {
    return (mod && typeof mod.default === 'function') ? mod.default
        : (mod && typeof mod.createApp === 'function') ? mod.createApp
        : null;
}

/**
 * Scan + watch the `apps/` prefix of an instance fs and keep the shared app
 * registry's `user-*` entries in sync with it.
 *
 * @param {object} opts
 * @param {Map} opts.registry - createAppRegistry() app map (shared, shell-wide).
 * @param {object|null} opts.fs - initial instance fs to activate (may be null).
 * @param {object} opts.wm - createWM() window manager (needs get/list).
 * @param {function} opts.resolveInstance - docs/apps.js's resolveInstance.
 * @param {function} [opts.importSource] - (source:string)=>Promise<module>;
 *   defaults to the blob:-URL loader above.
 * @param {function} [opts.onRegistryChange] - called after each batch of
 *   registry mutations (rescan / fs-event flush) so the shell can re-sync its
 *   launcher surfaces (shell.refreshApps in the vendored kit).
 * @returns {{ activate:function, rescan:function, dispose:function }}
 */
export function registerUserApps({ registry, fs, wm, resolveInstance, importSource = importSourceViaBlob, onRegistryChange }) {
    if (!registry) throw new Error('registerUserApps: registry is required');
    if (typeof resolveInstance !== 'function') throw new Error('registerUserApps: resolveInstance is required');
    const hot = createHotReloadWatcher(wm, registry);

    function notifyRegistryChange() {
        if (typeof onRegistryChange === 'function') onRegistryChange();
    }

    // Transient in-window marker for a hot-reload that succeeded but lost the
    // app's captured view state (restoreViewState threw — e.g. the app's own
    // view-state shape changed between edits). console.warn alone never
    // reaches the user looking at the window; this surfaces the same fact
    // where they're actually looking, using the existing 'meta' idiom
    // (no new CSS — see errorPane above), and self-removes after a few
    // seconds so it never becomes a permanent fixture on a working window.
    function flashViewStateLost(winId) {
        try {
            if (!wm || typeof wm.get !== 'function') return;
            const win = wm.get(winId);
            if (!win || !win.bodyEl) return;
            const banner = el('div', 'meta');
            banner.dataset.component = 'hot-reload-viewstate-lost';
            banner.textContent = 'hot-reload: previous view state could not be restored (state reset)';
            // Insert as the FIRST child (plain flow, no positioning/new CSS —
            // same 'meta' class errorPane already uses) so it reads inline
            // above whatever the reloaded app just mounted, then self-removes.
            win.bodyEl.insertBefore(banner, win.bodyEl.firstChild);
            setTimeout(() => { try { banner.remove(); } catch (e) { /* swallow: banner or its parent may already be gone if the window closed before the timeout fired */ } }, 4000);
        } catch (e) { console.warn('[user-apps] flashViewStateLost failed for ' + winId + ':', e); }
    }

    let activeFs = null;
    let unsubscribe = null;
    let debounceTimer = null;
    const pending = new Set(); // app paths changed inside the debounce window
    // Bumped on every activate() (instance switch/destroy). A flushPending()
    // run captures the epoch at start and re-checks it before each mutating
    // step, aborting once a switch has invalidated activeFs/wm underneath it —
    // otherwise an in-flight flush from the OLD instance keeps running past
    // the switch and can hot-reload the NEW active instance's windows with
    // the OLD instance's module source (resolveInstance(null) re-resolves to
    // whatever is active *now*, not who owned the flush).
    // NOTE: hot.reloadWindowFromModule()'s own swap (docs/lib/hot-reload.js
    // swapWindowApp) is not itself cancellable mid-flight — the epoch check
    // below brackets each window's reload (skip starting one for a stale
    // epoch, discard its result if epoch changed while it awaited), which
    // closes the "stale flush hot-reloads the WRONG instance's windows" gap
    // for every case except a switch landing in the middle of an
    // already-started single reload call; that residual window is bounded to
    // one in-flight swap and cannot corrupt state beyond the window it was
    // already targeting when the switch occurred.
    let epoch = 0;

    // Visible error pane for a broken user module — mirrors docs/apps.js's
    // withLazyLoadErrorBoundary (same classes, same shape) so a broken app
    // reads exactly like a failed lazy load, never a silent dead window.
    // NOTE: the title uses the attrs-object el() form ({}) — lib/dom.js's
    // el() only sets textContent when the 2nd arg is a string or object, so
    // apps.js's own `el('div', null, text)` title line silently renders
    // empty (pre-existing, flagged, not fixed here).
    function errorPane(label, err) {
        const node = el('div', 'app-pane');
        node.dataset.component = 'lazy-load-error';
        node.append(
            el('div', {}, label + ' failed to load'),
            el('div', 'meta', String((err && err.message) || err)),
            el('div', 'meta', 'This is a user app loaded from ' + APPS_PREFIX + ' in this workspace\'s filesystem. Fix the file and it reloads itself; or close this window and open ' + label + ' again.'),
        );
        return { node, dispose() {} };
    }

    function makeFactory(path, id, fsAtRegistration) {
        const label = id.slice(ID_PREFIX.length);
        return async (ctx) => {
            try {
                // Bound to the fs this factory was registered against (not the
                // module-level activeFs, which can be reassigned by an
                // instance switch between registration and open/reload) so a
                // stale factory can never read another instance's fs.
                const boundFs = fsAtRegistration;
                if (!boundFs) throw new Error('no fs bound for this app');
                const source = boundFs.readFile(path);
                const mod = await importSource(source);
                const factory = pickFactory(mod);
                if (!factory) throw new Error('module exports no default/createApp factory');
                const app = await factory({ instance: resolveInstance(ctx) });
                if (!app || !app.node) throw new Error('factory returned no node');
                // Fresh dispose closure per open: the exact object identity the
                // stamping pass below matches on, so two windows of the same
                // user app can never cross-stamp their _app handles.
                const dispose = () => { if (typeof app.dispose === 'function') app.dispose(); };
                const mounted = {
                    id,
                    node: app.node,
                    dispose,
                    getViewState: typeof app.getViewState === 'function' ? app.getViewState : undefined,
                    restoreViewState: typeof app.restoreViewState === 'function' ? app.restoreViewState : undefined,
                };
                // The kit's openApp preserves the full factory result on
                // _app since 0.0.457; re-stamp anyway (next macrotask, after
                // the kit's finish() microtask, matched by dispose identity)
                // as a guard against the vendored kit being refreshed back to
                // an older lossy copy. See the header comment.
                setTimeout(() => {
                    try {
                        if (!wm || !wm.list) return;
                        for (const w of wm.list()) {
                            const live = wm.get ? wm.get(w.id) : null;
                            if (live && live._app && live._app.dispose === dispose) {
                                live._app = mounted;
                                break;
                            }
                        }
                    } catch (e) { console.warn('[user-apps] _app stamping failed for ' + id + ':', e); }
                }, 0);
                return mounted;
            } catch (e) {
                console.error('[user-apps] ' + id + ' failed to load', e);
                return errorPane(label, e);
            }
        };
    }

    function registerOne(path) {
        const id = appIdFor(path);
        // Direct Map.set with the exact entry shape createAppRegistry's own
        // reg() produces — reg itself is a closure-local, not exposed on the
        // returned map (docs/apps.js line ~214).
        registry.set(id, {
            id,
            name: id.slice(ID_PREFIX.length),
            icon: '',
            // Bind the factory to the fs active AT REGISTRATION TIME, not a
            // live reference to the module-level activeFs — otherwise an
            // instance switch between registration and window-open time
            // would silently read the wrong instance's fs (see makeFactory).
            factory: makeFactory(path, id, activeFs),
            defaultSize: { w: 520, h: 360 },
            system: false,
        });
        return id;
    }

    function dropStaleUserEntries(keep) {
        for (const key of [...registry.keys()]) {
            if (key.startsWith(ID_PREFIX) && !keep.has(key)) registry.delete(key);
        }
    }

    function rescan() {
        if (!activeFs) { dropStaleUserEntries(new Set()); notifyRegistryChange(); return; }
        const paths = activeFs.list(APPS_PREFIX).filter(isUserAppPath);
        const keep = new Set();
        for (const p of paths) keep.add(registerOne(p));
        dropStaleUserEntries(keep);
        notifyRegistryChange();
    }

    async function flushPending() {
        const myEpoch = epoch;
        const paths = [...pending];
        pending.clear();
        for (const path of paths) {
            if (epoch !== myEpoch) return; // instance switched mid-flush: abort, stale
            const id = appIdFor(path);
            if (!activeFs || !activeFs.exists(path)) {
                // Deleted inside the debounce window: unregister. An open
                // window keeps its already-loaded module (header contract).
                registry.delete(id);
                continue;
            }
            registerOne(path);
            // Hot-reload every open window of this app that belongs to the
            // ACTIVE instance — a same-named app window in a background
            // instance must not swallow this instance's source.
            if (!wm || !wm.list) continue;
            let inst = null;
            try { inst = resolveInstance(null); } catch (e) { console.warn('[user-apps] cannot resolve instance for reload of ' + id + ':', e); continue; }
            const wins = wm.list().filter(w => w.appId === id && w.instanceId === inst.id);
            for (const w of wins) {
                if (epoch !== myEpoch) return; // switched again between windows
                const capturedFs = activeFs;
                const r = await hot.reloadWindowFromModule(
                    w.id,
                    () => importSource(capturedFs.readFile(path)),
                    { instance: inst },
                );
                if (epoch !== myEpoch) return; // switched while awaiting reload: drop result
                if (!r.ok) console.warn('[user-apps] hot-reload of ' + id + ' in window ' + w.id + ' failed: ' + r.reason);
                else if (r.viewStateRestored === false) {
                    console.warn('[user-apps] hot-reload of ' + id + ' in window ' + w.id + ' succeeded but view state was lost: ' + r.viewStateError);
                    flashViewStateLost(w.id);
                }
            }
        }
        if (epoch === myEpoch) notifyRegistryChange();
    }

    function onFsEvent({ path, kind }) {
        if (kind !== 'write' && kind !== 'delete') return; // mkdir (.keep) is not an app
        if (!isUserAppPath(path)) return;
        pending.add(path);
        // Trailing-edge debounce: the first event in a burst arms the timer,
        // later events just join the pending set — one flush per burst.
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            flushPending().catch(e => console.error('[user-apps] fs-event flush failed:', e));
        }, DEBOUNCE_MS);
    }

    // Switch the watched fs (instance switch / destroy). Drops every user-*
    // entry first: the registry is shared while user modules are per-instance,
    // so the previously active instance's apps must not linger.
    function activate(nextFs) {
        epoch++; // invalidate any in-flight flushPending() from the prior fs
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        pending.clear();
        activeFs = nextFs || null;
        rescan();
        if (activeFs && typeof activeFs.subscribe === 'function') {
            unsubscribe = activeFs.subscribe(onFsEvent);
        }
    }

    function dispose() {
        activate(null);
    }

    if (fs) activate(fs);
    return { activate, rescan, dispose };
}
