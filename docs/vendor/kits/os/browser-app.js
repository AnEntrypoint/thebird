// Browser-pane paint surface — URL bar + iframe slot + status row. Consumer owns iframe.
// renderBrowserPane({initialUrl, callbacks: {onNavigate, onReload, onBack, onForward}})
//   -> {node, slot, setUrl, setStatus, setNav, setLoading, setError, dispose}.
// slot is the container the consumer should append its iframe to.
// setNav({canBack,canForward}) disables the back/forward buttons when history
// has no entry in that direction; setLoading(bool) toggles a loading state on
// the bar; setError(msg|null) surfaces a load failure in the status row.

export function renderBrowserPane(opts = {}) {
    const { initialUrl = 'about:blank', callbacks = {} } = opts;
    const node = document.createElement('div');
    node.className = 'app-pane browser-app';
    node.dataset.component = 'browser-app';

    const bar = document.createElement('div');
    bar.className = 'browser-app-bar';

    const mkBtn = (label, role) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'browser-app-btn';
        b.dataset.role = role;
        b.textContent = label;
        return b;
    };
    const backBtn = mkBtn('<', 'back');
    backBtn.setAttribute('aria-label', 'Back');
    const fwdBtn = mkBtn('>', 'forward');
    fwdBtn.setAttribute('aria-label', 'Forward');
    const reloadBtn = mkBtn('reload', 'reload');
    reloadBtn.setAttribute('aria-label', 'Reload');
    // Start with no history in either direction until the consumer says otherwise.
    backBtn.disabled = true;
    fwdBtn.disabled = true;

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'browser-app-url';
    urlInput.value = initialUrl;
    urlInput.spellcheck = false;
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && callbacks.onNavigate) callbacks.onNavigate(urlInput.value);
    });
    backBtn.addEventListener('click', () => callbacks.onBack && callbacks.onBack());
    fwdBtn.addEventListener('click', () => callbacks.onForward && callbacks.onForward());
    reloadBtn.addEventListener('click', () => callbacks.onReload && callbacks.onReload());

    bar.append(backBtn, fwdBtn, reloadBtn, urlInput);

    const slot = document.createElement('div');
    slot.className = 'browser-app-slot';
    slot.dataset.role = 'iframe-mount';

    const status = document.createElement('div');
    status.className = 'browser-app-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = '';

    node.append(bar, slot, status);

    return {
        node,
        get slot() { return slot; },
        setUrl(u) { urlInput.value = u; },
        setStatus(s) { status.textContent = s; },
        // Reflect history availability so disabled buttons read as inert.
        setNav({ canBack = false, canForward = false } = {}) {
            backBtn.disabled = !canBack;
            fwdBtn.disabled = !canForward;
        },
        // Loading: tint the bar + announce; the consumer flips it off on load/error.
        setLoading(on) {
            node.classList.toggle('browser-app-loading', !!on);
            if (on) { node.removeAttribute('data-error'); status.textContent = 'loading...'; }
        },
        // Error: persistent failure surfaced in the live status row.
        setError(msg) {
            node.classList.remove('browser-app-loading');
            if (msg) { node.setAttribute('data-error', '1'); status.textContent = msg; }
            else { node.removeAttribute('data-error'); }
        },
        dispose() {},
    };
}
