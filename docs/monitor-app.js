// monitor-app: system monitor pane (frames/shells/windows/heap stats).
// Extracted from docs/apps.js (pure code motion).
import { renderMonitorApp } from './vendor/kits/os/index.js';
import { resolveInstance } from './apps.js';

export function monitorApp(ctx) {
    const instance = resolveInstance(ctx);
    const registry = ctx.registry;
    const wm = ctx.wm;
    return renderMonitorApp({
        getStats: async () => {
            try {
                if (!instance) {
                    return { error: 'Shell not ready', time: new Date().toLocaleTimeString() };
                }
                const frames = await instance.worker.frameCount().catch(() => 0);
                const mem = (performance && performance.memory) ? performance.memory : null;
                // Prefer the live wm state over instance.windows.length: the latter is
                // a side-tracked array (os-shell.js pushes onto it from openApp's own
                // instance-resolution path, spliced out again on window close) that can
                // silently undercount if that resolution ever misses a transient race
                // (e.g. a window opened in the gap between an instance's id going
                // active and its Map entry landing) — a real defect this project hit
                // (see os-shell.js openApp tag() comments). wm.list() is the same
                // source buildSnapshot/persistence trusts, so counting from it here
                // can't drift from what actually gets persisted. Fall back to the
                // side-tracked array only if wm is unavailable for some reason.
                const windows = wm && typeof wm.list === 'function'
                    ? wm.list().filter(w => w.instanceId === instance.id).length
                    : (instance.windows ? instance.windows.length : 0);
                return {
                    instanceId: instance.id,
                    frames,
                    shells: instance.shells ? instance.shells.length : 0,
                    windows,
                    appsRegistered: registry ? registry.size : 0,
                    jsHeapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
                    jsHeapLimitMb: mem ? mem.jsHeapSizeLimit / 1048576 : null,
                    time: new Date().toLocaleTimeString(),
                };
            } catch (err) {
                return { error: (err && err.message) || 'Stats unavailable', time: new Date().toLocaleTimeString() };
            }
        },
    });
}
