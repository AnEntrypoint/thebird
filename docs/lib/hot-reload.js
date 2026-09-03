// Hot-reload for a WM app window whose app was mounted from a dynamic
// `import()` of a module (as opposed to a hardcoded createAppRegistry
// entry). Two entry points share one swap tail (view-state capture ->
// factory re-invocation -> node swap into the SAME window chrome ->
// view-state restore):
//
//   reloadWindow(winId, modulePath, ctx)         -- modulePath is a servable
//     URL; re-imported with a cache-busting query param to defeat the
//     browser module cache.
//   reloadWindowFromModule(winId, loadModule, ctx) -- caller supplies the
//     loader; for modules with no servable URL (docs/lib/user-apps.js reads
//     source out of instance.fs and imports via a fresh blob: URL per load,
//     which is already cache-unique).
//
// The automatic trigger half now exists: docs/lib/user-apps.js subscribes to
// instance.fs writes under `apps/` and calls reloadWindowFromModule for open
// windows of the edited user app.
//
// createHotReloadWatcher(wm, registry) takes the registry only as a
// constructor param (unused by the swap itself — dynamic-import reload does
// not go through the registry's reg()'d factories) so registry-aware reload
// paths can be added without changing call sites.
export function createHotReloadWatcher(wm, registry) {
    // Per-winId in-flight promise chain: serializes overlapping swap calls
    // for the SAME window (e.g. a manual reloadWindow racing user-apps.js's
    // automatic flushPending on the same winId) so only one swap is ever
    // mid-flight per window — the second caller's swap starts only after the
    // first's mount+restore has fully landed, instead of both building a
    // nextApp concurrently and racing on win._app / bodyEl. Cleared once a
    // window's chain drains so the map never grows unbounded across the
    // window's lifetime.
    const inFlight = new Map();

    /**
     * Shared swap tail for both reload entry points: capture the old app's
     * view state, load + re-invoke the module factory, dispose the old app,
     * mount the new node into the SAME window chrome (position/size/z-order
     * untouched, since those live on the window's own xstate actor, not on
     * the app instance), and carry the view state across.
     *
     * @param {string} winId - id of an existing wm.js window.
     * @param {function} loadModule - () => Promise<module>; a thrown/
     *   rejected load maps to {ok:false, reason:'import-failed'} and leaves
     *   the OLD app untouched (last-good module keeps running).
     * @param {object} [ctx]
     * @returns {Promise<{ok:boolean, reason?:string}>}
     */
    async function swapWindowApp(winId, loadModule, ctx) {
        // Serialize onto any in-flight swap for this SAME winId — chain this
        // call after the prior one settles (success or failure) so the two
        // never interleave their read-of-old-app / build-nextApp / mount
        // steps. .catch(()=>{}) on the awaited predecessor so a REJECTED
        // predecessor (should not happen — swapTail below never throws, but
        // defensive) cannot poison this call's own await.
        const prior = inFlight.get(winId) || Promise.resolve();
        const runP = prior.catch(() => {}).then(() => swapTail(winId, loadModule, ctx));
        // Track this call as the new tail; only clear the map entry if we're
        // still the most recently-registered tail once we settle (an even
        // newer call may have already overwritten it).
        inFlight.set(winId, runP);
        runP.finally(() => { if (inFlight.get(winId) === runP) inFlight.delete(winId); });
        return runP;
    }

    async function swapTail(winId, loadModule, ctx) {
        // wm.get(winId) returns the LIVE window handle (bodyEl, _app) —
        // wm.list() entries are plain geometry snapshots with neither, so a
        // list()-based lookup can never perform the node swap.
        const win = typeof wm.get === 'function' ? wm.get(winId)
            : (wm.list ? wm.list().find(w => w.id === winId) : null);
        if (!win) return { ok: false, reason: 'window-not-found' };

        const oldApp = win._app || null;

        // Capture the old app's in-memory view state (scroll position, cwd,
        // selection, etc.) before tearing it down, so the new instance can
        // resume where the old one left off.
        let viewState = null;
        if (oldApp && typeof oldApp.getViewState === 'function') {
            try { viewState = oldApp.getViewState(); } catch (e) { console.warn('[hot-reload] getViewState threw:', e); }
        }

        let mod;
        try {
            mod = await loadModule();
        } catch (e) {
            console.error('[hot-reload] module load failed for window ' + winId + ':', e);
            return { ok: false, reason: 'import-failed', error: e };
        }
        const factory = typeof mod.default === 'function' ? mod.default
            : typeof mod.createApp === 'function' ? mod.createApp
            : null;
        if (!factory) return { ok: false, reason: 'no-factory-export' };

        const nextCtx = ctx || (oldApp && oldApp.ctx) || {};
        let nextApp;
        try {
            nextApp = await factory(nextCtx);
        } catch (e) {
            console.error('[hot-reload] factory re-invocation threw:', e);
            return { ok: false, reason: 'factory-threw', error: e };
        }
        if (!nextApp || !nextApp.node) return { ok: false, reason: 'factory-returned-no-node' };

        // Re-check the window is still open and unchanged after the two
        // async gaps above (loadModule + factory re-invocation) — wm.close()
        // may have run in the meantime, disposing `oldApp` itself, tearing
        // down `win.handle`, and deleting the window from wm's registry. A
        // stale `win`/`oldApp` here would otherwise: double-dispose oldApp
        // (wm.close() already disposed win._app), append nextApp.node into a
        // bodyEl already torn down by handle.dispose() (orphaned DOM nothing
        // will ever remove), and write win._app = nextApp onto a window
        // object no longer reachable from wm — leaking every
        // timer/subscription nextApp's factory started. Treat this exactly
        // like the existing window-not-found bail: dispose the freshly-built
        // nextApp (nothing else owns it yet) instead of mounting it, and
        // leave the old app's disposal to wm.close(), which already ran it.
        const liveWin = typeof wm.get === 'function' ? wm.get(winId) : win;
        if (!liveWin || liveWin !== win) {
            try { nextApp.dispose && nextApp.dispose(); } catch (e) { console.warn('[hot-reload] orphaned nextApp dispose threw:', e); }
            return { ok: false, reason: 'window-closed-during-swap' };
        }

        // Mount the new node into the SAME window chrome — reuse the
        // existing wm.js window rather than opening a new window. Resolve
        // and validate bodyEl BEFORE disposing the old app: if this window
        // has no body element we must bail out with win._app still pointing
        // at the (not-yet-disposed) old app, so a later close() disposes it
        // exactly once instead of double-disposing an instance we already
        // tore down on a path that then aborted.
        const bodyEl = win.bodyEl;
        if (!bodyEl) return { ok: false, reason: 'no-body-el' };

        // Dispose the OLD app instance cleanly (stop intervals/listeners it
        // owns) before detaching its DOM — mirrors wm.js's own close()
        // ordering (dispose the app, THEN tear down the handle). Safe from
        // double-dispose: the liveWin check above already ensures wm.close()
        // has NOT run between capture and here.
        if (oldApp && typeof oldApp.dispose === 'function') {
            try { oldApp.dispose(); } catch (e) { console.warn('[hot-reload] old app dispose threw:', e); }
        }

        while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
        bodyEl.appendChild(nextApp.node);

        // Carry the captured view state into the new instance if both sides
        // support it.
        let viewStateRestored = true;
        let viewStateError = null;
        if (viewState != null && typeof nextApp.restoreViewState === 'function') {
            try { nextApp.restoreViewState(viewState); } catch (e) {
                console.error('[hot-reload] restoreViewState failed:', e);
                viewStateRestored = false;
                viewStateError = e;
            }
        }

        nextApp.ctx = nextCtx;
        win._app = nextApp;
        return { ok: true, viewStateRestored, viewStateError };
    }

    /**
     * Reload the app mounted in window `winId` by re-importing `modulePath`
     * with a cache-busting query param, re-invoking its exported factory,
     * and swapping the new instance's DOM node into the SAME window chrome.
     *
     * Contract assumed of `modulePath`'s default (or named `createApp`)
     * export: a factory function `(ctx) => { node, dispose?, getViewState?,
     * restoreViewState? }` — the same shape docs/apps.js's reg() factories
     * return, minus registry wiring.
     *
     * @param {string} winId - id of an existing wm.js window (wm.list() entry).
     * @param {string} modulePath - the URL/path this window's app was
     *   originally `import()`-ed from (must be a real dynamic import, not a
     *   registry id — a registry-backed app has no re-importable module path
     *   because its factory is a static top-of-file import bound at build time).
     * @param {object} [ctx] - context object passed to the factory on
     *   reload. Defaults to the window's own `_app.ctx` if the original
     *   mount recorded one, otherwise `{}`.
     * @returns {Promise<{ok:boolean, reason?:string}>}
     */
    async function reloadWindow(winId, modulePath, ctx) {
        if (!modulePath) return { ok: false, reason: 'no-module-path' };
        // Re-import with a cache-busting query so the browser module cache
        // (which keys purely on URL) is forced to re-fetch+re-evaluate the
        // edited source instead of returning the stale cached module.
        const bust = modulePath + (modulePath.includes('?') ? '&' : '?') + 'reload=' + Date.now();
        return swapWindowApp(winId, () => import(/* @vite-ignore */ bust), ctx);
    }

    /**
     * Same swap as reloadWindow, but the caller supplies the module loader —
     * for modules that do not live at a servable URL (e.g. user-authored
     * apps whose source is read out of instance.fs and imported through a
     * fresh blob: URL per load; each blob URL is already unique, so no
     * cache-bust query is wanted or applied). Added for
     * docs/lib/user-apps.js; view-state-carry contract is identical.
     *
     * @param {string} winId - id of an existing wm.js window.
     * @param {function} loadModule - () => Promise<module>.
     * @param {object} [ctx]
     * @returns {Promise<{ok:boolean, reason?:string}>}
     */
    async function reloadWindowFromModule(winId, loadModule, ctx) {
        if (typeof loadModule !== 'function') return { ok: false, reason: 'no-loader' };
        return swapWindowApp(winId, loadModule, ctx);
    }

    return { reloadWindow, reloadWindowFromModule };
}
