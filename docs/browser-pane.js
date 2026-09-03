import { createMachine, createActor, assign } from 'xstate';
import { t } from './vendor/i18n.js';

const MAX_NETWORK_ENTRIES = 500;
function pushNetwork(network, entry) {
    network.push(entry);
    if (network.length > MAX_NETWORK_ENTRIES) network.splice(0, network.length - MAX_NETWORK_ENTRIES);
}

const MAX_HISTORY_ENTRIES = 200;
// Caps history the same way pushNetwork caps network: evict from the front
// once over the limit, shifting historyIndex so it still points at the same
// logical entry (back/forward semantics stay correct near the cap).
function capHistory(history, historyIndex) {
    if (history.length <= MAX_HISTORY_ENTRIES) return { history, historyIndex };
    const overflow = history.length - MAX_HISTORY_ENTRIES;
    return {
        history: history.slice(overflow),
        historyIndex: Math.max(0, historyIndex - overflow),
    };
}

// Navigation is modeled as an xstate actor so a browser pane can resume its
// current URL + back/forward history across a page refresh. Persisting a pane
// === actor.getPersistedSnapshot(); restoring === createActor(machine,
// {snapshot}). The machine is the source of truth for {url, history,
// historyIndex}; the DOM iframe stays the paint surface.
export const browserMachine = createMachine({
    id: 'browser',
    context: ({ input }) => ({
        url: input?.url ?? 'about:blank',
        history: input?.history ?? (input?.url ? [input.url] : ['about:blank']),
        historyIndex: input?.historyIndex ?? 0,
    }),
    initial: 'idle',
    states: {
        idle: {},
        loading: {},
        loaded: {},
        error: {},
    },
    on: {
        // NAVIGATE truncates any forward history and pushes the new url.
        NAVIGATE: {
            target: '.loading',
            actions: assign(({ context, event }) => {
                const rawHistory = [...context.history.slice(0, context.historyIndex + 1), event.url];
                const rawIndex = context.historyIndex + 1;
                const { history, historyIndex } = capHistory(rawHistory, rawIndex);
                return { url: event.url, history, historyIndex };
            }),
        },
        LOADED: { target: '.loaded' },
        ERROR: { target: '.error' },
        BACK: {
            target: '.loading',
            guard: ({ context }) => context.historyIndex > 0,
            actions: assign({
                historyIndex: ({ context }) => context.historyIndex - 1,
                url: ({ context }) => context.history[context.historyIndex - 1],
            }),
        },
        FORWARD: {
            target: '.loading',
            guard: ({ context }) => context.historyIndex < context.history.length - 1,
            actions: assign({
                historyIndex: ({ context }) => context.historyIndex + 1,
                url: ({ context }) => context.history[context.historyIndex + 1],
            }),
        },
    },
});

function captureCanvasScreenshot(iframe) {
    let doc;
    try { doc = iframe.contentDocument; } catch { return { dataUrl: '', degraded: true }; }
    if (!doc) return { dataUrl: '', degraded: true };
    const w = iframe.clientWidth || 800, h = iframe.clientHeight || 600;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    const body = doc.body;
    if (!body) return { dataUrl: canvas.toDataURL('image/png'), degraded: true };
    const cs = doc.defaultView.getComputedStyle(body);
    ctx.fillStyle = cs.backgroundColor || '#fff';
    ctx.fillRect(0, 0, w, h);
    const text = body.innerText || body.textContent || '';
    ctx.fillStyle = cs.color || '#000';
    ctx.font = '14px monospace';
    const lines = text.split('\n').slice(0, Math.floor(h / 18) - 1);
    lines.forEach((line, i) => ctx.fillText(line.slice(0, 100), 8, 18 + i * 16));
    return { dataUrl: canvas.toDataURL('image/png'), degraded: text.trim() === '' };
}

// Only http/https/about:blank are safe to load into the iframe; javascript:,
// data: and file: schemes can run script in or read state from the host origin.
function safeNavUrl(url) {
    const raw = String(url || '').trim();
    if (raw === '' || raw.toLowerCase() === 'about:blank') return 'about:blank';
    let parsed;
    try { parsed = new URL(raw, location.href); } catch { throw new Error('navigate: invalid url'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('navigate: blocked url scheme ' + parsed.protocol);
    }
    // Never let the framed pane land on the host's own origin: with
    // allow-same-origin + allow-scripts on the iframe sandbox, a same-origin
    // document can freely script window.parent/window.top, defeating the
    // sandbox boundary entirely (the classic allow-scripts+allow-same-origin
    // escape). http(s) navigation is otherwise permitted; only the exact
    // host origin is refused.
    if (parsed.origin === location.origin) {
        throw new Error('navigate: blocked same-origin-with-host url');
    }
    return parsed.href;
}

// Runtime.evaluate/DOM.* must never operate against a document that has
// become same-origin with the host page: allow-same-origin lets a framed
// same-origin document read/write window.parent/window.top, so granting it
// scriptable access via win.Function(...)/contentDocument would be handing
// arbitrary code execution a path back into the host shell. A cross-origin
// framed page throws on contentDocument access already (browser-enforced);
// this closes the same-origin-with-host case which the browser does NOT
// block on its own since allow-same-origin was requested.
function assertNotHostOrigin(iframe) {
    let href = null;
    try { href = iframe.contentWindow && iframe.contentWindow.location.href; } catch { return; }
    if (href == null) return;
    let origin;
    try { origin = new URL(href, location.href).origin; } catch { return; }
    if (origin === location.origin) {
        throw new Error('blocked: framed document is same-origin with host');
    }
}

const handlers = {
    // supersedePending() (backed by the shared pendingCleanups set/registerPending
    // in createBrowserPane) forces off any still-armed 'load' listener from a
    // PRIOR overlapping navigation before this one attaches its own and touches
    // iframe.src. Without this, a second Page.navigate/Page.reload/BACK/FORWARD
    // fired before the first one's iframe 'load' event lands leaves the first
    // call's onLoad still attached; 'load' fires once per actual navigation, so
    // that stale onLoad then fires on the SECOND navigation's load event and
    // resolves/pushes-network/actor.sends LOADED for a URL that was never
    // actually reached -- a classic unguarded overlapping-async-call race.
    async 'Page.navigate'({ iframe, network, registerPending, supersedePending }, { url }) {
        url = safeNavUrl(url);
        supersedePending();
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => { cleanup(); reject(new Error('navigate timeout')); }, 15000);
            const onLoad = () => {
                cleanup();
                pushNetwork(network, { ts: Date.now(), method: 'GET', url, type: 'navigation' });
                resolve({ frameId: 'main', loaderId: String(Date.now()), url });
            };
            function cleanup() { clearTimeout(t); iframe.removeEventListener('load', onLoad); unregister(); }
            const unregister = registerPending(cleanup, () => { cleanup(); reject(new Error('navigate superseded')); });
            iframe.addEventListener('load', onLoad);
            iframe.src = url;
        });
    },
    async 'Page.reload'({ iframe, registerPending, supersedePending }) {
        supersedePending();
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => { cleanup(); reject(new Error('reload timeout')); }, 15000);
            const onLoad = () => { cleanup(); resolve({}); };
            function cleanup() { clearTimeout(t); iframe.removeEventListener('load', onLoad); unregister(); }
            const unregister = registerPending(cleanup, () => { cleanup(); reject(new Error('reload superseded')); });
            iframe.addEventListener('load', onLoad);
            try { iframe.contentWindow.location.reload(); } catch { iframe.src = iframe.src; }
        });
    },
    async 'Page.captureScreenshot'({ iframe }, { format = 'png' } = {}) {
        const { dataUrl, degraded } = captureCanvasScreenshot(iframe);
        const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
        return degraded ? { data: m ? m[1] : '', format, degraded: true } : { data: m ? m[1] : '', format };
    },
    async 'Runtime.evaluate'({ iframe }, { expression, returnByValue = true }) {
        assertNotHostOrigin(iframe);
        const win = iframe.contentWindow;
        if (!win) throw new Error('evaluate: cross-origin iframe');
        try {
            const fn = win.Function('return (' + expression + ')');
            const value = fn();
            const resolved = await Promise.race([
                Promise.resolve(value),
                new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timeout')), 15000)),
            ]);
            return { result: { type: typeof resolved, value: returnByValue ? resolved : undefined } };
        } catch (e) {
            const msg = String((e && e.message) || e);
            return { exceptionDetails: { text: msg, exception: { type: 'object', description: msg } } };
        }
    },
    async 'DOM.querySelector'({ iframe }, { selector }) {
        assertNotHostOrigin(iframe);
        const doc = iframe.contentDocument;
        if (!doc) throw new Error('querySelector: cross-origin iframe');
        const el = doc.querySelector(selector);
        if (!el) return { nodeId: 0 };
        return { nodeId: 1, outerHTML: el.outerHTML, textContent: el.textContent };
    },
    async 'DOM.getOuterHTML'({ iframe }) {
        assertNotHostOrigin(iframe);
        const doc = iframe.contentDocument;
        if (!doc || !doc.documentElement) return { outerHTML: '' };
        return { outerHTML: doc.documentElement.outerHTML };
    },
    async 'Network.getRecent'({ network }) {
        return { entries: network.slice(-100) };
    },
    async 'Network.clear'({ network }) {
        network.length = 0;
        return {};
    },
};

export function createBrowserPane({ container, instanceId = 'default', initialUrl = 'about:blank', snapshot = null } = {}) {
    if (!container) throw new Error('createBrowserPane: container required');

    // The nav actor is the source of truth for {url, history, historyIndex}.
    // On restore we rehydrate from the persisted snapshot; otherwise we seed
    // from initialUrl. A malformed snapshot is discarded (with a warning) so a
    // corrupted payload can't silently fall back to defaults masquerading as a
    // fresh-seed boot.
    if (snapshot && (!snapshot.context
        || typeof snapshot.context.url !== 'string'
        || !Array.isArray(snapshot.context.history)
        || typeof snapshot.context.historyIndex !== 'number'
        || snapshot.context.historyIndex < 0
        || snapshot.context.historyIndex >= snapshot.context.history.length)) {
        console.warn('[browser-pane] discarding invalid snapshot - missing/malformed context shape', snapshot);
        snapshot = null;
    }
    const actor = snapshot
        ? createActor(browserMachine, { snapshot })
        : createActor(browserMachine, { input: { url: initialUrl } });
    actor.start();
    const startUrl = actor.getSnapshot().context.url || initialUrl;

    const iframe = document.createElement('iframe');
    iframe.className = 'app-iframe web';
    // No allow-top-navigation* tokens: a framed page can script/submit/popup
    // but cannot redirect window.top or framebust the host shell.
    iframe.sandbox = 'allow-scripts allow-forms allow-popups allow-same-origin';
    iframe.src = safeNavUrl(startUrl);
    container.appendChild(iframe);

    // Blank-state placeholder: a bare about:blank iframe is a large empty
    // white/dark rectangle with no affordance -- shown only while the pane's
    // own url is about:blank, hidden the instant a real navigation lands.
    // CSS lives upstream (bp-empty class, zero-design-CSS contract).
    const emptyState = document.createElement('div');
    emptyState.className = 'bp-empty';
    emptyState.textContent = t('browserPane.emptyState', 'enter a URL above to browse');
    container.appendChild(emptyState);
    function syncEmptyState(url) {
        const blank = !url || url === 'about:blank';
        emptyState.hidden = !blank;
        iframe.hidden = blank;
    }
    syncEmptyState(startUrl);

    // Intentionally NOT part of the browserMachine actor/persisted snapshot
    // (see the {url, history, historyIndex} contract comment above the
    // machine definition): the network log is pane-session-transient by
    // design and resets on every restore/reload, unlike url/history which
    // survive a refresh.
    const network = [];
    let disposed = false;
    // In-flight load listeners/timers (Page.navigate, Page.reload,
    // syncIframeToUrl) register a { cleanup, onSuperseded } pair here so
    // dispose() can force them off the dead iframe instead of leaving them to
    // fire 15s later against a stopped actor, AND so a new overlapping
    // navigation can force-reject any prior still-pending call instead of
    // leaving it to hang forever or (worse) cross-resolve on the new
    // navigation's 'load' event.
    const pendingCleanups = new Set();
    function registerPending(cleanup, onSuperseded) {
        const entry = { cleanup, onSuperseded: onSuperseded || cleanup };
        pendingCleanups.add(entry);
        return () => pendingCleanups.delete(entry);
    }
    // Force off every still-armed prior navigation's 'load' listener/timer
    // AND reject its promise before a new navigation starts, so a stale
    // onLoad can never fire on a DIFFERENT navigation's load event (see
    // handlers.'Page.navigate' comment above for the exact race this closes)
    // and its caller never hangs waiting on a promise nothing will settle.
    function supersedePending() {
        for (const entry of [...pendingCleanups]) entry.onSuperseded();
    }

    const ctx = { iframe, network, registerPending, supersedePending };
    async function send(method, params = {}) {
        if (disposed) throw new Error('CDP: pane disposed');
        const h = handlers[method];
        if (!h) throw new Error('CDP: unknown method ' + method);
        // Drive the nav machine for navigation so {url, history, historyIndex}
        // stay canonical and survive a refresh. The iframe load result feeds
        // back LOADED/ERROR.
        if (method === 'Page.navigate' && params.url) {
            actor.send({ type: 'NAVIGATE', url: params.url });
            syncEmptyState(params.url);
            try {
                const r = await h(ctx, params);
                if (!disposed) actor.send({ type: 'LOADED' });
                return r;
            } catch (e) {
                if (!disposed) actor.send({ type: 'ERROR' });
                throw e;
            }
        }
        return await h(ctx, params);
    }

    // Navigate to the machine's current url (used by BACK/FORWARD/restore).
    // Also participates in the shared pendingCleanups supersession: a
    // Page.navigate/Page.reload racing a BACK/FORWARD (or two BACK/FORWARDs
    // back-to-back) must not let this call's onLoad fire on a later,
    // different navigation's load event either.
    async function syncIframeToUrl() {
        if (disposed) return Promise.resolve(null);
        supersedePending();
        const url = safeNavUrl(actor.getSnapshot().context.url);
        syncEmptyState(actor.getSnapshot().context.url);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => { cleanup(); reject(new Error('syncIframeToUrl timeout')); }, 15000);
            const onLoad = () => {
                cleanup();
                if (!disposed) actor.send({ type: 'LOADED' });
                pushNetwork(network, { ts: Date.now(), method: 'GET', url, type: 'navigation' });
                resolve({ url });
            };
            function cleanup() { clearTimeout(t); iframe.removeEventListener('load', onLoad); unregister(); }
            const unregister = registerPending(cleanup, () => { cleanup(); reject(new Error('syncIframeToUrl superseded')); });
            iframe.addEventListener('load', onLoad);
            iframe.src = url;
        });
    }

    function back() {
        const before = actor.getSnapshot().context.historyIndex;
        actor.send({ type: 'BACK' });
        if (actor.getSnapshot().context.historyIndex !== before) return syncIframeToUrl();
        return Promise.resolve(null);
    }
    function forward() {
        const before = actor.getSnapshot().context.historyIndex;
        actor.send({ type: 'FORWARD' });
        if (actor.getSnapshot().context.historyIndex !== before) return syncIframeToUrl();
        return Promise.resolve(null);
    }

    async function shellCmd(line) {
        const tokens = line.trim().split(/\s+/);
        const verb = tokens[0];
        const args = tokens.slice(1);
        switch (verb) {
            case 'navigate': return JSON.stringify(await send('Page.navigate', { url: args[0] }));
            case 'back': { const r = await back(); return r ? JSON.stringify(r) : t('browser.noBackHistory', 'browser: no back history'); }
            case 'forward': { const r = await forward(); return r ? JSON.stringify(r) : t('browser.noForwardHistory', 'browser: no forward history'); }
            case 'reload': return JSON.stringify(await send('Page.reload'));
            case 'eval': return JSON.stringify(await send('Runtime.evaluate', { expression: args.join(' ') }));
            case 'screenshot': {
                const r = await send('Page.captureScreenshot');
                return r.data ? t('browser.screenshotResult', '[png {bytes} bytes base64]', { bytes: r.data.length }) : t('browser.screenshotEmpty', '[empty]');
            }
            case 'query': return JSON.stringify(await send('DOM.querySelector', { selector: args.join(' ') }));
            case 'html': return (await send('DOM.getOuterHTML')).outerHTML.slice(0, 500);
            case 'network': return JSON.stringify((await send('Network.getRecent')).entries, null, 2);
            case 'help': return t('browser.helpText', 'navigate <url> | back | forward | reload | eval <expr> | screenshot | query <sel> | html | network');
            default: return t('browser.unknownSubcommand', "browser: unknown subcommand '{verb}'. Try: help", { verb });
        }
    }

    const handle = {
        instanceId,
        send,
        shellCmd,
        back,
        forward,
        get iframe() { return iframe; },
        get networkLog() { return network.slice(); },
        get url() { return actor.getSnapshot().context.url; },
        get history() { return actor.getSnapshot().context.history.slice(); },
        get historyIndex() { return actor.getSnapshot().context.historyIndex; },
        // History availability, so the chrome can disable inert back/forward.
        get canBack() { return actor.getSnapshot().context.historyIndex > 0; },
        get canForward() { const c = actor.getSnapshot().context; return c.historyIndex < c.history.length - 1; },
        // Subscribe to nav-state changes (url/history/index); returns unsubscribe.
        onNavChange(cb) { const sub = actor.subscribe(() => cb()); return () => sub.unsubscribe(); },
        // Persistence unit: the actor's persisted snapshot is canonical — pass
        // it back into createBrowserPane({ snapshot }) to resume url + history.
        getPersistedSnapshot: () => actor.getPersistedSnapshot(),
        // xstate-everywhere getViewState contract: captures the actor snapshot so
        // the WM shell can persist/restore this pane's url+history across refresh.
        getViewState: () => { try { return { browserSnapshot: actor.getPersistedSnapshot() }; } catch { return null; } },
        // restoreViewState is intentionally absent here: hot-swapping the actor
        // and iframe in place requires external recreation via createBrowserPane({snapshot}).
        // The browserApp() wrapper in apps.js implements the full restore path.
        dispose() {
            disposed = true;
            // Force off any in-flight navigate/reload/syncIframeToUrl listener+timer
            // before the iframe is removed (iframe.remove() fires no 'load' event,
            // so without this the promise would hang until its own 15s timeout and
            // then still touch the now-stopped actor).
            for (const entry of Array.from(pendingCleanups)) entry.onSuperseded();
            actor.stop();
            iframe.remove();
            if (typeof window !== 'undefined' && window.__debug && window.__debug.instances
                && window.__debug.instances[instanceId] && window.__debug.instances[instanceId].browser === handle) {
                delete window.__debug.instances[instanceId].browser;
            }
        },
    };

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[instanceId] = window.__debug.instances[instanceId] || {};
        window.__debug.instances[instanceId].browser = handle;
    }
    return handle;
}
