// freddie-app: the full freddie dashboard mounted as a WM window (sidebar
// nav; distinct from the lightweight <freddie-chat> mounted by chatApp).
// Extracted from docs/apps.js (pure code motion).
import { createFreddieDashboard } from './vendor/kits/os/index.js';
import { bootHost } from './freddie-loader.js';
import { resolveInstance } from './apps.js';
import { installFreddieDashboardApiShim } from './lib/freddie-dashboard-api-shim.js';

function osSurfacesFromShell() {
    const shell = (typeof window !== 'undefined' && window.__debug && window.__debug.shell) || null;
    if (!shell) return null;
    return {
        instances: () => (shell.instances || []).map(i => ({
            id: i.id,
            shells: i.shells || [],
            windows: (shell.wm && shell.wm.list ? shell.wm.list() : []).filter(w => w.el && w.el.dataset && w.el.dataset.instanceId === i.id),
        })),
        activeInstanceId: () => shell.active && shell.active.id,
        wm: shell.wm || null,
        xServer: () => {
            const inst = shell.active;
            const x = inst && inst.xDisplay && inst.xDisplay._internal;
            if (!x) return null;
            return {
                windows: x.windows ? x.windows.size : 0,
                pixmaps: x.pixmaps ? x.pixmaps.size : 0,
                gcs: x.gcs ? x.gcs.size : 0,
                atoms: x.atoms ? x.atoms.size : 0,
                cursors: x.cursors ? x.cursors.size : 0,
            };
        },
    };
}

export function freddieApp(ctx) {
    const instance = resolveInstance(ctx);
    installFreddieDashboardApiShim(instance);
    // Return the dashboard element synchronously and let createFreddieDashboard
    // boot the host async (it renders a 'loading…' state until ready). Awaiting
    // bootHost here left the window BLANK during the slow first load (149MB
    // plugkit.wasm + freddie bundle) instead of showing the dashboard skeleton.
    //
    // loadingText: the bare upstream 'loading…' marker reads as a dead/broken
    // pane while plugkit.wasm (~3.6MB, same-origin) instantiates. Pass an
    // explanatory string so the user knows what's happening, not stuck. The
    // kit renders it through its own webjsx EmptyState, so this stays
    // vnode-native. Vector-search-capable gm verbs (memorize/recall/codesearch)
    // additionally wait on the ~136MB agentplug-bert embedder loading in the
    // background (see docs/lib/freddie-host-bert.js) — chat/tools/everything
    // else is usable immediately, before that finishes.
    const handle = createFreddieDashboard({
        instance,
        bootHost,
        osSurfaces: osSurfacesFromShell(),
        loadingText: 'Loading freddie runtime…',
    });
    // The dashboard's nav handle (setActive/active getter for the current route)
    // is exposed on window.__debug.instances[id].dashboard, not on the returned
    // {node,dispose}. Surface it as view state so reopening restores the route.
    const dash = () => (typeof window !== 'undefined' && window.__debug && window.__debug.instances
        && window.__debug.instances[instance.id] && window.__debug.instances[instance.id].dashboard) || null;
    handle.getViewState = () => { const d = dash(); return d && d.active ? { route: d.active } : null; };
    handle.restoreViewState = (s) => {
        if (!s || typeof s.route !== 'string') return;
        const d = dash();
        if (d && typeof d.setActive === 'function') d.setActive(s.route);
    };
    return handle;
}
