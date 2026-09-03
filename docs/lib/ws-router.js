// WebSocket transport for the acptoapi gateway (opt-in alternative to the
// existing HTTP fetch path in acptoapi-browser.js). Speaks a compact JSON
// envelope protocol:
//   request:   { m, r, p }              (method, request-id, params)
//   reply-ok:  { r, d }                 (request-id, data)
//   reply-err: { r, e: { c, m } }       (request-id, error{code,message})
//   broadcast: { t, d } or { type, ... } (server-pushed, no matching r)
//
// JSON only — no binary codec. Per the task's own scope: "Binary codec comes
// along only if the gateway speaks it — otherwise JSON."
//
// Reconnect policy: exposes an explicit reconnect() rather than silent
// auto-reconnect-with-backoff. Rationale: a chat transport's caller (the
// external-mode chat function in acptoapi-browser.js) already has its own
// per-link retry/fallback-chain semantics (see externalAcptoapiChat) — a
// second, independent auto-reconnect loop underneath it would race that
// logic and make failures harder to reason about. Silent background
// reconnect attempts are opaque; instead onclose/onerror reject every
// pending request immediately (fast, honest failure) and the caller decides
// whether/when to call reconnect() (or fall back to HTTP, which is exactly
// what acptoapi-browser.js's caller does today).

let _reqCounter = 0;
function nextRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    _reqCounter += 1;
    return 'req_' + Date.now().toString(36) + '_' + _reqCounter.toString(36);
}

export function createWsRouter(url, opts = {}) {
    const protocols = opts.protocols;
    const connectTimeoutMs = opts.connectTimeoutMs || 15000;

    let ws = null;
    let closedByUser = false;
    const pending = new Map(); // requestId -> { resolve, reject, timer }
    const broadcastHandlers = new Set();

    function rejectAllPending(reason) {
        for (const [id, entry] of pending) {
            clearTimeout(entry.timer);
            try { entry.reject(new Error(reason)); } catch { /* swallow: reject() throwing means the promise already settled, nothing left to do */ }
        }
        pending.clear();
    }

    function handleMessage(raw) {
        if (closedByUser) return;
        let msg;
        try { msg = JSON.parse(raw); } catch (e) {
            console.warn('[ws-router] malformed JSON frame, dropped:', e && e.message);
            return;
        }
        if (msg && typeof msg === 'object' && 'r' in msg && pending.has(msg.r)) {
            const entry = pending.get(msg.r);
            pending.delete(msg.r);
            clearTimeout(entry.timer);
            if (msg.e) {
                const err = new Error((msg.e && msg.e.m) || 'ws-router: request failed');
                err.code = msg.e && msg.e.c;
                // Surface a structured HTTP-style status when the underlying
                // error code carries one, so callers can check e.status===429
                // the same way the HTTP transport checks r.status===429,
                // instead of relying solely on message-string sniffing.
                const numericCode = Number(msg.e && msg.e.c);
                if (Number.isInteger(numericCode) && numericCode >= 100 && numericCode < 600) {
                    err.status = numericCode;
                }
                entry.reject(err);
            } else {
                entry.resolve(msg.d);
            }
            return;
        }
        // Not a reply to any pending request -> broadcast (either {t,d} shape
        // or a raw {type,...} server-pushed event).
        for (const fn of broadcastHandlers) {
            try { fn(msg); } catch (e) { console.warn('[ws-router] broadcast handler error:', e); }
        }
    }

    function open() {
        closedByUser = false;
        return new Promise((resolve, reject) => {
            let settled = false;
            let socket;
            try {
                socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
            } catch (e) {
                reject(e);
                return;
            }
            ws = socket;
            const connectTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try { socket.close(); } catch { /* swallow: socket already closed/errored during the connect race, rejecting with timeout regardless */ }
                reject(new Error('ws-router: connect timeout after ' + connectTimeoutMs + 'ms'));
            }, connectTimeoutMs);

            socket.addEventListener('open', () => {
                if (settled) return;
                settled = true;
                clearTimeout(connectTimer);
                resolve();
            });
            socket.addEventListener('message', (ev) => handleMessage(ev.data));
            socket.addEventListener('close', (ev) => {
                clearTimeout(connectTimer);
                rejectAllPending('ws-router: connection closed' + (ev && ev.code ? ' (code ' + ev.code + ')' : ''));
                if (!settled) { settled = true; reject(new Error('ws-router: closed before open (code ' + (ev && ev.code) + ')')); }
            });
            socket.addEventListener('error', () => {
                // The WebSocket spec deliberately withholds error detail from the
                // 'error' event; the close event that (per spec) always follows
                // carries the actual code/reason, so rejection happens there.
                if (!settled) { /* let close handle rejection with detail */ }
            });
        });
    }

    function send(method, params) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('ws-router: socket not open (readyState=' + (ws ? ws.readyState : 'null') + ')'));
        }
        const r = nextRequestId();
        const envelope = { m: method, r, p: params };
        return new Promise((resolve, reject) => {
            const timeoutMs = opts.requestTimeoutMs || 60000;
            const timer = setTimeout(() => {
                pending.delete(r);
                reject(new Error('ws-router: request "' + method + '" timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
            pending.set(r, { resolve, reject, timer });
            try {
                ws.send(JSON.stringify(envelope));
            } catch (e) {
                pending.delete(r);
                clearTimeout(timer);
                reject(e);
            }
        });
    }

    function onBroadcast(handler) {
        if (typeof handler !== 'function') return () => {};
        broadcastHandlers.add(handler);
        return () => broadcastHandlers.delete(handler);
    }

    function close() {
        closedByUser = true;
        rejectAllPending('ws-router: closed by caller');
        try { if (ws) ws.close(); } catch { /* swallow: socket already closed/never opened, close() must be idempotent for the caller */ }
    }

    function reconnect() {
        try { if (ws) ws.close(); } catch { /* swallow: prior socket already closed/errored, proceed to open a fresh one */ }
        ready = open();
        return ready;
    }

    function isOpen() {
        return !!ws && ws.readyState === WebSocket.OPEN;
    }

    let ready = open();

    const router = { onBroadcast, send, close, reconnect, isOpen };
    Object.defineProperty(router, 'ready', { get: () => ready, enumerable: true });
    return router;
}

export default createWsRouter;
