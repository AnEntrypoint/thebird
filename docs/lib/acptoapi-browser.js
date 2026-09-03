// Browser-native acptoapi shim for thebird.
//
// SECURITY RULE (auth-bearing exchanges): every call in this file that
// attaches an API key/token to a request (see callDirectProvider's
// `Bearer`/`x-api-key` header assembly, and readInstanceKeys' pull from
// window.__debug.config) executes in the PAGE's own JS context, never inside
// a Worker. This file is not imported by anything that also constructs
// `new Worker(...)` today (confirmed by grep — instance-worker.js and
// instance-fs-opfs.js each spawn Workers, the latter for OPFS file I/O
// (createSyncAccessHandle is Worker-only), but neither imports this module).
// If a future refactor ever needs acptoapi-style chat dispatch from inside a
// Worker, only short-lived tokens should cross the postMessage boundary into
// it — never these long-lived provider API keys.
// A Worker's postMessage channel is easier to intercept/exfiltrate from than
// same-context page JS (any script with a handle to the Worker, including a
// compromised/third-party-origin variant, can observe messages sent to it),
// so long-lived secrets must stay confined to the page context that already
// holds them via instance.fs / window.__debug.config.
//
// Apps inside thebird import `acptoapi` (resolved via the os.html importmap
// to this file) and get the subset of the acptoapi surface freddie + other
// apps actually use. Heavy work (model routing, fallback chain, sampler)
// happens at the acptoapi HTTP service (default http://localhost:4800);
// this shim just normalizes call shapes and never throws — it returns
// well-shaped objects on every failure so consumers fall through to the
// next link of the gateway chain instead of crashing.
//
// Surface (mirrors `acptoapi` index.js, browser subset):
//   PROVIDER_KEYS, PROVIDER_DEFAULTS   — name -> env-var / default-model maps
//   buildAutoChain(opts?)              — preferred-order array
//   getStatus()                        — sampler status snapshot
//   chat(opts)                         — single LLM round-trip via HTTP
//   isAvailable(provider)              — best-effort liveness
//
// All async functions return resolved promises (never reject); on error
// they return { error: <string> } so the gateway chain can move on.

// chat.js's events section has zero imports of its own (pure vocabulary module), so
// pulling it in here does not create the freddie-chat.js <-> acptoapi-browser.js
// cycle that importing freddie-chat.js directly would (freddie-chat.js is the
// one that imports *this* file for chat()/chain()). This is the cleanest wiring
// point for RATE_LIMIT_HIT/CLEAR: the rate-limit condition is detected and the
// retry-after-cooldown happens inside externalAcptoapiChat/chat below, so the
// emit belongs next to the code that observes and reacts to it, not bounced
// back up through an onFallback-style callback into freddie-chat.js.
import { ChatEvent, chatEventBus } from './chat.js';
import { createWsRouter } from './ws-router.js';
import { uid } from '../vendor/uid.js';

const DEFAULT_BASE = 'http://localhost:4800';

// When the page runs on a non-localhost origin (e.g. gh-pages), a fetch to
// http://localhost:4800 hangs forever in Chrome instead of fast-failing —
// there is no provider listening on the user's box from the browser's PoV,
// and mixed-content / private-network rules don't reject cleanly. We
// short-circuit such endpoints so the gateway chain moves to the next link.
function isLoopbackUrl(u) {
    try {
        const x = new URL(u, location?.href || 'http://_/');
        const h = (x.hostname || '').toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';
    } catch { return false; }
}
function pageIsLoopback() {
    try {
        const h = (location?.hostname || '').toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '::1';
    } catch { return true; }
}
function endpointReachable(u) {
    // Loopback URLs are only reachable when the page itself is on loopback.
    if (isLoopbackUrl(u)) return pageIsLoopback();
    return true;
}

// Fast-fail fetch — gh-pages -> localhost hangs without this.
const FETCH_TIMEOUT_MS = 60000;
// A cold/degraded acptoapi daemon serially retries every configured ACP
// backend before giving up (witnessed: 56.164s wall for a real daemon to
// exhaust 12 free-tier OpenRouter attempts and return its own graceful
// "all upstream unavailable" body). The generic FETCH_TIMEOUT_MS races that
// real, valid response and can lose to it — this call site alone gets more
// runway; the loopback-reachability pre-check (isLoopbackUrl/pageIsLoopback)
// still fails a genuinely dead endpoint immediately, so raising this does not
// reintroduce the gh-pages-hang this file's fast-fail contract guards against.
const CHAT_COMPLETIONS_TIMEOUT_MS = 90000;
async function timedFetch(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
}

export const PROVIDER_KEYS = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    groq: 'GROQ_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    google: 'GOOGLE_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    xai: 'XAI_API_KEY',
};

export const PROVIDER_DEFAULTS = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    groq: 'llama-3.3-70b-versatile',
    cerebras: 'llama3.3-70b',
    openrouter: 'openai/gpt-4o-mini',
    mistral: 'mistral-large-latest',
    google: 'gemini-2.5-flash',
    deepseek: 'deepseek-chat',
    xai: 'grok-2-latest',
};

// Curated chain order matching upstream lib/auto-chain.js default.
export const DEFAULT_ORDER = [
    'groq/llama-3.3-70b-versatile',
    'cerebras/llama3.3-70b',
    'openai/gpt-4o-mini',
    'anthropic/claude-haiku-4-5-20251001',
    'mistral/mistral-large-latest',
    'google/gemini-2.5-flash',
    'openrouter/openai/gpt-4o-mini',
];

export const DEFAULT_MODELS = { ...PROVIDER_DEFAULTS };

let _warnedDefault = false;
function getBaseUrl() {
    // Returns the configured base URL from __freddieConfig when available, or
    // falls back to DEFAULT_BASE (localhost:4800). Logs once whenever returning
    // the default so the fallback is never silent (P10: callers can observe via
    // console even though they cannot programmatically distinguish).
    try {
        const cfg = globalThis.__freddieConfig || {};
        const url = cfg?.providers?.openai?.baseUrl || cfg?.acptoapi?.baseUrl;
        if (url) { _warnedDefault = false; return String(url).replace(/\/v1\/?$/, ''); }
    } catch (e) {
        console.warn('[acptoapi] getBaseUrl: config read failed, using default:', e);
    }
    if (!_warnedDefault) { _warnedDefault = true; console.warn('[acptoapi] getBaseUrl: no configured URL found, falling back to', DEFAULT_BASE); }
    return DEFAULT_BASE;
}

export function buildAutoChain(_opts) {
    // Mirrors upstream signature: returns array of {model, ...} objects.
    return DEFAULT_ORDER.map(model => ({ model }));
}

// _status keys are full 'provider/model' strings (or bare provider names) to
// avoid cross-polluting different models under the same provider. One model's
// 401 must not mark all groq models unavailable when another groq model+key
// pair might succeed (P1: isolate state per model-key pair).
const _status = new Map();
export function getStatus() {
    return Object.keys(PROVIDER_KEYS).map(p => ({
        provider: p,
        ok: _statusOkForProvider(p),
        failCount: _statusFailCountForProvider(p),
    }));
}

function _statusOkForProvider(provider) {
    // A provider is ok if any of its model-level entries is ok, or if none
    // have been recorded yet (never seen = optimistic).
    let seen = false;
    for (const [k, v] of _status) {
        if (k === provider || k.startsWith(provider + '/')) {
            seen = true;
            if (v.ok !== false) return true;
        }
    }
    return !seen; // No entry recorded: treat as available (optimistic).
}

function _statusFailCountForProvider(provider) {
    let total = 0;
    for (const [k, v] of _status) {
        if (k === provider || k.startsWith(provider + '/')) total += v.failCount || 0;
    }
    return total;
}

export function markFailed(model) {
    const s = _status.get(model) || { ok: true, failCount: 0 };
    s.ok = false;
    s.failCount += 1;
    _status.set(model, s);
}

export function markOk(model) {
    _status.set(model, { ok: true, failCount: 0 });
}

export function isAvailable(provider) {
    // Returns true if at least one model entry for this provider is ok (or no
    // entry exists). A single model failure does not blacklist the provider.
    return _statusOkForProvider(provider);
}

export function resetAvailability(provider) {
    if (provider) {
        for (const k of [..._status.keys()]) {
            if (k === provider || k.startsWith(provider + '/')) _status.delete(k);
        }
    } else {
        _status.clear();
    }
}

export function peekStatus() { return getStatus(); }

// Single-fire session-expiry hook: callers register a listener via
// onSessionExpired(fn); it fires at most once, the first time the gateway
// returns 401/Unauthorized, so a caller can wire up a reconnect-banner UI
// later without this shim re-firing on every subsequent 401 in the chain.
let _sessionExpiredFired = false;
const _sessionExpiredListeners = new Set();
export function onSessionExpired(fn) {
    if (typeof fn === 'function') _sessionExpiredListeners.add(fn);
    return () => _sessionExpiredListeners.delete(fn);
}
function _fireSessionExpiredOnce(detail) {
    if (_sessionExpiredFired) return;
    _sessionExpiredFired = true;
    for (const fn of _sessionExpiredListeners) {
        try { fn(detail); } catch (e) { console.warn('[acptoapi] onSessionExpired listener error:', e); }
    }
}
// Exposed for callers that want to re-arm detection after a real re-auth.
export function resetSessionExpired() { _sessionExpiredFired = false; }

export function hasProvider(name) {
    return Object.prototype.hasOwnProperty.call(PROVIDER_KEYS, name);
}

export function getOrder() { return [...DEFAULT_ORDER]; }

// Strip provider/ prefix when posting to a raw OpenAI-compatible endpoint
// that wouldn't understand the brand. The acptoapi gateway DOES understand
// the prefix and uses it to route to the right brand — so when the base URL
// looks like acptoapi (any localhost/loopback, or an explicit /v1 acptoapi
// endpoint), we keep the prefix intact. Stripping it on acptoapi causes the
// gateway to fall through to its default queue (mistral-tiny).
function stripProviderPrefix(model, base) {
    if (!model || typeof model !== 'string') return model;
    const slash = model.indexOf('/');
    if (slash < 0) return model;
    if (base && isLoopbackUrl(base)) return model; // acptoapi — keep prefix
    const head = model.slice(0, slash);
    if (hasProvider(head)) return model.slice(slash + 1);
    return model;
}

// Direct-from-browser provider endpoints + CORS verdict + auth shape.
// Browsers can hit these directly with a Bearer key when the user has stored
// one. Anthropic requires the opt-in header; google uses ?key=. Providers
// not listed (kilo/opencode-zen ACP-routed) MUST fall through to external
// acptoapi:4800.
const DIRECT_PROVIDERS = {
    openai:     { url: 'https://api.openai.com/v1/chat/completions',           auth: 'bearer',  fmt: 'openai' },
    groq:       { url: 'https://api.groq.com/openai/v1/chat/completions',      auth: 'bearer',  fmt: 'openai' },
    cerebras:   { url: 'https://api.cerebras.ai/v1/chat/completions',          auth: 'bearer',  fmt: 'openai' },
    mistral:    { url: 'https://api.mistral.ai/v1/chat/completions',           auth: 'bearer',  fmt: 'openai' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',        auth: 'bearer',  fmt: 'openai',
                  extraHeaders: () => ({ 'HTTP-Referer': location?.origin || 'https://thebird', 'X-Title': 'thebird' }) },
    xai:        { url: 'https://api.x.ai/v1/chat/completions',                 auth: 'bearer',  fmt: 'openai' },
    deepseek:   { url: 'https://api.deepseek.com/chat/completions',            auth: 'bearer',  fmt: 'openai' },
    anthropic:  { url: 'https://api.anthropic.com/v1/messages',                auth: 'anthropic', fmt: 'anthropic' },
};

// Pull the active instance's provider keys from window.__debug.config[<id>].
// freddie-keys.js mounts these per-instance. We accept any instance — the
// first one whose .list() returns a non-empty map wins.
async function readInstanceKeys() {
    try {
        const cfg = (typeof globalThis !== 'undefined' && globalThis.__debug && globalThis.__debug.config) || null;
        if (!cfg) return null;
        for (const id of Object.keys(cfg)) {
            const ent = cfg[id];
            if (!ent || typeof ent.get !== 'function') continue;
            // Validate the instance is actually functional before wrapping it.
            // A stale or malformed instance returns null/empty here; skip it so
            // we don't wrap a dead instance that will silently return '' on every
            // .get(provider) call and then fail with 401/403 downstream.
            try {
                const probe = await ent.get('openai');
                if (!probe && !(await ent.get('groq')) && !(await ent.get('anthropic'))) continue;
            } catch { continue; }
            // .list() returns masked values ('sk-...XXXX') — useless for auth.
            // Use .get(provider) to fetch the raw key per provider.
            // Cache to avoid an await-storm.
            return {
                get: async (provider) => {
                    try {
                        const v = await ent.get(provider);
                        if (v != null && String(v) === '') {
                            console.warn('[acptoapi] readInstanceKeys: key for', provider, 'is present but empty (misconfigured?)');
                        }
                        return String(v || '');
                    } catch { return ''; }
                },
                list: async () => {
                    try { return (await ent.list()) || {}; } catch { return {}; }
                },
                instanceId: id,
            };
        }
    } catch { /* swallow: window.__debug.config lookup failed (e.g. shape changed/unavailable), fall through to no-keys */ }
    return null;
}

// Try direct provider call from browser. Returns the OpenAI-shaped response
// (with .choices[0].message.content) or throws.
async function callDirectProvider(provider, modelRest, keys, opts) {
    const cfg = DIRECT_PROVIDERS[provider];
    if (!cfg) throw new Error(`direct: provider ${provider} not browser-callable`);
    const key = await keys.get(provider);
    if (!key) throw new Error(`direct: no key for ${provider}`);
    const headers = { 'content-type': 'application/json' };
    if (cfg.auth === 'bearer') headers['authorization'] = 'Bearer ' + key;
    if (cfg.auth === 'anthropic') {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    if (typeof cfg.extraHeaders === 'function') Object.assign(headers, cfg.extraHeaders());
    let body;
    if (cfg.fmt === 'anthropic') {
        // Convert OpenAI-shaped messages to Anthropic shape.
        const sys = (opts.messages || []).filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const msgs = (opts.messages || []).filter(m => m.role !== 'system').map(m => {
            if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
                // Convert OpenAI tool_calls to Anthropic content blocks.
                const toolUseBlocks = m.tool_calls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.function && tc.function.name, input: (() => { try { return JSON.parse(typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {})); } catch { return {}; } })() }));
                const textContent = typeof m.content === 'string' && m.content ? [{ type: 'text', text: m.content }] : [];
                return { role: 'assistant', content: [...textContent, ...toolUseBlocks] };
            }
            if (m.role === 'tool') {
                // Convert OpenAI tool result to Anthropic tool_result block.
                // tool_call_id can be missing on malformed upstream messages; a bare
                // undefined tool_use_id breaks Anthropic's pairing with the tool_use
                // block, so fall back to a generated id and warn (P10: honest fallback).
                let toolUseId = m.tool_call_id;
                if (!toolUseId) {
                    toolUseId = 'call_' + uid().replace(/-/g, '');
                    console.warn('[acptoapi] tool result message missing tool_call_id; generated', toolUseId);
                }
                return { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] };
            }
            return { role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
        });
        body = { model: modelRest, messages: msgs, max_tokens: opts.max_tokens || 4096 };
        if (sys) body.system = sys;
        if (opts.temperature != null) body.temperature = opts.temperature;
        if (opts.tools && opts.tools.length) {
            body.tools = opts.tools.map(t => { const f = t.function || t; return { name: f.name, description: f.description, input_schema: f.parameters || { type: 'object', properties: {} } }; });
        }
    } else {
        body = { model: modelRest, messages: normalizeMessagesForWire(opts.messages), temperature: opts.temperature ?? 1.0, max_tokens: opts.max_tokens || 4096 };
        if (opts.tools && opts.tools.length) {
            body.tools = opts.tools;
            body.tool_choice = opts.tool_choice || 'auto';
        }
        // Streaming is never forwarded: this call site only ever consumes a single
        // JSON document via r.json() below, with no SSE reader. Forwarding a
        // caller-set opts.stream=true here previously requested an SSE
        // text/event-stream body that r.json() would fail to parse, silently
        // mislabeling the failure as a provider error and burning a retry cycle.
        body.stream = false;
    }
    const r = await timedFetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`${provider} ${r.status}: ${text.slice(0, 200)}`);
    }
    const json = await r.json();
    if (cfg.fmt === 'anthropic') {
        // Adapt to OpenAI shape so freddie's adaptResponse keeps working.
        const content = Array.isArray(json.content) ? json.content.filter(b => b.type === 'text').map(b => b.text || '').join('') : (json.content || '');
        const toolUses = Array.isArray(json.content) ? json.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id && typeof b.id === 'string' ? b.id : 'call_' + uid().replace(/-/g, ''), type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } })) : [];
        const message = { role: 'assistant', content };
        if (toolUses.length) message.tool_calls = toolUses;
        const finish_reason = toolUses.length ? 'tool_calls' : (json.stop_reason || 'stop');
        return adaptPythonTagToolCalls({
            id: json.id, object: 'chat.completion', model: json.model,
            choices: [{ index: 0, message, finish_reason }],
            usage: json.usage,
        });
    }
    return adaptPythonTagToolCalls(json);
}

// Normalize tool_calls.arguments to JSON strings for OpenAI wire encoding.
// Callers may pass messages with object arguments from prior turns; double-
// encoding them would corrupt downstream tool dispatch.
function normalizeMessagesForWire(messages) {
    return (messages || []).map(msg => {
        if (!Array.isArray(msg.tool_calls)) return msg;
        const normalized = msg.tool_calls.flatMap(tc => {
            if (!tc || !tc.function) {
                console.warn('[acptoapi] dropping malformed tool_call (missing .function):', tc);
                return [];
            }
            if (typeof tc.function.arguments === 'string') return [tc];
            if (tc.function.arguments == null) {
                console.warn('[acptoapi] tool_call.function.arguments missing; defaulting to {}:', tc.function.name);
            }
            return [{ ...tc, function: { ...tc.function, arguments: JSON.stringify(tc.function.arguments || {}) } }];
        });
        return { ...msg, tool_calls: normalized };
    });
}

// --- WS transport (C6, opt-in) ---
// Cached router keyed by ws URL so repeated chat() calls in the same page
// session reuse one socket instead of opening a new connection per turn.
// Gated entirely behind cfg.acptoapi.transport === 'ws' — HTTP remains the
// unconditional default (see externalAcptoapiChat below, which only reaches
// for this when the flag is explicitly set).
const _wsRouters = new Map();
function wsUrlFor(base) {
    try {
        const u = new URL(base, location?.href || 'http://_/');
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        if (!u.pathname || u.pathname === '/') u.pathname = '/v1/ws';
        return u.toString();
    } catch {
        return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/v1/ws';
    }
}
async function getWsRouter(base) {
    const url = wsUrlFor(base);
    let router = _wsRouters.get(url);
    if (router && router.isOpen()) return router;
    if (router) { try { router.close(); } catch { /* swallow: stale socket already closed/errored, discarding it regardless */ } _wsRouters.delete(url); }
    router = createWsRouter(url, { requestTimeoutMs: CHAT_COMPLETIONS_TIMEOUT_MS });
    await router.ready;
    _wsRouters.set(url, router);
    return router;
}

// WS-transport variant of the single external-chat round-trip, mirroring
// externalAcptoapiChat's per-candidate loop shape but sending each attempt
// as a `chat.completions` request over the shared ws-router instead of an
// HTTP POST. Kept as a fully separate function (not interleaved into the
// HTTP loop) so the existing, well-exercised HTTP path is untouched by this
// addition — a bug in the WS path cannot regress the default transport.
async function externalAcptoapiChatWs(opts, candidates, base) {
    const messages = normalizeMessagesForWire(opts.messages);
    let lastErr;
    const attempted = [];
    let router;
    try {
        router = await getWsRouter(base);
    } catch (e) {
        // Socket never opened — fall back to the HTTP path entirely rather
        // than fail the whole chat turn on a transport-selection detail.
        console.warn('[acptoapi] ws-router connect failed, falling back to HTTP:', e && e.message);
        return externalAcptoapiChat(opts, candidates, { forceHttp: true });
    }
    for (const m of candidates) {
        try {
            const params = {
                model: stripProviderPrefix(m, base),
                messages,
                temperature: opts.temperature ?? 1.0,
            };
            if (opts.tools && opts.tools.length) params.tools = opts.tools;
            if (opts.tool_choice) params.tool_choice = opts.tool_choice;
            const data = await router.send('chat.completions', params);
            markOk(m);
            return adaptPythonTagToolCalls(data);
        } catch (e) {
            lastErr = e;
            const msg = (e && e.message) || String(e);
            attempted.push({ model: m, reason: msg, isTimeout: /timed out/i.test(msg) });
            markFailed(m);
            if (typeof opts.onFallback === 'function') {
                try { opts.onFallback({ model: m, reason: msg, tier: 'external-ws' }); } catch (cbErr) { console.warn('[acptoapi] onFallback error:', cbErr); }
            }
            if ((e && e.status === 429) || isRateLimitMessage(msg)) {
                const waitSeconds = parseRateLimitResetTime(msg);
                chatEventBus.emit(ChatEvent.RATE_LIMIT_HIT, { waitSeconds, provider: m, tier: 'external-ws' });
                const retryResult = await scheduleRateLimitRetry(waitSeconds, m, async () => router.send('chat.completions', params));
                if (retryResult && !retryResult.error) {
                    markOk(m);
                    return adaptPythonTagToolCalls(retryResult);
                }
                attempted.push({ model: m, reason: retryResult && retryResult.error, isTimeout: false, afterRateLimitRetry: true });
                markFailed(m);
            }
            continue;
        }
    }
    return { _exhausted: true, lastErr, candidates, attempted };
}

// External acptoapi:4800 path (the original chat() body, extracted).
async function externalAcptoapiChat(opts, candidates, _internal = {}) {
    const base = getBaseUrl();
    // Opt-in WS transport (C6): only when cfg.acptoapi.transport === 'ws'.
    // Defaults (flag absent/anything else) keep the existing HTTP behavior
    // below unchanged — this branch is purely additive.
    if (!_internal.forceHttp) {
        try {
            const cfg = globalThis.__freddieConfig || {};
            if (cfg?.acptoapi?.transport === 'ws') {
                return await externalAcptoapiChatWs(opts, candidates, base);
            }
        } catch (e) {
            console.warn('[acptoapi] ws-transport config read failed, using HTTP:', e && e.message);
        }
    }
    // Don't preemptively refuse loopback from a non-loopback page. acptoapi
    // v1+ ships CORS + Private Network Access headers, so the fetch actually
    // succeeds when bunx acptoapi is running locally. The timedFetch timeout
    // (default 60s — handles real slowness; private-network preflight failures
    // surface as quick fetch rejections, not hangs) is the real guard.
    const messages = normalizeMessagesForWire(opts.messages);
    let lastErr;
    const attempted = [];
    for (const m of candidates) {
        try {
            const body = {
                model: stripProviderPrefix(m, base),
                messages,
                temperature: opts.temperature ?? 1.0,
            };
            if (opts.tools && opts.tools.length) body.tools = opts.tools;
            if (opts.tool_choice) body.tool_choice = opts.tool_choice;
            const r = await retryWithBackoff(async () => {
                const rr = await timedFetch(`${base}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                }, CHAT_COMPLETIONS_TIMEOUT_MS);
                // Throw on 5xx so retryWithBackoff's transient-failure check can
                // retry it; 4xx/2xx pass through unchanged for the existing
                // !r.ok handling below to classify (401/429/etc need their own
                // non-retry or cooldown-retry treatment, not blind backoff).
                if (rr.status >= 500) throw new Error(`acptoapi ${rr.status}`);
                return rr;
            });
            if (!r.ok) {
                const text = await r.text().catch(() => '');
                lastErr = new Error(`acptoapi ${r.status}: ${text.slice(0, 200)}`);
                attempted.push({ model: m, reason: lastErr.message, isTimeout: false });
                markFailed(m);
                if (r.status === 401) _fireSessionExpiredOnce({ status: 401, model: m, base, reason: lastErr.message });
                if (typeof opts.onFallback === 'function') {
                    try { opts.onFallback({ model: m, reason: lastErr.message, tier: 'external' }); } catch (e) { console.warn('[acptoapi] onFallback error:', e); }
                }
                // Rate-limited link: give it ONE retry-after-cooldown attempt
                // before moving on to the next link in the chain, per the
                // gateway's per-link-cooldown contract (a 429 usually clears
                // on its own; abandoning the link immediately wastes a
                // perfectly good provider for the rest of the chain's walk).
                if (r.status === 429 || isRateLimitMessage(lastErr.message)) {
                    const waitSeconds = parseRateLimitResetTime(lastErr.message);
                    chatEventBus.emit(ChatEvent.RATE_LIMIT_HIT, { waitSeconds, provider: m, tier: 'external' });
                    const retryResult = await scheduleRateLimitRetry(waitSeconds, m, async () => {
                        const rr = await timedFetch(`${base}/v1/chat/completions`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(body),
                        }, CHAT_COMPLETIONS_TIMEOUT_MS);
                        if (!rr.ok) {
                            const t2 = await rr.text().catch(() => '');
                            throw new Error(`acptoapi ${rr.status}: ${t2.slice(0, 200)}`);
                        }
                        return await rr.json();
                    });
                    if (retryResult && !retryResult.error) {
                        markOk(m);
                        return adaptPythonTagToolCalls(retryResult);
                    }
                    // Retry also failed -- fall through to the next link as usual.
                    attempted.push({ model: m, reason: retryResult && retryResult.error, isTimeout: false, afterRateLimitRetry: true });
                    markFailed(m);
                }
                continue;
            }
            const json = await r.json();
            markOk(m);
            return adaptPythonTagToolCalls(json);
        } catch (e) {
            lastErr = e;
            const isTimeout = e && (e.message === 'timeout' || e.name === 'AbortError' || e.name === 'TimeoutError');
            attempted.push({ model: m, reason: e && e.message || String(e), isTimeout });
            markFailed(m);
            if (typeof opts.onFallback === 'function') {
                try { opts.onFallback({ model: m, reason: e && e.message || String(e), tier: 'external' }); } catch (cbErr) { console.warn('[acptoapi] onFallback error:', cbErr); }
            }
            continue;
        }
    }
    return { _exhausted: true, lastErr, candidates, attempted };
}

// Llama 3.x sometimes emits tool calls in its native `<|python_tag|>` format
// when the system prompt is rich (freddie's case) — e.g.
//   <|python_tag|>web_search.query("emperor penguins")
// or `<|python_tag|>web_search({"query": "emperor penguins"})`.
// Freddie's agent loop reads OpenAI `tool_calls` JSON, not text content, so it
// terminates after one turn when the model went python-tag-mode. Convert
// in-place: parse the call, populate choice.message.tool_calls, set
// finish_reason="tool_calls", clear content. Idempotent — if real tool_calls
// already present, returns json unchanged.
// Kimi / moonshot (and some llama variants) emit tool calls as TEXT in their
// native section format when freddie's system prompt is rich — e.g.
//   <|tool_calls_section_begin|>
//     <|tool_call_begin|> functions.gm:0
//     <|tool_call_argument_begin|> {"verb":"recall","query":"..."}
//     <|tool_call_end|>
//   <|tool_calls_section_end|>
// freddie's agent loop reads OpenAI `tool_calls` JSON, so it never executes
// these and terminates after one turn (witnessed: gm.recall never ran, file
// never written). Parse every <|tool_call_begin|>..argument..end|> block into
// OpenAI tool_calls and set finish_reason. Idempotent. The token name is
// `functions.<tool>:<idx>` (kimi namespaces under `functions.`).
function adaptKimiSectionToolCalls(json) {
    try {
        const choice = json?.choices?.[0];
        if (!choice) return json;
        const msg = choice.message || {};
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return json;
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (!content.includes('<|tool_call_begin|>')) return json;
        const blockRe = /<\|tool_call_begin\|>\s*([\s\S]*?)\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;
        const toolCalls = [];
        let m;
        while ((m = blockRe.exec(content)) !== null) {
            let name = (m[1] || '').trim();
            // strip a leading `functions.` namespace and a trailing `:<idx>`
            name = name.replace(/^functions\./, '').replace(/:\d+\s*$/, '').trim();
            let argStr = (m[2] || '').trim();
            let args, argsStr;
            try { args = JSON.parse(argStr); argsStr = JSON.stringify(args || {}); } catch (e) { argsStr = argStr; console.warn('[acptoapi] kimi section tool arg parse error for', name + ':', e && e.message); }
            if (!name) continue;
            toolCalls.push({ id: 'call_' + uid().replace(/-/g, ''), type: 'function', function: { name, arguments: argsStr } });
        }
        if (!toolCalls.length) return json;
        choice.message = { role: 'assistant', content: '', tool_calls: toolCalls };
        choice.finish_reason = 'tool_calls';
    } catch { /* swallow: kimi-section tool-call adaptation failed on malformed content, return json unmodified */ }
    return json;
}

// Parse the argument list `inner` from a single `<|python_tag|>` call. Returns
// an args object. Positional args are sprayed across the common parameter names
// (query/input/text) because the python-tag format carries no schema - whichever
// name the target tool reads gets the value; the unused keys are ignored.
function parsePyTagArgs(inner) {
    if (!inner) return {};
    if (/^\{[\s\S]*\}$/.test(inner)) {
        // JSON object literal
        try { return JSON.parse(inner); } catch (e) { console.warn('[acptoapi] parsePyTagArgs: JSON parse failed:', e && e.message, 'raw:', String(inner).slice(0, 200)); return { raw: inner }; }
    }
    if (/^"[\s\S]*"$/.test(inner)) {
        // Single quoted-string positional arg
        const s = inner.slice(1, -1);
        return { query: s, input: s, text: s };
    }
    if (/=/.test(inner)) {
        // Python-style kwargs: key="value", k2=42, k3=true
        const args = {};
        const kwRe = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[\d.]+|true|false|null|\{[^}]*\}|\[[^\]]*\])/g;
        let mm;
        while ((mm = kwRe.exec(inner)) !== null) {
            const k = mm[1];
            let v = mm[2];
            if (/^["']/.test(v)) v = v.slice(1, -1);
            else if (/^[\d.]+$/.test(v)) v = Number(v);
            else if (v === 'true') v = true;
            else if (v === 'false') v = false;
            else if (v === 'null') v = null;
            else if (/^[\[{]/.test(v)) { try { v = JSON.parse(v); } catch { /* swallow: not valid JSON, keep the raw string value */ } }
            args[k] = v;
        }
        return args;
    }
    // Bare positional - spray across common parameter names
    return { query: inner, input: inner, text: inner };
}

function adaptPythonTagToolCalls(json) {
    try {
        // kimi-section format first; if it converted, we're done.
        const k = adaptKimiSectionToolCalls(json);
        if (k?.choices?.[0]?.finish_reason === 'tool_calls' && Array.isArray(k.choices[0].message?.tool_calls)) return k;
        const choice = json?.choices?.[0];
        if (!choice) return json;
        const msg = choice.message || {};
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return json;
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (!content.includes('<|python_tag|>')) return json;
        const tag = content.indexOf('<|python_tag|>');
        const after = content.slice(tag + '<|python_tag|>'.length).trim();
        // A model can emit several tool calls, one per line - parse every line so
        // none are silently dropped (mirrors adaptKimiSectionToolCalls' multi-call
        // recovery). Match `name(...)` or `name.method(...)` (llama emits both).
        const lineRe = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\(([\s\S]*?)\)\s*$/;
        const toolCalls = [];
        for (const line of after.split('\n')) {
            const mCall = lineRe.exec(line.trim());
            if (!mCall) continue;
            const toolName = mCall[1].split('.')[0];
            if (!toolName) continue;
            const args = parsePyTagArgs(mCall[2].trim());
            const id = 'call_' + uid().replace(/-/g, '');
            toolCalls.push({ id, type: 'function', function: { name: toolName, arguments: JSON.stringify(args || {}) } });
        }
        if (!toolCalls.length) return json;
        // Preserve any explanatory text the model emitted before the tag instead
        // of discarding it - freddie's tool-call loop only reads tool_calls, but
        // the text is still useful context for transcripts/logging.
        const preamble = content.slice(0, tag).trim();
        choice.message = { role: 'assistant', content: preamble, tool_calls: toolCalls };
        choice.finish_reason = 'tool_calls';
    } catch { /* swallow: python-tag tool-call adaptation failed on malformed content, return json unmodified */ }
    return json;
}

// Single LLM round-trip. Internal-first: try direct-from-browser provider
// calls when keys are configured; on internal-chain-exhaust, fall through to
// external acptoapi:4800 (legacy path). Output mode 'openai' returns the raw
// JSON response.
export async function chat(opts = {}) {
    const model = opts.model || 'openai/gpt-4o-mini';
    const candidates = String(model).split(',').map(s => s.trim()).filter(Boolean);
    let lastErr;
    // Tier 1: internal (direct-from-browser, with the active instance's keys).
    const keys = await readInstanceKeys();
    if (keys) {
        for (const m of candidates) {
            const slash = m.indexOf('/');
            const provider = slash > 0 ? m.slice(0, slash) : 'openai';
            const rest = slash > 0 ? m.slice(slash + 1) : m;
            if (!DIRECT_PROVIDERS[provider]) continue;
            try {
                const json = await retryWithBackoff(() => callDirectProvider(provider, rest, keys, opts));
                markOk(m);
                return json;
            } catch (e) {
                lastErr = e;
                markFailed(m);
                if (typeof opts.onFallback === 'function') {
                    try { opts.onFallback({ model: m, reason: e && e.message || String(e), tier: 'internal' }); } catch (cbErr) { console.warn('[acptoapi] onFallback error:', cbErr); }
                }
                // Same per-link cooldown contract as the external tier: one
                // retry-after-wait attempt on a rate-limited direct-provider
                // link before moving to the next candidate.
                const msg = (e && e.message) || String(e);
                if (isRateLimitMessage(msg)) {
                    const waitSeconds = parseRateLimitResetTime(msg);
                    chatEventBus.emit(ChatEvent.RATE_LIMIT_HIT, { waitSeconds, provider: m, tier: 'internal' });
                    const retryResult = await scheduleRateLimitRetry(waitSeconds, m, () => callDirectProvider(provider, rest, keys, opts));
                    if (retryResult && !retryResult.error && !retryResult._rateLimitRetryFailed) {
                        markOk(m);
                        return retryResult;
                    }
                    markFailed(m);
                }
                continue;
            }
        }
    }
    // Tier 2: external acptoapi:4800 (covers anthropic/kilo/opencode + any
    // direct provider that CORS-blocked or had no key).
    const ext = await externalAcptoapiChat(opts, candidates);
    if (ext && !ext._exhausted) return ext;
    if (ext && ext.lastErr) lastErr = ext.lastErr;
    // Never reject — return a chain-exhaustion error shape so the caller's
    // own fallback chain (freddie's gatewayChain) can take the next link.
    const errMsg = (lastErr && lastErr.message) || 'all candidates failed';
    const attempted = (ext && ext.attempted && ext.attempted.length) ? ext.attempted : candidates.map(m => ({ model: m, reason: (lastErr && lastErr.message) || 'no error recorded' }));
    return { error: 'chain exhausted: ' + errMsg, _exhausted: true, chainHistory: candidates, attempted };
}

// chain() is an alias for chat() in upstream; mirror that.
export const chain = chat;
export const fallback = chat;
export const chatChain = chat;

// Convenience exports that upstream exposes but freddie doesn't yet use
// in the browser path. Keep as no-ops returning sensible defaults so any
// future call doesn't crash.
export async function streamChain(opts = {}) { return chat(opts); }
export function listNamedChains() { return [{ name: 'auto', models: DEFAULT_ORDER }]; }
export function getRunHistory() { return []; }
export function resolveModel(model, base = getBaseUrl()) { return stripProviderPrefix(model, base); }

const RATE_LIMIT_MIN_WAIT_S = 60;
const RATE_LIMIT_DEFAULT_WAIT_S = 300;

// Pragmatic parse of common rate-limit error message shapes into a wait time
// in seconds. Not an NLP parser -- a handful of regexes covering the phrasings
// real providers actually use (OpenAI/anthropic/groq/mistral 429 bodies and
// their Retry-After-style headers-as-text). Always returns a number >= 60s;
// falls back to 300s (5min) when nothing recognizable is found, per spec.
export function parseRateLimitResetTime(errorMessage) {
    const msg = String(errorMessage || '');
    // "retry after 60 seconds" / "retry-after: 60" / bare "retry after 60"
    let m = msg.match(/retry[\s-]?after[:\s]+(\d+)\s*(m|min|minutes?|s|sec|seconds?)?/i);
    if (m) {
        const n = Number(m[1]);
        const unit = (m[2] || 's').toLowerCase();
        const secs = unit.startsWith('m') ? n * 60 : n;
        return Math.max(RATE_LIMIT_MIN_WAIT_S, secs);
    }
    // "try again in 2 minutes" / "try again in 30 seconds"
    m = msg.match(/try again in\s+(\d+)\s*(m|min|minutes?|s|sec|seconds?)?/i);
    if (m) {
        const n = Number(m[1]);
        const unit = (m[2] || 's').toLowerCase();
        const secs = unit.startsWith('m') ? n * 60 : n;
        return Math.max(RATE_LIMIT_MIN_WAIT_S, secs);
    }
    // bare numeric retry-after header value surfaced as text, e.g. "429 {\"retry_after\":45}"
    m = msg.match(/retry[_-]?after["':\s]+(\d+)/i);
    if (m) return Math.max(RATE_LIMIT_MIN_WAIT_S, Number(m[1]));
    // "resets at 5pm UTC" / "resets at 17:00 UTC" -- compute seconds until that
    // clock time today (or tomorrow if already past), UTC-anchored since that's
    // the timezone providers use in these messages.
    m = msg.match(/resets?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(utc)?/i);
    if (m) {
        let hour = Number(m[1]);
        const min = Number(m[2] || 0);
        const ampm = (m[3] || '').toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        const now = new Date();
        let target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, min, 0, 0);
        if (target <= now.getTime()) target += 24 * 60 * 60 * 1000; // already passed today -> tomorrow
        const secs = Math.round((target - now.getTime()) / 1000);
        return Math.max(RATE_LIMIT_MIN_WAIT_S, secs);
    }
    return RATE_LIMIT_DEFAULT_WAIT_S;
}

// Detect whether an error message describes a rate-limit condition (HTTP 429,
// or common provider phrasing). Kept separate from parseRateLimitResetTime so
// callers can classify first, then only parse the wait time when relevant.
function isRateLimitMessage(msg) {
    const s = String(msg || '');
    return /\b429\b/.test(s) || /rate[\s-]?limit/i.test(s) || /too many requests/i.test(s) || /quota/i.test(s);
}

// Transient-failure detection for the bounded-retry-with-backoff path below:
// network-level failures (fetch rejected before any status came back) and
// server-side 5xx responses are worth a couple of quick retries -- they are
// commonly a blip, not a terminal condition for that candidate. 4xx (bad
// request/auth/not-found) and rate limits are NOT transient here: 4xx won't
// self-heal on retry, and 429 already has its own cooldown-then-retry path
// via scheduleRateLimitRetry (isRateLimitMessage), so this stays disjoint
// from that to avoid double-retrying a rate-limited link.
function isTransientFailure(e) {
    if (!e) return false;
    const name = e.name || '';
    const msg = (e.message || String(e) || '');
    if (name === 'AbortError' || name === 'TimeoutError' || /timed out|timeout/i.test(msg)) return true;
    if (/failed to fetch|network|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg)) return true;
    const statusMatch = msg.match(/\b(5\d\d)\b/);
    if (statusMatch) return true;
    if (isRateLimitMessage(msg)) return false;
    return false;
}

// Bounded exponential backoff (3 attempts total: 1 initial + 2 retries,
// 500ms/1000ms delays) around a single candidate's attemptFn. Only retries
// when isTransientFailure() classifies the thrown/rejected error as
// transient (network failure or 5xx) -- a permanent failure (4xx, bad model
// name, etc.) fails fast on the first attempt so the caller moves on to the
// next candidate immediately instead of wasting ~1.5s per dead link.
const TRANSIENT_RETRY_DELAYS_MS = [500, 1000];
async function retryWithBackoff(attemptFn) {
    let lastErr;
    for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await attemptFn();
        } catch (e) {
            lastErr = e;
            if (attempt >= TRANSIENT_RETRY_DELAYS_MS.length || !isTransientFailure(e)) throw e;
            await new Promise(res => setTimeout(res, TRANSIENT_RETRY_DELAYS_MS[attempt]));
        }
    }
    throw lastErr;
}

export function classifyError(e) {
    const message = (e && e.message) || String(e);
    if (isRateLimitMessage(message)) {
        return { kind: 'rate_limit', message, waitSeconds: parseRateLimitResetTime(message) };
    }
    if (/\b401\b/.test(message) || /unauthorized/i.test(message)) return { kind: 'auth', message };
    if (/\b(timeout|AbortError|TimeoutError)\b/i.test(message)) return { kind: 'timeout', message };
    return { kind: 'unknown', message };
}
export function redactKeys(s) { return String(s || ''); }

// One retry-after-cooldown attempt for a single rate-limited link before the
// caller falls through to the next link in the chain. `attemptFn` is a
// zero-arg async thunk that re-issues the same call; resolves to its result,
// or rejects/returns the same failure shape the caller already understands
// (this file's chat()/externalAcptoapiChat() paths use { error } / thrown
// Error consistently, so we just re-throw/return whatever attemptFn produces).
function scheduleRateLimitRetry(waitSeconds, provider, attemptFn) {
    return new Promise((resolve) => {
        setTimeout(async () => {
            try {
                const result = await attemptFn();
                chatEventBus.emit(ChatEvent.RATE_LIMIT_CLEAR, { provider });
                resolve(result);
            } catch (e) {
                resolve({ error: (e && e.message) || String(e), _rateLimitRetryFailed: true });
            }
        }, waitSeconds * 1000);
    });
}

// --- queue surface (parity with acptoapi SDK queues.js) ---
// Browser-side there is no ~/.acptoapi/queues.json; named queues are either the
// in-page internalQueue (from the chat config) or discovered from a reachable
// external daemon's /v1/models. listAllQueues returns the known names; the chat
// config UI does its own live /v1/models probe for the external set.
export function parseCommaList(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
export function splitPrefix(model) {
    const i = String(model).indexOf('/');
    return i < 0 ? { prefix: null, model: String(model) } : { prefix: String(model).slice(0, i), model: String(model).slice(i + 1) };
}
// A queue ref is 'queue/<name>'. resolveQueue returns the ordered model list for
// a name from the supplied queues map, or null if unknown.
export function resolveQueue(name, queues = {}) {
    const key = String(name || '').replace(/^queue\//, '');
    return Array.isArray(queues[key]) ? queues[key].slice() : null;
}
export function listAllQueues(queues = {}) {
    return Object.keys(queues || {}).map(name => ({ name, models: queues[name] }));
}
export function getCachedModels() { return DEFAULT_ORDER.map(p => ({ id: (PROVIDER_DEFAULTS[p] ? p + '/' + PROVIDER_DEFAULTS[p] : p), provider: p })); }

const _default = {
    PROVIDER_KEYS, PROVIDER_DEFAULTS, DEFAULT_ORDER, DEFAULT_MODELS,
    buildAutoChain, getStatus, getOrder, hasProvider,
    chat, chain, fallback, chatChain, streamChain,
    isAvailable, markFailed, markOk, resetAvailability, peekStatus,
    onSessionExpired, resetSessionExpired,
    listNamedChains, getRunHistory, resolveModel, classifyError, redactKeys,
    parseCommaList, splitPrefix, resolveQueue, listAllQueues, getCachedModels,
};

// Mount on window so consumers that probe globalThis.acptoapi (e.g. vendored
// freddie's createRequire fallback) find the shim instead of undefined.
try {
    if (typeof globalThis !== 'undefined' && !globalThis.acptoapi) {
        globalThis.acptoapi = _default;
    }
} catch { /* swallow: globalThis is read-only/frozen or acptoapi already defined by another loader, mounting is best-effort */ }

export default _default;
