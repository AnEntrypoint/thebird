// Answers the freddie dashboard's own /api/* fetches (health/agents/sessions/
// models/sampler/models/availability-summary) from real in-page state instead
// of letting them 404 against thebird's static file server. These paths are
// freddie's own Node/Express server routes and never exist in thebird's
// browser-native deployment (docs/vendor/components/freddie/runtime.js's
// api() helper does a same-origin fetch(path) with no backend to answer it).
//
// Each dashboard window owns a distinct thebird instance (see
// "sw-per-instance-isolation" project memory -- multi-instance is a first-
// class feature, not an edge case). A single global window.fetch monkey-patch
// resolving data via window.__debug.shell.active mixes data across instances:
// a background instance's dashboard would answer its own /api/sessions call
// with whichever OTHER instance happens to be the currently-active one. So
// the patch is installed once per distinct owning instance (keyed by
// instance.id) and its handlers close over that instance directly instead of
// re-deriving "active" at fetch time.
//
// Still a global window.fetch monkey-patch (not a Service Worker change) so
// it cannot affect any other request path thebird already serves -- every
// non-matching URL passes straight through to the previous fetch, unchanged.
// Multiple installs chain: each wraps the previous fetch and only intercepts
// its own instance's dashboard-originated requests via the path->handler map,
// falling through otherwise -- so N installed instances chain N thin wrappers,
// not N independent monkey-patches racing each other.
const API_PATHS = new Set(['/api/health', '/api/agents', '/api/sessions', '/api/models/sampler', '/api/models/availability/summary']);

function getGm() {
    return (typeof window !== 'undefined' && window.__debug && window.__debug.gm) || null;
}

function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Re-resolves the live instance object for `id` at call time instead of
// trusting the object captured once at install time. os-shell.js's
// newInstance({forceId: id}) restore/error-retry path (docs/os-shell.js,
// see instance-registry.js's header comment: "the Map is mutated in place
// (set/delete)") REPLACES the registry's Map entry for an existing id with a
// brand-new {id, fs, worker, ...} object -- same id, distinct fs. Without
// re-resolving here, a dashboard window mounted before that replacement
// would keep answering /api/sessions from the stale pre-replacement fs
// forever (installFreddieDashboardApiShim's installedInstanceIds guard is
// keyed on id, so the second mount's install is a no-op and never refreshes
// the closure). Falls back to the originally captured `instance` when the
// registry has nothing live for the id (e.g. window.__debug not wired, such
// as in a unit test harness).
function currentInstance(instance) {
    const id = instance && instance.id;
    if (typeof window === 'undefined' || !window.__debug || !window.__debug.instances || !id) return instance;
    return window.__debug.instances[id] || instance;
}

function makeHandlers(instance) {
    async function answerHealth() {
        const gm = getGm();
        return jsonResponse({ ok: true, gm: !!gm, ts: Date.now() });
    }
    async function answerAgents() {
        // thebird has no separate "agent" process concept -- each chat turn IS
        // the agent run. Report this dashboard's own owning instance's turn
        // state as the one agent this browser-native deployment actually has.
        // Derive status from the same /chat-db/sessions.json source
        // answerSessions() reads (docs/lib/chat.js:242's getActiveSessions()
        // filters purely on `s.status === 'active'`) instead of hardcoding
        // 'idle' -- a session goes 'active' at createSession() and is flipped
        // off streaming completion/error, so a plain read-at-call-time here
        // reflects real in-flight state even if this shim mounted mid-stream
        // (an event-bus subscription installed after STREAMING_START fired
        // would miss that window; a direct read never does).
        const live = currentInstance(instance);
        if (!live) return jsonResponse({ agents: [] });
        let status = 'idle';
        try {
            if (live.fs && live.fs.readFile) {
                const raw = live.fs.readFile('/chat-db/sessions.json');
                const sessions = raw ? JSON.parse(raw) : {};
                const hasActive = Object.values(sessions && typeof sessions === 'object' ? sessions : {})
                    .some(s => s && s.status === 'active');
                if (hasActive) status = 'running';
            }
        } catch { /* malformed/missing sessions store -- fall back to idle */ }
        return jsonResponse({ agents: [{ id: live.id, status }] });
    }
    async function answerSessions() {
        // The dashboard's own consumers (pages-overview.js/pages-workspace.js in
        // docs/vendor/components/freddie) resolve `api('/api/sessions')` and do
        // `Array.isArray(rows)`/`Array.isArray(s.list)` directly on it, then read
        // `x.id`, `x.title`, `x.platform`, `x.updated_at` off each row -- they
        // expect freddie's own Node/Express bare-array session-row shape, not an
        // envelope object. thebird's chat store (docs/lib/chat.js) instead
        // persists TWO separate documents keyed by different ids:
        // /chat-db/sessions.json -> {id, conversationId, status, startedAt} and
        // /chat-db/conversations.json -> {id, createdAt, title} (title lives on
        // the conversation, joined via conversationId). Project both into the
        // exact field set the dashboard reads, as a bare array.
        const live = currentInstance(instance);
        if (!live || !live.fs) return jsonResponse([]);
        try {
            const readJson = (path) => {
                const raw = live.fs.readFile ? live.fs.readFile(path) : null;
                return raw ? JSON.parse(raw) : {};
            };
            const sessions = readJson('/chat-db/sessions.json');
            const conversations = readJson('/chat-db/conversations.json');
            const rows = Object.values(sessions && typeof sessions === 'object' ? sessions : {})
                .filter(s => s && s.id)
                .map(s => {
                    const conv = (conversations && typeof s.conversationId === 'string' && Object.hasOwn(conversations, s.conversationId))
                        ? conversations[s.conversationId]
                        : null;
                    return {
                        id: s.id,
                        title: (conv && conv.title) || null,
                        platform: 'thebird',
                        updated_at: s.startedAt || (conv && conv.createdAt) || null,
                    };
                });
            return jsonResponse(rows);
        } catch (err) {
            console.warn('[freddie-dashboard-api-shim] answerSessions: failed to read/parse chat-db (instance=%s):', live.id, err);
            return jsonResponse([]);
        }
    }
    async function answerModelsSampler() {
        return jsonResponse({ providers: [], note: 'thebird routes model calls through acptoapi; no per-provider sampler is tracked client-side' });
    }
    async function answerModelsAvailability() {
        return jsonResponse({ available: [], note: 'thebird routes model calls through acptoapi; no local availability probe is tracked client-side' });
    }
    return {
        '/api/health': answerHealth,
        '/api/agents': answerAgents,
        '/api/sessions': answerSessions,
        '/api/models/sampler': answerModelsSampler,
        '/api/models/availability/summary': answerModelsAvailability,
    };
}

const installedInstanceIds = new Set();
export function installFreddieDashboardApiShim(instance) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const key = instance && instance.id;
    // No owning instance available (defensive fallback) -- still guard against
    // re-wrapping fetch on every mount, using a fixed sentinel key.
    const guardKey = key || '__no-instance__';
    if (installedInstanceIds.has(guardKey)) return;
    installedInstanceIds.add(guardKey);

    const HANDLERS = makeHandlers(instance);
    const prevFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        let path = url;
        let sameOrigin = true;
        try {
            const parsed = new URL(url, window.location.href);
            path = parsed.pathname;
            sameOrigin = parsed.origin === window.location.origin;
        } catch { /* not a URL-parseable input, fall through unchanged */ }
        // Method: prefer init.method, fall back to a Request input's own method
        // (matches window.fetch's own precedence -- new Request(url,{method}) is
        // a valid input shape and init may be omitted entirely).
        const rawMethod = (init && init.method) || (input && typeof input !== 'string' && input.method) || 'GET';
        const method = String(rawMethod).toUpperCase();
        const isReadMethod = method === 'GET' || method === 'HEAD';
        const handler = (sameOrigin && isReadMethod && API_PATHS.has(path)) ? HANDLERS[path] : null;
        if (handler) return handler();
        return prevFetch(input, init);
    };
}
