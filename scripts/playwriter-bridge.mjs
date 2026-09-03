#!/usr/bin/env node
// Companion HTTP bridge between thebird's in-page gm host and a locally
// running playwriter relay (remorses/playwriter). playwriter's own relay
// (default 127.0.0.1:19988) CORS-whitelists only chrome-extension:// origins
// on every /cli/* route (playwriter/src/cdp-relay.ts's hono cors() origin
// callback) -- a normal http://localhost:3000 page origin is rejected before
// it ever reaches /cli/execute or /cli/session/new. thebird's page therefore
// cannot fetch() the relay directly regardless of sandboxing; this script is
// the same-origin-reachable companion process the page CAN fetch(), which
// then makes the server-to-server call to the relay (no CORS involved
// between two Node processes). Mirrors the existing acptoapi (:4800)
// companion-process precedent (see docs/lib/freddie-host-gateway.js's
// checkAcptoapi/acptoapiFallback) -- same shape, same /health probe.
//
// This script never runs playwright/puppeteer itself and never spawns
// Chrome: it is a pure proxy in front of an already-running `playwriter
// browser start` + `playwriter session new` relay, per the user's stated
// preference to consume playwriter's own npm package unmodified.
//
// SECURITY: this bridge binds 127.0.0.1 only, but ANY local page open in the
// SAME browser can otherwise reach a loopback HTTP server regardless of what
// page opened it first (there is no OS-level process identity on a port) --
// a wildcard `Access-Control-Allow-Origin: *` here would let an unrelated,
// possibly malicious page in another tab POST arbitrary JS to /exec and have
// it run inside the user's real, logged-in Chrome session via playwriter.
// CORS is therefore an explicit allowlist of thebird's own known dev-server
// origins (never '*'), and a request whose Origin header is present but not
// on the allowlist is rejected outright -- a same-origin curl/fetch with no
// Origin header (a real Node companion process, not a browser tab) is still
// allowed through, matching how a non-browser HTTP client is unaffected by
// CORS in the first place.
//
// Usage: node scripts/playwriter-bridge.mjs [--port 4801] [--relay-port 19988] [--relay-host 127.0.0.1] [--relay-token <token>] [--allow-origin <origin>]

import http from 'node:http';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function parseArgs(argv) {
    const out = { port: 4801, relayHost: '127.0.0.1', relayPort: 19988, relayToken: process.env.PLAYWRITER_TOKEN || '', allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--port') out.port = Number(argv[++i]);
        else if (a === '--relay-port') out.relayPort = Number(argv[++i]);
        else if (a === '--relay-host') out.relayHost = argv[++i];
        else if (a === '--relay-token') out.relayToken = argv[++i];
        else if (a === '--allow-origin') out.allowedOrigins.push(argv[++i]);
    }
    return out;
}

const cfg = parseArgs(process.argv.slice(2));
const relayBase = `http://${cfg.relayHost}:${cfg.relayPort}`;

async function relayFetch(path, opts = {}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (cfg.relayToken) headers.authorization = `Bearer ${cfg.relayToken}`;
    const r = await fetch(relayBase + path, { ...opts, headers });
    const text = await r.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { status: r.status, body };
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => { data += c; if (data.length > 10_000_000) req.destroy(new Error('body too large')); });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

function sendJson(res, status, obj, originHeaders = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'content-type': 'application/json',
        ...originHeaders,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization',
    });
    res.end(body);
}

// Reflects the request's Origin ONLY if it is on the allowlist -- never '*'.
// No Origin header at all (a plain curl/fetch from a Node companion process,
// which browsers alone attach Origin to) is allowed through with no ACAO
// header, since CORS does not apply to non-browser HTTP clients anyway.
function corsHeadersFor(req) {
    const origin = req.headers.origin;
    if (!origin) return {};
    if (cfg.allowedOrigins.includes(origin)) return { 'access-control-allow-origin': origin, vary: 'Origin' };
    return { __rejected: true };
}

// The playwriter relay a `playwriter session new` creates lives only in that
// relay process's own memory; this bridge holds no session state of its own
// beyond an in-memory cache of gm session_id -> playwriter session id, purely
// to avoid re-creating a playwriter session on every dispatch. Bounded so a
// long-running dev server does not grow this map unbounded across many gm
// sessions -- oldest-by-lastUsed evicted past the cap, mirroring the same
// eviction shape freddie-host-gm-bridge.js already uses for browser_exec.
const SESSION_MAP_CAP = 200;
const sessionsByGmId = new Map();
function pruneSessions() {
    if (sessionsByGmId.size <= SESSION_MAP_CAP) return;
    const entries = [...sessionsByGmId.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (let i = 0; i < entries.length - SESSION_MAP_CAP; i++) sessionsByGmId.delete(entries[i][0]);
}

async function ensurePlaywriterSession(gmSessionId) {
    const cached = sessionsByGmId.get(gmSessionId);
    if (cached) { cached.lastUsed = Date.now(); return cached.playwriterSessionId; }
    const { status, body } = await relayFetch('/cli/session/new', { method: 'POST', body: JSON.stringify({}) });
    if (status !== 200 || !body || !body.id) {
        throw new Error(`playwriter relay session/new failed: status=${status} body=${JSON.stringify(body).slice(0, 300)}`);
    }
    sessionsByGmId.set(gmSessionId, { playwriterSessionId: body.id, lastUsed: Date.now() });
    pruneSessions();
    return body.id;
}

const server = http.createServer(async (req, res) => {
    const cors = corsHeadersFor(req);
    if (cors.__rejected) {
        sendJson(res, 403, { ok: false, error: 'origin not allowed: ' + req.headers.origin });
        return;
    }
    if (req.method === 'OPTIONS') { sendJson(res, 204, {}, cors); return; }
    const url = new URL(req.url, 'http://_');

    if (url.pathname === '/health' && req.method === 'GET') {
        try {
            const r = await fetch(relayBase + '/cli/session/list', { headers: cfg.relayToken ? { authorization: `Bearer ${cfg.relayToken}` } : {} }).catch(() => null);
            sendJson(res, 200, { ok: true, relay: relayBase, relayReachable: !!(r && r.ok), sessions: sessionsByGmId.size }, cors);
        } catch (e) {
            sendJson(res, 200, { ok: true, relay: relayBase, relayReachable: false, error: String(e && e.message || e) }, cors);
        }
        return;
    }

    if (url.pathname === '/exec' && req.method === 'POST') {
        try {
            const { sessionId, code, timeout } = await readJsonBody(req);
            if (!sessionId || typeof code !== 'string' || !code.trim()) {
                sendJson(res, 400, { ok: false, error: 'body requires {sessionId, code}' }, cors);
                return;
            }
            const playwriterSessionId = await ensurePlaywriterSession(String(sessionId));
            const { status, body } = await relayFetch('/cli/execute', {
                method: 'POST',
                body: JSON.stringify({ sessionId: playwriterSessionId, code, timeout: timeout || 30000 }),
            });
            sendJson(res, status === 200 ? 200 : 502, { ok: status === 200, relayStatus: status, ...body }, cors);
        } catch (e) {
            sendJson(res, 502, { ok: false, error: String(e && e.message || e) }, cors);
        }
        return;
    }

    if (url.pathname === '/session-close' && req.method === 'POST') {
        try {
            const { sessionId } = await readJsonBody(req);
            const entry = sessionsByGmId.get(String(sessionId));
            sessionsByGmId.delete(String(sessionId));
            if (entry) {
                await relayFetch('/cli/session/delete', { method: 'POST', body: JSON.stringify({ sessionId: entry.playwriterSessionId }) }).catch(() => {});
            }
            sendJson(res, 200, { ok: true }, cors);
        } catch (e) {
            sendJson(res, 502, { ok: false, error: String(e && e.message || e) }, cors);
        }
        return;
    }

    sendJson(res, 404, { ok: false, error: 'unknown route: ' + req.method + ' ' + url.pathname, routes: ['GET /health', 'POST /exec', 'POST /session-close'] }, cors);
});

server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`[playwriter-bridge] listening on http://127.0.0.1:${cfg.port}, proxying to relay ${relayBase}`);
});
