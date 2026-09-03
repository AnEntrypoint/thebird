// Terminal-app paint surface — bible classes, pure DOM. Consumer attaches xterm to mount slot.
// renderTerminal({title, statusText, theme}) -> {node, mount, setTitle, setStatus, dispose}.
// mount(termInstance) calls termInstance.open(slot) and fit when available; consumer owns xterm lifecycle.

export function renderTerminal(opts = {}) {
    const { title = 'terminal', statusText = '', theme = 'dark' } = opts;
    const node = document.createElement('div');
    node.className = 'app-pane terminal-app';
    node.dataset.component = 'terminal-app';
    node.dataset.theme = theme;

    const head = document.createElement('div');
    head.className = 'terminal-app-head';
    const titleEl = document.createElement('span');
    titleEl.className = 'terminal-app-title';
    titleEl.textContent = title;
    const statusEl = document.createElement('span');
    statusEl.className = 'terminal-app-status';
    statusEl.textContent = statusText;
    head.append(titleEl, statusEl);

    const slot = document.createElement('div');
    slot.className = 'terminal-app-slot';
    slot.dataset.role = 'xterm-mount';

    node.append(head, slot);

    function mount(term) {
        if (!term || typeof term.open !== 'function') return;
        term.open(slot);
        if (term._addonManager) {
            const addons = term._addonManager._addons || [];
            for (const a of addons) { try { a.instance && a.instance.fit && a.instance.fit(); } catch (_) { /* swallow: an addon's fit() failing must not block mounting the terminal */ } }
        }
    }

    return {
        node,
        mount,
        setTitle(t) { titleEl.textContent = t; },
        setStatus(s) { statusEl.textContent = s; },
        get slot() { return slot; },
        dispose() {},
    };
}
