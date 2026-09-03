// Monitor-app paint surface — bible classes, pure DOM. Consumer supplies getStats().
// getStats() -> Promise<{instanceId, frames, shells, windows, appsRegistered, jsHeapMb, jsHeapLimitMb, time}>.
// Field names map directly to displayed lines so consumer controls labels by value, not template.

export function renderMonitorApp(opts = {}) {
    const { getStats, pollMs = 1000 } = opts;
    const node = document.createElement('div');
    node.className = 'app-pane mono';
    node.dataset.component = 'monitor-app';

    let disposed = false;

    function renderError(err) {
        if (disposed) return;
        node.textContent = 'could not read stats: ' + (err && err.message ? err.message : String(err));
        node.classList.add('is-error');
    }

    async function tick() {
        const s = (await Promise.resolve(getStats())) || {};
        if (disposed) return;
        node.classList.remove('is-error');
        const heap = (s.jsHeapMb != null && s.jsHeapLimitMb != null)
            ? `js heap: ${Number(s.jsHeapMb).toFixed(1)} MB / ${Number(s.jsHeapLimitMb).toFixed(0)} MB`
            : 'js heap: n/a';
        node.textContent = [
            `instance: ${s.instanceId ?? ''}`,
            `worker frames: ${s.frames ?? 0}`,
            `shells: ${s.shells ?? 0}`,
            `windows: ${s.windows ?? 0}`,
            `apps registered: ${s.appsRegistered ?? 0}`,
            heap,
            `now: ${s.time ?? new Date().toLocaleTimeString()}`,
        ].join('\n');
    }

    tick().catch(renderError);
    const timer = setInterval(() => tick().catch(renderError), pollMs);
    return {
        node,
        tick,
        dispose() { disposed = true; clearInterval(timer); },
    };
}
