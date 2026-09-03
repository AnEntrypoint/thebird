// browser-pane-app: the "browser" WM app (chrome + iframe pane), distinct
// from docs/browser-pane.js (the underlying createBrowserPane substrate this
// factory wraps). Extracted from docs/apps.js (pure code motion).
import { createBrowserPane } from './browser-pane.js';
import { renderBrowserPane as renderBrowserChrome } from './vendor/kits/os/index.js';
import { resolveInstance } from './apps.js';

export function browserApp(ctx) {
    const instance = resolveInstance(ctx);
    // Drive history through the canonical browserMachine (bp.back/forward) rather
    // than the iframe's cross-origin history (which throws); reflect nav state +
    // loading/error into the chrome so the UI is never a silent dead-end.
    const syncNav = () => { chrome.setNav({ canBack: bp.canBack, canForward: bp.canForward }); chrome.setUrl(bp.url); };
    const chrome = renderBrowserChrome({
        initialUrl: 'about:blank',
        callbacks: {
            onNavigate: (u) => {
                chrome.setLoading(true);
                bp.send('Page.navigate', { url: u })
                    .then(() => { chrome.setLoading(false); syncNav(); })
                    .catch((e) => { chrome.setError('could not load ' + u); syncNav(); });
            },
            onReload: () => { chrome.setLoading(true); bp.send('Page.reload').then(() => chrome.setLoading(false)).catch(() => chrome.setError('reload failed')); },
            onBack: () => { bp.back().then(syncNav).catch(() => {}); },
            onForward: () => { bp.forward().then(syncNav).catch(() => {}); },
        },
    });
    let bp = createBrowserPane({ container: chrome.slot, instanceId: instance.id, initialUrl: 'about:blank' });
    if (!instance.browser) instance.browser = bp;
    bp.onNavChange(syncNav);
    chrome.setStatus('ready');
    syncNav();
    return {
        node: chrome.node,
        dispose: () => { try { bp.dispose && bp.dispose(); } catch { /* swallow: pane already torn down, chrome disposal still proceeds */ } chrome.dispose(); },
        // Persist/restore the browserMachine (url + history) across a refresh, so the
        // browser app honors the xstate-everywhere contract like every other surface.
        getViewState: () => { try { return { browserSnapshot: bp.getPersistedSnapshot() }; } catch { return null; } },
        restoreViewState: (s) => {
            if (!s || !s.browserSnapshot) return;
            try {
                bp.dispose && bp.dispose();
                bp = createBrowserPane({ container: chrome.slot, instanceId: instance.id, snapshot: s.browserSnapshot });
                instance.browser = bp;
                bp.onNavChange(syncNav);
                syncNav();
            } catch { /* swallow: view-state restore is best-effort, pane opens fresh on failure */ }
        },
    };
}
