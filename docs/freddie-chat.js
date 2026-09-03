// Considered / deliberately rejected for this integration plan (C14): TTS/STT
// voice event plumbing, PM2 process-monitoring events, an Electron wrapper,
// asset-server.js routes, http-handler.js routes, and claude-runner-* server
// process spawning. These are all server-only concepts from the source
// material this chat integration was based on and have no analog in thebird's
// fully-in-browser architecture (no Node process host, no filesystem-backed
// server, no OS process spawning available to page JS) -- out of scope here,
// not deferred work.
import { bootHost, createAgentMachine, createActor, getVendoredBootHost, getVendoredCreatePersistentActor, parseTextToolCalls, __freddieLoaderBundle } from './freddie-loader.js';
import { runInstallExecuteVerify } from './agent-run-verify.js';
import { t } from './vendor/i18n.js';
import { createSdk } from './sdk.js';
import { createPluginHost } from './lib/plugin.js';
import { createIdbSnapshotStore, createIdbStepStore } from './lib/freddie-agent-store.js';

// The vendored agent machine resolves tool schemas + dispatches tool calls
// against the VENDORED bundle's host, not thebird's freddie-host.js host where
// gm/read/write/etc. are registered. Without this bridge the model is told
// about no tools (or hallucinates names from the system prompt) and every
// dispatch returns "unknown tool". bridgeAgentTools mirrors thebird's tool
// registry into the vendored host: each tool gets an OpenAI function `schema`
// (so it appears in getEnabledToolSchemas) and a `handler` that delegates to
// thebird's host.pi.dispatchTool (so execution hits the real implementation).
// Idempotent and cheap; run once per agent turn.
// Returns { ok, registered, total, reason } so callers can verify the bridge
// actually mirrored thebird's tools into the vendored host instead of assuming it
// (fire-and-forget hid the turn-1 gm-not-yet-loaded gap).
// Serializes concurrent bridgeAgentTools calls so the vendoredBootHost()
// await below cannot interleave two instances'/turns' registrations into
// vh.pi.tools (a page-wide singleton) — see the ALWAYS-(re-)register
// comment inside doBridgeAgentTools for why the interleave matters.
let _bridgeChain = Promise.resolve();
function bridgeAgentTools(thebirdHost) {
    const run = _bridgeChain.then(() => doBridgeAgentTools(thebirdHost));
    // Keep the chain alive even if this call rejects, so a failure doesn't
    // wedge every subsequent instance's registration behind a broken link.
    _bridgeChain = run.catch(() => {});
    return run;
}
async function doBridgeAgentTools(thebirdHost) {
    try {
        await __freddieLoaderBundle();
        const vendoredBootHost = getVendoredBootHost();
        if (!vendoredBootHost || !thebirdHost || !thebirdHost.pi || !thebirdHost.pi.tools) return { ok: false, registered: 0, total: 0, reason: 'invalid thebird host' };
        const vh = await vendoredBootHost();
        if (!vh || !vh.pi || !vh.pi.tools || typeof vh.pi.tools.register !== 'function') return { ok: false, registered: 0, total: 0, reason: 'vendored host has no tools registry' };
        const list = typeof thebirdHost.pi.tools.values === 'function'
            ? [...thebirdHost.pi.tools.values()]
            : (thebirdHost.pi.tools.list ? thebirdHost.pi.tools.list() : []);
        // ALWAYS (re-)register, never skip an already-present name. vh.pi.tools
        // is a page-wide singleton shared by every thebird instance (the
        // vendored bundle's bootHost() memoizes _host at module scope), so a
        // skip-if-existing guard here permanently binds each tool's `handler`
        // closure to whichever instance registered it FIRST — every other
        // instance's agent turn then silently dispatches tool calls (read/
        // write/list/etc.) against the FIRST instance's thebirdHost/fs
        // instead of its own, a cross-instance filesystem leak. Re-registering
        // on every runAgentTurn call rebinds the closure to the CALLING
        // instance's thebirdHost right before its turn starts. That alone only
        // covers a turn's FIRST tool dispatch though -- a multi-iteration turn
        // awaits an LLM round-trip between iterations, and another instance's
        // 'freddie:gm-ready' listener can re-run this bridge for a different
        // host during that await. runAgentTurn's actor.subscribe therefore
        // re-invokes bridgeAgentTools(host) on every transition of its own
        // turn (not just once here) to rebind these closures back before each
        // subsequent tool-dispatch step, closing that window.
        let registered = 0;
        for (const t of list) {
            if (!t || !t.name) continue;
            const schema = {
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description || '',
                    parameters: t.inputSchema || t.schema?.function?.parameters || { type: 'object', properties: {} },
                },
            };
            vh.pi.tools.register({
                name: t.name,
                description: t.description || '',
                toolset: 'core',
                schema,
                checkFn: t.checkFn,
                requiresEnv: t.requiresEnv,
                // Delegate to thebird's host so the real fs/gm/etc. implementation runs.
                // Malformed JSON args (network truncation, weak gateway) must NOT be
                // silently coerced to {} — that would run the tool with wrong/empty
                // params while the agent loop stays unaware. Surface the parse error
                // as a tool result the loop can see and retry/fallback on.
                handler: async (args, ctx) => {
                    let parsed = args;
                    if (typeof args === 'string') {
                        try { parsed = JSON.parse(args); }
                        catch (e) { return JSON.stringify({ error: 'invalid json arguments: ' + (e && e.message), tool: t.name, raw: String(args).slice(0, 1000) }); }
                    }
                    return thebirdHost.pi.dispatchTool(t.name, parsed !== undefined ? parsed : {}, ctx);
                },
            });
            registered++;
        }
        const after = new Set((vh.pi.tools.list ? vh.pi.tools.list() : []).map(t => t.name));
        const total = list.filter(t => t && t.name).length;
        const allPresent = list.every(t => !t || !t.name || after.has(t.name));
        return { ok: allPresent, registered, total, reason: allPresent ? 'ok' : 'some tools missing after register' };
    } catch (e) { console.warn('[freddie-chat] bridgeAgentTools failed:', e && e.message); return { ok: false, registered: 0, total: 0, reason: String(e && e.message) }; }
}
import { createChatConfig, getAcptoapiConfig } from './chat-config.js';
import { createMachine, createActor as createXActor, assign } from 'xstate';
import { ChatEvent, chatEventBus, createTranscriptStore, createChatBroadcast } from './lib/chat.js';
import { getActiveInstance } from './lib/instance-registry.js';

// chatEvents is the shared bus from chat.js (chatEventBus), not a
// second emitter -- docs/lib/acptoapi-browser.js (imported by this file)
// emits RATE_LIMIT_HIT/RATE_LIMIT_CLEAR on that same bus, so subscribing here
// via chatEvents.on(...) sees producer events from below in the import graph
// too. Exported so future durability work (C2/C3/C4/C5) can subscribe
// without threading a new parameter through every call site.
export const chatEvents = chatEventBus;
if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
    await import('./vendor/web-components/freddie-chat.js');
}

const SLASH_HELP = t('chat.slashHelp', `slash commands:
  /tools                 — list available tools
  /tool <name> <json>    — invoke a tool with JSON args
  /skills                — list registered skills
  /skill <id> <prompt>   — run a freddie skill against a prompt
  /run <prompt>          — chat (default; same as plain message)
  /memory <get|set|list> [key] [value]
  /list [prefix]         — list files
  /read <path>
  /write <path> <body>
  /grep <pattern>
  /web <query>
  /clear                 — clear thread
  /help                  — this`);

async function ensureHost(instance) {
    if (instance.host) return instance.host;
    instance.host = await bootHost({ fs: instance.fs });
    return instance.host;
}

function fmtToolList(tools) {
    return [...tools.values()].map(t => `  ${t.name.padEnd(14)} — ${t.description || ''}`).join('\n');
}

const SLASH_OUTPUT_CAP = 4000;
function truncateSlashOutput(s) {
    s = s == null ? '' : String(s);
    if (s.length <= SLASH_OUTPUT_CAP) return s;
    return s.slice(0, SLASH_OUTPUT_CAP) + `\n… truncated, ${s.length} bytes total`;
}

async function dispatchSlash(host, line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('/')) return null;
    const rest = trimmed.slice(1);
    const sp = rest.indexOf(' ');
    const cmd = sp < 0 ? rest : rest.slice(0, sp);
    const argStr = sp < 0 ? '' : rest.slice(sp + 1).trim();
    if (cmd === 'help') return SLASH_HELP;
    if (cmd === 'clear') return { _clear: true };
    if (cmd === 'config') {
        const fs = host && host.fs;
        if (!fs) return t('chat.noFs', 'no fs');
        const parts = argStr.split(/\s+/).filter(Boolean);
        const op = parts[0] || 'get';
        if (op === 'get') {
            const cfg = fs.getConfig() || {};
            return '```\n' + JSON.stringify({ agent: cfg.agent || {}, providers: Object.keys(cfg.providers || {}), env: Object.keys(cfg.env || {}) }, null, 2) + '\n```';
        }
        if (op === 'set') {
            const key = parts[1];
            const val = parts.slice(2).join(' ');
            if (!key) return t('chat.usageConfigSet', 'usage: /config set agent.provider groq');
            const cfg = fs.getConfig() || {};
            const segs = key.split('.');
            let cur = cfg;
            for (let i = 0; i < segs.length - 1; i++) { cur[segs[i]] = cur[segs[i]] || {}; cur = cur[segs[i]]; }
            cur[segs[segs.length - 1]] = val;
            fs.setConfig(cfg);
            if (fs.flush) await fs.flush();
            return t('chat.setKeyValue', 'set {key}={val}', { key, val });
        }
        if (op === 'clear') {
            const key = parts[1];
            if (!key) return t('chat.usageConfigClear', 'usage: /config clear agent.provider');
            const cfg = fs.getConfig() || {};
            const segs = key.split('.');
            let cur = cfg;
            for (let i = 0; i < segs.length - 1; i++) { if (!cur[segs[i]]) return t('chat.clearedKey', 'cleared {key}', { key }); cur = cur[segs[i]]; }
            delete cur[segs[segs.length - 1]];
            fs.setConfig(cfg);
            if (fs.flush) await fs.flush();
            return t('chat.clearedKey', 'cleared {key}', { key });
        }
        return t('chat.usageConfig', 'usage: /config get | /config set <path> <value> | /config clear <path>');
    }
    if (cmd === 'tools') return fmtToolList(host.pi.tools);
    if (cmd === 'skills') {
        const lines = [...host.pi.skills.values()].map(s => `  ${s.name.padEnd(38)} — ${s.description || ''}`).sort();
        return lines.join('\n') || t('chat.noneRegistered', '(none registered)');
    }
    if (cmd === 'skill') {
        const tsp = argStr.indexOf(' ');
        if (tsp < 0) return t('chat.usageSkill', 'usage: /skill <id> <prompt>');
        const sid = argStr.slice(0, tsp);
        const prompt = argStr.slice(tsp + 1);
        const out = await host.runCli('skill', sid, prompt);
        return out && out.content ? out.content : (out && out.error ? t('chat.errorPrefix', 'error: {msg}', { msg: out.error }) : JSON.stringify(out));
    }
    if (cmd === 'tool') {
        const tsp = argStr.indexOf(' ');
        const tname = tsp < 0 ? argStr : argStr.slice(0, tsp);
        const json = tsp < 0 ? '{}' : argStr.slice(tsp + 1).trim();
        let inp;
        try { inp = json ? JSON.parse(json) : {}; } catch (e) { return t('chat.invalidJson', 'invalid JSON: {msg}', { msg: e.message }); }
        const out = await host.runTool(tname, inp);
        return '\`\`\`\n' + truncateSlashOutput(JSON.stringify(out, null, 2)) + '\n\`\`\`';
    }
    if (cmd === 'memory') {
        const parts = argStr.split(/\s+/);
        const out = await host.runCli('memory', parts[0], parts[1], parts.slice(2).join(' '));
        return truncateSlashOutput(JSON.stringify(out, null, 2));
    }
    if (cmd === 'list') return truncateSlashOutput(JSON.stringify(await host.runTool('list', { prefix: argStr }), null, 2));
    if (cmd === 'read') return truncateSlashOutput(JSON.stringify(await host.runTool('read', { path: argStr }), null, 2));
    if (cmd === 'write') {
        const wsp = argStr.indexOf(' ');
        if (wsp < 0) return t('chat.usageWrite', 'usage: /write <path> <body>');
        return truncateSlashOutput(JSON.stringify(await host.runTool('write', { path: argStr.slice(0, wsp), content: argStr.slice(wsp + 1) }), null, 2));
    }
    if (cmd === 'grep') return truncateSlashOutput(JSON.stringify(await host.runTool('grep', { pattern: argStr }), null, 2));
    if (cmd === 'web') return truncateSlashOutput(JSON.stringify(await host.runTool('web_search', { query: argStr }), null, 2));
    return t('chat.unknownCommand', 'unknown command. /help for list.');
}

function fmtTime() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function getEnv(fs, key, host) {
    const cfg = (fs.getConfig && fs.getConfig()) || {};
    const env = cfg.env || {};
    if (env[key]) return env[key];
    const short = key.toLowerCase().replace(/_api_key$/, '');
    if (typeof fs.getApiKey === 'function') {
        const v = fs.getApiKey(short);
        if (v) return v;
    }
    if (host && host.agentKeysCache && host.agentKeysCache[short]) return host.agentKeysCache[short];
    return null;
}

// A tool_call MUST carry a stable id — it is the key that pairs the call with its
// later role:tool result (resultById[tool_call_id]). A weak/malformed gateway can
// omit it; an undefined id then collides under object-key coercion and the result
// silently fails to pair (the call renders with no output). Guarantee a non-empty
// id at parse time, matching the 'call_'-prefix shape parseTextToolCalls emits.
// Ids minted by the Math.random() fallback below, tracked so a collision (two
// unrelated tool_calls landing on the same id) is caught and regenerated
// instead of silently cross-pairing their results in resultById.
// Bounded FIFO: collision-avoidance only needs uniqueness within a single
// turn's pairing window, not across the page's entire lifetime. Capped so a
// long-running session (many turns/instances) can't leak this Set forever.
const _MINTED_TOOL_CALL_IDS_MAX = 2000;
const _mintedToolCallIds = new Set();
function ensureToolCallId(id) {
    if (id) return id;
    let candidate;
    do {
        const b = new Uint8Array(8);
        // Fallback: crypto unavailable (e.g. non-secure context). Math.random() IDs are
        // not globally unique but are stable within one page load and sufficient for
        // pairing tool_calls with tool results within a single agent turn.
        (globalThis.crypto || {}).getRandomValues ? globalThis.crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.floor(Math.random() * 256));
        candidate = 'call_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    } while (_mintedToolCallIds.has(candidate));
    if (_mintedToolCallIds.size >= _MINTED_TOOL_CALL_IDS_MAX) {
        const oldest = _mintedToolCallIds.values().next().value;
        _mintedToolCallIds.delete(oldest);
    }
    _mintedToolCallIds.add(candidate);
    return candidate;
}

// parseTextToolCalls (kimi <|tool_call_begin|> / llama <|python_tag|> recovery)
// is now imported from the freddie bundle (upstreamed to freddie
// src/agent/tool_call_text.js) — thebird's gateway callLLM reuses it rather than
// carrying a duplicate. See the import at the top of this file.

// Per-provider fetch timeout: without it one hung provider can eat the whole
// 300s agent-turn budget before the chain ever reaches a live fallback.
async function fetchWithTimeout(url, opts, ms = 30000) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); }
    finally { clearTimeout(tid); }
}

// OpenAI tool_call.function.arguments is contractually a string. A tool_call we
// re-send may carry args as either a raw string (provider passthrough) or an
// object (Anthropic input / synthetic). Normalize to a string for re-send so the
// gateway/provider message array is always wire-correct, in one place.
function normalizeToolCallArgs(tc) {
    const args = tc.arguments != null ? tc.arguments : tc.function?.arguments;
    return typeof args === 'string' ? args : JSON.stringify(args || {});
}
// Normalize a raw tool_call object from a provider response into thebird's internal
// shape. Validates name presence (malformed entries filtered out by caller) and
// ensures arguments is always a string per the OpenAI wire protocol contract.
function normalizeParsedToolCall(c) {
    const name = c.function?.name || c.name;
    if (!name || typeof name !== 'string') {
        console.warn('[freddie-chat] tool_call missing/invalid name from provider', c);
        return null;
    }
    const args = c.function?.arguments;
    return { id: ensureToolCallId(c.id), name, arguments: typeof args === 'string' ? args : JSON.stringify(args || {}) };
}

// Exported so freddie-host.js's own `chat` builtin tool (a single-prompt
// surface used by the CLI `run`/`exec`/`delegate`/`batch`/`skill` commands and
// direct `/tool chat {...}` dispatch — NOT the multi-turn agent-turn loop
// below) can delegate to this SAME implementation instead of carrying an
// independent reimplementation of "call an LLM via acptoapi/gateway-chain".
// This was a real, confirmed duplication: two parallel gateway-chain callers
// had drifted (this one gained tool-call recovery, direct-provider-key
// fallback, and Anthropic response-shape handling that the host's `chat` tool
// never received). freddie-host.js's `chat` tool wraps this with its own
// extra concerns (freddie-node HTTP fallback, offline response cache,
// loopback-aware diagnosis) that stay host-side since they are specific to
// that single-prompt surface, not to the shared LLM-calling core.
export function buildBrowserCallLLM(host) {
    const fs = host.fs;
    return async function callLLM({ messages, tools, model }) {
        const cfg = (fs.getConfig && fs.getConfig()) || {};
        const acp = getAcptoapiConfig(fs);
        // Model resolution: explicit arg > a selected external queue > agent.model > 'auto'.
        // A selected queue routes through acptoapi as model 'queue/<name>'.
        let wantedModel = model || (cfg.agent && cfg.agent.model) || null;
        if (acp.queue) wantedModel = 'queue/' + acp.queue;
        // acptoapi mode controls whether we hit the external server, the in-page
        // chain, or both (hybrid = external-first then internal fallback).
        // 'internal' skips the gateway entirely and uses direct provider keys
        // (the internalQueue order, if set, drives which providers are tried).
        const useExternal = acp.mode !== 'internal';
        // External base url is configurable (default 127.0.0.1:4800); gatewayChain
        // entries are appended as additional external fallbacks.
        const chain = useExternal
            ? [acp.baseUrl, ...(Array.isArray(cfg.gatewayChain) ? cfg.gatewayChain : [])].filter(Boolean)
            : [];
        for (const baseUrl of chain) {
            try {
                const url = baseUrl.replace(/\/+$/, '') + '/v1/chat/completions';
                const body = { model: wantedModel || 'auto', messages: messages.map(m => {
                    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
                        return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name || tc.function?.name, arguments: normalizeToolCallArgs(tc) } })) };
                    }
                    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
                    return m;
                }) };
                if (Array.isArray(tools) && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
                const r = await fetchWithTimeout(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                if (!r.ok) { console.warn('[freddie-chat] gateway ' + baseUrl + ' returned ' + r.status); continue; }
                const j = await r.json();
                const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
                let tc = Array.isArray(msg.tool_calls) ? msg.tool_calls.map(normalizeParsedToolCall).filter(Boolean) : [];
                let mContent = typeof msg.content === 'string' ? msg.content : '';
                // Weak gateway models may emit tool calls as text — recover them.
                if (!tc.length) { const txtTc = parseTextToolCalls(mContent); if (txtTc.length) { tc = txtTc.map(t => ({ ...t, id: ensureToolCallId(t.id) })); mContent = ''; } }
                if (typeof window !== 'undefined') { window.__debug = window.__debug || {}; window.__debug.lastProvider = 'gateway:' + baseUrl; }
                return { content: mContent, tool_calls: tc, raw: { provider: 'gateway', baseUrl, model: j.model || body.model } };
            } catch (e) { console.warn('[freddie-chat] gateway ' + baseUrl + ' fetch failed: ' + (e && e.message)); continue; }
        }
        // 2. Internal path: direct provider keys (in-page). In 'external' mode we
        //    skip this so the user genuinely relies on the external server only.
        const compatAll = [
            { name: 'groq', key: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
            { name: 'cerebras', key: 'CEREBRAS_API_KEY', url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama-3.3-70b' },
            { name: 'openrouter', key: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', extraHeaders: { 'HTTP-Referer': 'https://anentrypoint.github.io/thebird/', 'X-Title': 'thebird' } },
            { name: 'mistral', key: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-large-latest' },
            { name: 'openai', key: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
        ];
        // Honor the user-defined internal queue order ('provider/model' entries):
        // reorder/limit the compat list so the in-page chain walks it first.
        let compat = compatAll;
        if (acp.mode !== 'external' && acp.internalQueue.length) {
            const wanted = acp.internalQueue.map(q => String(q).split('/')[0].toLowerCase());
            const byName = new Map(compatAll.map(p => [p.name, p]));
            const ordered = wanted.map(n => byName.get(n)).filter(Boolean);
            // append any not explicitly listed so we still have a final fallback
            compat = [...ordered, ...compatAll.filter(p => !ordered.includes(p))];
        }
        if (acp.mode === 'external') compat = [];
        for (const p of compat) {
            const key = getEnv(fs, p.key, host);
            if (!key) continue;
            const body = { model: wantedModel || p.model, messages: messages.map(m => {
                if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
                    return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name || tc.function?.name, arguments: normalizeToolCallArgs(tc) } })) };
                }
                if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
                return m;
            }) };
            if (Array.isArray(tools) && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
            const headers = { 'content-type': 'application/json', 'Authorization': 'Bearer ' + key, ...(p.extraHeaders || {}) };
            if (typeof window !== 'undefined') { window.__debug = window.__debug || {}; window.__debug.lastProvider = p.name; }
            let r;
            try { r = await fetchWithTimeout(p.url, { method: 'POST', headers, body: JSON.stringify(body) }); }
            catch (e) { console.warn('[freddie-chat] provider ' + p.name + ' fetch failed: ' + (e && e.message)); continue; }
            if (!r.ok) { console.warn('[freddie-chat] provider ' + p.name + ' returned ' + r.status); continue; }
            const j = await r.json();
            const msg = j.choices && j.choices[0] && j.choices[0].message || {};
            let tc = Array.isArray(msg.tool_calls) ? msg.tool_calls.map(normalizeParsedToolCall).filter(Boolean) : [];
            let mContent = typeof msg.content === 'string' ? msg.content : '';
            if (!tc.length) { const txtTc = parseTextToolCalls(mContent); if (txtTc.length) { tc = txtTc.map(t => ({ ...t, id: ensureToolCallId(t.id) })); mContent = ''; } }
            return { content: mContent, tool_calls: tc, raw: { provider: p.name, model: body.model } };
        }
        const anthKey = acp.mode === 'external' ? null : getEnv(fs, 'ANTHROPIC_API_KEY');
        if (anthKey) {
            // Anthropic takes system context as a top-level `system` field, NOT as a
            // role:system message in the array (those would be rejected). Hoist any
            // injected system messages (recalled gm memory / hook context) into it so
            // the fallback path keeps that context instead of dropping it.
            const sysText = messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).filter(Boolean).join('\n\n');
            const body = { model: wantedModel || 'claude-3-5-sonnet-latest', max_tokens: 4096, messages: messages.filter(m => m.role !== 'tool' && m.role !== 'system').map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })) };
            if (sysText) body.system = sysText;
            // Anthropic uses its own tool schema (input_schema, not parameters) and
            // returns tool_use content blocks. Without this the agent could never
            // call a tool via the Anthropic fallback path.
            if (Array.isArray(tools) && tools.length) {
                body.tools = tools.map(t => { const f = t.function || t; return { name: f.name, description: f.description, input_schema: f.parameters || { type: 'object', properties: {} } }; });
            }
            let r;
            try { r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) }); }
            catch (e) { console.warn('[freddie-chat] anthropic fetch failed: ' + (e && e.message)); r = null; }
            // Anthropic is the LAST provider before the offline-friendly fallback —
            // an HTTP error (401 auth, 429 rate-limit) or fetch failure must NOT throw
            // and break the agent turn; fall through to the friendly never-reject return.
            if (r && r.ok) {
                const j = await r.json();
                const blocks = Array.isArray(j.content) ? j.content : [];
                const content = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
                const tcs = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: ensureToolCallId(b.id), name: b.name, arguments: JSON.stringify(b.input || {}) }));
                return { content, tool_calls: tcs, raw: { provider: 'anthropic', model: body.model } };
            }
            if (r) console.warn('[freddie-chat] anthropic ' + r.status);
        }
        // Final never-reject fallback: return friendly message so the agent loop
        // can still complete a turn instead of throwing.
        return {
            content: t('chat.noLlmBackend', 'No LLM backend reachable. Tried gateway chain ({chain}) plus direct provider keys (GROQ/CEREBRAS/OPENROUTER/MISTRAL/OPENAI/ANTHROPIC). Start acptoapi locally or add a key in the Freddie Keys app.', { chain: (chain.length ? chain.join(', ') : 'none') }),
            tool_calls: [],
            raw: { provider: 'offline-friendly' },
        };
    };
}

let _runtimeHandle = null;
function exposeRuntime(handle) {
    _runtimeHandle = handle;
    if (typeof window === 'undefined') return;
    window.__debug = window.__debug || {};
    window.__debug.freddie = {
        get machine() { return handle.machine; },
        get actor() { return handle.actor; },
        get snapshot() { return handle.actor ? handle.actor.getSnapshot() : null; },
        send: (...args) => handle.actor && handle.actor.send(...args),
        run: handle.run,
    };
}

// Per-instance agent-turn persistence store cache. One store pair per
// instance.fs (keyed by fs.instanceId) so concurrent instances never share an
// IDB store, and repeated runAgentTurn calls on the same instance reuse the
// same store rather than re-deriving it every turn.
const _agentStoreCache = new Map();
function getAgentStore(host) {
    const fs = host && host.fs;
    const id = (fs && fs.instanceId) || '?';
    if (_agentStoreCache.has(id)) return _agentStoreCache.get(id);
    const snapshotStore = createIdbSnapshotStore(fs);
    const stepStore = createIdbStepStore(fs);
    // createPersistentActor/runStep expect a single `store` object exposing
    // BOTH contracts (persist/load/clear from the snapshot side, runStep/
    // isStepDone/clearSteps from the step side) — see freddie
    // machines/persistent-actor.js's `store?.persist||persist` fallback chain
    // and step-journal.js's `runStep(..., {store})` delegation.
    const store = {
        persist: snapshotStore.persist, load: snapshotStore.load, clear: snapshotStore.clear,
        list: snapshotStore.list, sweepDone: snapshotStore.sweepDone,
        runStep: stepStore.runStep, isStepDone: stepStore.isStepDone, clearSteps: stepStore.clearSteps, listSteps: stepStore.listSteps,
    };
    _agentStoreCache.set(id, store);
    return store;
}

// Stable per-instance snapshot identity: one resumable "slot" per chat
// surface (instance), matching chatStateKey(sessionId)'s own identity
// (sessionId = String(instance.id), the same id instance.fs.instanceId
// carries) rather than a fresh random id per turn — resumeTurn/
// createPersistentActor can only find a prior turn's snapshot if a NEW turn
// reuses the EXACT (kind,key) the interrupted one used.
const AGENT_TURN_KIND = 'agent-turn';
function agentTurnKey(host) {
    const fs = host && host.fs;
    return String((fs && fs.instanceId) || '?');
}

// Does a resumable (non-final) snapshot exist for this host's instance? Used
// by createFreddieChat at surface-init time to decide whether to offer/
// attempt a resume instead of starting fresh. Best-effort: any store error
// is treated as "nothing to resume" rather than thrown.
export async function hasResumableTurn(host) {
    try {
        const store = getAgentStore(host);
        const snap = await store.load(AGENT_TURN_KIND, agentTurnKey(host), {});
        return !!(snap && snap.status === 'active');
    } catch { return false; }
}

async function runAgentTurn({ host, prompt, messages, onUpdate, resume = false }) {
    // This is a single-shot request/response agent turn today, NOT
    // token-by-token streaming: callLLM awaits one full completion per
    // provider round-trip and the actor resolves once on status==='done'
    // (see the actor.subscribe below). STREAMING_START marks the real start
    // of that turn; there is no genuine incremental-chunk point to pair with
    // STREAMING_PROGRESS, so that event is intentionally left unemitted here.
    chatEvents.emit(ChatEvent.STREAMING_START, { prompt });
    const browserCallLLM = buildBrowserCallLLM(host);
    globalThis.__freddieRuntimeBridge = { host, callLLM: browserCallLLM };
    // Mirror thebird's tools into the vendored host the agent machine dispatches to.
    // If bridging fails the agent would see tools it cannot actually call ('unknown
    // tool' later) — halt the turn now so the failure is honest and immediate.
    const bridgeResult = await bridgeAgentTools(host);
    if (!bridgeResult.ok) throw new Error('tool bridging failed: ' + bridgeResult.reason);
    const events = [];
    const cfgAgent = ((host.fs && host.fs.getConfig && host.fs.getConfig().agent) || {});
    const machine = createAgentMachine({
        provider: cfgAgent.provider || null,
        model: cfgAgent.model || null,
        maxIterations: cfgAgent.max_iterations || cfgAgent.maxIterations || 12,
        // Pass thebird's browser callLLM (posts to the acptoapi gateway at
        // localhost:4800) so the agent uses it instead of the vendored bundle's
        // resolveCallLLM, which tries direct browser->provider calls (no in-page
        // keys) and dead-ends at 'chain exhausted: groq/...'. The
        // __freddieRuntimeBridge global is not read by the vendored machine.
        callLLM: browserCallLLM,
        events,
    });
    // Resumability: drive the actor through freddie's createPersistentActor
    // (persistent-actor.js) with our IndexedDB-backed store injected, instead
    // of a bare createActor. createPersistentActor persists the actor's
    // snapshot on every transition and rehydrates from it on construction when
    // a matching (kind,key) row exists -- this is the actual mechanism a
    // mid-turn page reload resumes from. NOT routed through freddie's
    // runTurn/resumeTurn (machine.js): both hard-call the bare Node-only
    // bootHost() singleton inside their executing_tools tool-dispatch step
    // (machine.js lines 2/109/298/340, confirmed via direct read of the
    // freddie sibling repo -- no adapter seam there), which would bypass
    // thebird's bridgeAgentTools-wired host entirely and break every tool
    // call. createPersistentActor itself has no such dependency (only
    // snapshot persist/load/clear), so this gets real resumability without
    // that blocker. Falls back to a bare createActor if the vendored bundle
    // predates the createPersistentActor export (older cached bundle).
    const kind = AGENT_TURN_KIND;
    const key = agentTurnKey(host);
    const store = getAgentStore(host);
    let actor, pa = null;
    const vendoredCreatePersistentActor = getVendoredCreatePersistentActor();
    if (typeof vendoredCreatePersistentActor === 'function') {
        pa = await vendoredCreatePersistentActor(machine, { kind, key, input: { messages: messages.slice() }, store });
        actor = pa.actor;
        // A resumed actor already has its prior context/state restored by
        // createActor(machine,{snapshot}) internally -- do not re-send SUBMIT
        // (that would append a duplicate user message and restart from idle).
        // A fresh (non-resumed) actor needs the same SUBMIT this file always sent.
        if (!pa.resumed) actor.send({ type: 'SUBMIT', prompt });
        else if (!resume) console.warn('[freddie-chat] runAgentTurn resumed an actor unexpectedly (caller did not pass resume:true) — a stale snapshot from an earlier interrupted turn on this instance was picked up instead of starting fresh.');
        else if (resume && !pa.resumed) console.warn('[freddie-chat] runAgentTurn called with resume:true but no resumable snapshot was found — started a fresh turn instead.');
    } else {
        actor = createActor(machine, { input: { messages: messages.slice() } });
        actor.start();
        actor.send({ type: 'SUBMIT', prompt });
    }
    exposeRuntime({ machine, actor, run: null });
    let lastSnap = null;
    // Configurable via cfgAgent.turn_timeout_ms (default 300s): a tool-use turn
    // makes several LLM round-trips and each acptoapi call can take 30-60s while
    // it serially walks dead providers before a live one answers, so long
    // multi-iteration/high-maxIterations chains need a caller-tunable ceiling
    // rather than a fixed 300s that can still truncate legitimately long turns.
    const turnTimeoutMs = Number(cfgAgent.turn_timeout_ms) > 0 ? Number(cfgAgent.turn_timeout_ms) : 300000;
    // This turn-timeout/partial-transcript-recovery block is thebird-specific
    // and is NOT redundant with freddie's driveAgentActor/timeoutResult
    // (machine.js) even though that logic is now upstreamed there: this file
    // deliberately does not call runTurn/resumeTurn (see the blocker note
    // above), so driveAgentActor's timeout handling is never reached from
    // this code path. Kept, not deleted.
    return await new Promise((resolve, reject) => {
        // On timeout, surface whatever partial transcript the last snapshot held
        // so completed tool steps still render instead of being discarded.
        const timer = setTimeout(() => {
            try { actor.stop(); } catch {
                // swallow: actor may already be stopped/errored — stop() is best-effort cleanup on timeout
            }
            const partial = (lastSnap && lastSnap.context && Array.isArray(lastSnap.context.messages)) ? lastSnap.context.messages : null;
            if (partial) {
                    // Inject synthetic error results for any tool_calls that never
                    // received a paired result before the timeout. This makes the
                    // orphan explicit in the transcript rather than a silent console.warn.
                    const pairedIds = new Set(partial.filter(m => m && m.role === 'tool' && m.tool_call_id).map(m => m.tool_call_id));
                    const lastAssistant = [...partial].reverse().find(m => m && m.role === 'assistant' && Array.isArray(m.tool_calls));
                    if (lastAssistant) {
                        for (const tc of lastAssistant.tool_calls) {
                            if (tc && tc.id && !pairedIds.has(tc.id)) {
                                partial.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'timeout: tool_call interrupted' }), synthetic: true });
                            }
                        }
                    }
                    partial.push({ role: 'system', content: t('chat.turnInterrupted', 'Agent turn interrupted by {s}s timeout. Any tool calls above without paired results were cut short and did not complete.', { s: (turnTimeoutMs / 1000) }), synthetic: true });
                    resolve({ messages: partial, result: null, error: t('chat.turnTimeout', 'agent turn timeout ({s}s)', { s: (turnTimeoutMs / 1000) }), iterations: (lastSnap.context.iterations || 0) });
                }
            else reject(new Error(t('chat.turnTimeout', 'agent turn timeout ({s}s)', { s: (turnTimeoutMs / 1000) })));
        }, turnTimeoutMs);
        actor.subscribe(snap => {
            lastSnap = snap;
            // Re-bind vh.pi.tools' handler closures to THIS turn's host on every
            // transition, not just once at turn start. bridgeAgentTools mutates the
            // page-wide vendored tools singleton (vh.pi.tools) by reference, and a
            // multi-iteration turn awaits an LLM round-trip between tool-call
            // iterations -- an intervening 'freddie:gm-ready' handler for a
            // DIFFERENT instance (see the listener below) can re-register those
            // same closures mid-turn. Re-running the (idempotent, cheap) bridge
            // synchronously on every snapshot rebinds them back to this turn's
            // host immediately before xstate's next tool-dispatch step runs,
            // closing the window instead of relying on it never being hit.
            if (snap.status !== 'done') bridgeAgentTools(host).catch(() => {});
            if (onUpdate) try { onUpdate(snap); } catch {
                // swallow: caller's onUpdate callback threw — don't let a UI render error abort the agent turn
            }
            if (snap.status === 'done') {
                clearTimeout(timer);
                const out = snap.output || { messages, result: null, error: null, iterations: 0 };
                resolve(out);
            }
        });
    });
}

// Expose the full agent loop (host tools + gm + browserCallLLM + tool execution)
// as a page global so freddie's DASHBOARD chat (vendored kit pages-chat.js, an
// upstream surface that otherwise only does a single-shot /v1/chat/completions
// with no tools and no loop) can drive a REAL multi-step agent turn in the
// browser. Without this the dashboard chat narrates ("I will write…") and never
// calls gm/write/read; with it the dashboard chat runs the same loop the
// <freddie-chat> element does. The runner resolves the host from the shell's
// CURRENTLY ACTIVE instance (window.__debug.shell.active, os-shell.js's
// xstate-tracked activeInstance) when one is not passed in, so a dashboard
// chat opened in instance i2 drives i2's tools/fs, not whichever instance
// happened to boot/load first. window.__thebirdHost is a last-loaded-wins
// global (set by freddie-host.js per instance boot) so it is only a fallback
// for the single-instance case; a hardcoded i1 lookup would silently route
// every non-i1 instance's agent turn at i1's filesystem (cross-instance bleed
// - the exact bug this ordering exists to avoid), so i1 is never preferred
// over the live active instance.
if (typeof window !== 'undefined') {
    window.__thebirdRunAgent = async function ({ prompt, messages, onUpdate, host } = {}) {
        const activeInst = getActiveInstance();
        const h = host
            || (activeInst && activeInst.host)
            || (window.__debug && window.__debug.instances && activeInst && window.__debug.instances[activeInst.id] && window.__debug.instances[activeInst.id].host)
            || window.__thebirdHost
            || (globalThis.__freddieRuntimeBridge && globalThis.__freddieRuntimeBridge.host);
        if (!h) throw new Error('no thebird host available for agent run');
        const msgs = Array.isArray(messages) ? messages.slice() : [];
        return await runAgentTurn({ host: h, prompt, messages: msgs, onUpdate });
    };
}

// --- per-instance chat persistence (transcript + unsent composer draft) ----
// Persisted to a reserved key on the instance fs so an accidental refresh
// resumes the conversation AND the typed-but-unsent composer text.
function chatStateKey(sessionId) { return '.chat-state-' + sessionId + '.json'; }

function loadChatState(fs, sessionId) {
    if (!fs || typeof fs.readFile !== 'function') return { messages: [], draft: '' };
    try {
        const raw = fs.readFile(chatStateKey(sessionId));
        if (!raw) return { messages: [], draft: '' };
        const obj = JSON.parse(raw);
        return {
            messages: Array.isArray(obj.messages) ? obj.messages : [],
            draft: typeof obj.draft === 'string' ? obj.draft : '',
            agentMessages: Array.isArray(obj.agentMessages) ? obj.agentMessages : [],
        };
    } catch { return { messages: [], draft: '' }; }
}

function saveChatState(fs, sessionId, state) {
    if (!fs || typeof fs.writeFile !== 'function') return;
    try {
        fs.writeFile(chatStateKey(sessionId), JSON.stringify({
            messages: Array.isArray(state.messages) ? state.messages : [],
            draft: typeof state.draft === 'string' ? state.draft : '',
            agentMessages: Array.isArray(state.agentMessages) ? state.agentMessages : [],
        }));
        if (fs.flush) fs.flush();
    } catch (e) { console.warn('[freddie-chat] persist failed:', e && e.message); }
}

// xstate machine wrapping the chat surface lifecycle. Persistence side-effects
// live in the host closure (persist action injected via implementations); the
// machine itself just tracks state + holds the snapshot of {messages,draft}.
// C11: formalizes the chat-turn lifecycle as idle -> queued -> active ->
// (complete | error | rate-limited). Prior shape was idle/booting/ready/
// sending/streaming/error -- 'booting'+'ready' (host bootstrap, not a turn)
// are kept as-is (still gate SUBMIT the same way), while the turn-proper
// states are renamed/extended: 'sending' -> 'queued' (SUBMIT dispatched,
// turn not yet actually running), 'streaming' -> 'active' (turn actually
// executing), DONE now lands on an explicit 'complete' state (auto-advances
// back to 'ready' via an always-transition so every existing SUBMIT/
// SET_MESSAGES wiring from 'ready' keeps working unchanged), and a new
// RATE_LIMITED event/state is added so C5's future rate-limit handling has
// somewhere to land distinct from a generic 'error'. Extends the existing
// machine minimally rather than replacing it -- STREAM/DONE/ERROR event
// names are preserved so callers (submit() below) don't need to change.
export function createChatMachine({ persist, restored } = {}) {
    return createMachine({
        id: 'chat',
        initial: 'idle',
        context: {
            messages: (restored && restored.messages) || [],
            draft: (restored && restored.draft) || '',
            config: null,
        },
        states: {
            idle: { on: { BOOT: 'booting' } },
            booting: { on: { READY: 'ready', ERROR: 'error' } },
            ready: {
                on: {
                    SUBMIT: 'queued',
                    SET_DRAFT: { actions: ['setDraft', 'persist'] },
                    SET_MESSAGES: { actions: ['setMessages', 'persist'] },
                },
            },
            // queued: SUBMIT has been dispatched but the agent turn has not
            // yet started running (mirrors the old 'sending' state).
            queued: {
                on: {
                    STREAM: 'active',
                    DONE: { target: 'complete', actions: ['setMessages', 'clearDraft', 'persist'] },
                    ERROR: 'error',
                    RATE_LIMITED: 'rate-limited',
                    SET_MESSAGES: { actions: ['setMessages', 'persist'] },
                },
            },
            // active: the agent turn is actually executing (mirrors the old
            // 'streaming' state -- kept as a distinct value from 'queued' so
            // C4's future queue-drain logic can tell "waiting to run" apart
            // from "running now").
            active: {
                on: {
                    DONE: { target: 'complete', actions: ['setMessages', 'clearDraft', 'persist'] },
                    ERROR: 'error',
                    RATE_LIMITED: 'rate-limited',
                    SET_MESSAGES: { actions: ['setMessages', 'persist'] },
                },
            },
            // complete: terminal success marker for one turn. Immediately
            // (eventless 'always' transition) falls through to 'ready' so
            // every existing on:'ready' handler (SUBMIT, SET_DRAFT, ...)
            // keeps working without callers having to special-case
            // 'complete' -- it exists as a real distinct state value so
            // C2/C11's transcriptStore.updateSessionStatus(id,'complete')
            // wiring has a state transition to hang off, not just an event.
            complete: { always: 'ready' },
            'rate-limited': {
                on: {
                    RETRY: 'ready',
                    SUBMIT: 'queued',
                    SET_DRAFT: { actions: ['setDraft', 'persist'] },
                },
            },
            error: { on: { RETRY: 'ready', SUBMIT: 'queued', SET_DRAFT: { actions: ['setDraft', 'persist'] } } },
        },
    }, {
        actions: {
            setDraft: assign({ draft: ({ event }) => (event && typeof event.draft === 'string') ? event.draft : '' }),
            clearDraft: assign({ draft: () => '' }),
            setMessages: assign({
                messages: ({ context, event }) => Array.isArray(event && event.messages) ? event.messages : context.messages,
            }),
            persist: ({ context }) => { if (persist) try { persist(context); } catch {
                // swallow: best-effort draft/transcript persistence to fs — a write failure shouldn't break the chat state machine
            } },
        },
    });
}

export function createFreddieChat({ instance, appRegistry = null } = {}) {
    // Guard against ctx without an active instance (early-boot race or a
    // direct openApp() call before setActiveInstance has populated activeContext).
    // Without this, the destructure leaves `instance` undefined and the title
    // attribute access throws synchronously, blocking the whole open.
    if (!instance || !instance.id) {
        const fallbackShell = (typeof window !== 'undefined' && window.__debug && window.__debug.shell) || null;
        instance = (fallbackShell && fallbackShell.active) || instance || { id: '?', host: null, fs: null };
    }
    const chatEl = document.createElement('freddie-chat');
    chatEl.classList.add('freddie-chat', 'chat');
    chatEl.setAttribute('title', t('chat.assistantTitle', 'assistant · {id}', { id: instance.id }));
    // Until the host boots (first visit downloads the engine in stages --
    // plugkit then the ~136MB bert embedder, ~140MB total -- which can take
    // a few minutes), show a clear booting state so the chat doesn't look
    // ready-but-dead.
    chatEl.setAttribute('sub', t('chat.bootingSub', 'booting runtime — first visit downloads ~140MB engine in stages'));
    chatEl.setAttribute('placeholder', t('chat.bootingPlaceholder', 'booting assistant runtime…'));

    const sessionId = String(instance.id || '?');
    const restored = loadChatState(instance && instance.fs, sessionId);
    const messages = restored.messages.slice();
    const agentMessages = (restored.agentMessages || []).slice();
    let host = null;
    let busy = false;

    // Durable chunked transcript store (docs/lib/chat.js), proof-of-
    // integration wiring: a conversation+session pair is created once per chat
    // surface instantiation and every real pushed message is also persisted
    // through the store, alongside the existing chatStateKey JSON blob (that
    // blob remains the source of truth for resume/redraw; the transcript store
    // is the new durable, chunk-capable record C3/C8/C11 build on next).
    // Created with status 'idle' (not 'active'): this row only scopes
    // createMessage() calls below and is never itself a turn -- submit()
    // creates its OWN per-turn session ('active', see turnSession below) for
    // that purpose. Stamping THIS mount-time row 'active' meant simply
    // opening/reloading the chat window (no message ever sent) left a
    // permanently-active row behind, which recoverInterruptedSessions() then
    // misread as a crashed turn on the next boot -- a false "[interrupted] a
    // turn from a previous session did not finish" banner on a fresh load.
    let transcriptStore = null;
    let transcriptConversationId = null;
    let transcriptSessionId = null;
    try {
        if (instance && instance.fs) {
            transcriptStore = createTranscriptStore(instance);
            const conv = transcriptStore.createConversation(null);
            transcriptConversationId = conv.id;
            transcriptSessionId = transcriptStore.createSession(conv.id, 'idle').id;
        }
    } catch (e) { console.warn('[freddie-chat] transcript store init failed:', e && e.message); }

    // Multi-tab/multi-instance sync (proof-of-integration send-side wiring):
    // one BroadcastChannel scoped to this instance so other TABS on the same
    // instance observe this tab's message_created events. Receiving-tab UI
    // re-render is deliberately out of scope for this pass -- see
    // docs/lib/chat.js broadcast-section header comment.
    const chatBroadcast = createChatBroadcast(instance && instance.id, { transcriptStore });
    if (transcriptConversationId) chatBroadcast.emit('conversation_created', { conversationId: transcriptConversationId });

    // xstate chatMachine: tracks lifecycle (idle/booting/ready/sending/...) and
    // owns the persisted snapshot. The persist action writes {messages,draft,
    // agentMessages} to the instance fs so a refresh resumes the transcript AND
    // the unsent composer draft.
    const persist = (ctx) => saveChatState(instance && instance.fs, sessionId, {
        messages,
        draft: ctx.draft,
        // Exclude synthetic messages (timeout markers, orphan error stubs) from
        // persistence so they are not re-sent to the LLM as real prior turns on
        // the next session. Only genuine LLM-exchange records should persist.
        agentMessages: agentMessages.filter(m => !m || !m.synthetic),
    });
    const chatMachine = createChatMachine({ persist, restored });
    const chatActor = createXActor(chatMachine);
    chatActor.start();
    chatActor.send({ type: 'BOOT' });

    // Persist the visible transcript (driven by messages mutations below).
    const persistMessages = () => chatActor.send({ type: 'SET_MESSAGES', messages: messages.slice() });
    // Debounced draft persistence as the user types.
    let draftTimer = null;
    const persistDraft = (v) => {
        if (draftTimer) clearTimeout(draftTimer);
        draftTimer = setTimeout(() => { chatActor.send({ type: 'SET_DRAFT', draft: v }); }, 250);
    };

    // Wrap the chat element with a shared config strip (model / agent / skills /
    // working folder / plugins / acptoapi mode+queue). thebird-owned surface.
    // Declared after `host` so the getHost closure isn't read during the TDZ.
    const node = document.createElement('div');
    node.className = 'freddie-chat-wrap';
    let cfgUI = null;
    try {
        // Plugin host: appRegistry is passed in from apps.js's chatApp(ctx),
        // which has a direct reference to createAppRegistry()'s registry --
        // plugin.tabs now register as real openable windows via
        // appRegistry.reg() (docs/lib/plugin.js), not just a cosmetic list
        // entry. Falls back to null (no-op tabs registration, same as before)
        // if this chat surface is ever constructed without a registry.
        const pluginSdk = createSdk(instance);
        const pluginHost = createPluginHost(pluginSdk, appRegistry);
        cfgUI = createChatConfig({ instance, getHost: () => host, pluginHost });
        node.append(cfgUI.node);
    } catch (e) { console.warn('[freddie-chat] config strip failed:', e && e.message); }
    node.append(chatEl);

    // --- drag-and-drop file upload into the instance fs -----------------
    // Dropped files land under /attachments/<sessionId>-<dropTimestamp>/<filename>
    // in the instance's own IndexedDB-backed fs (instance-fs.js writeFile), so
    // the agent's existing `read`/`gm fs_read` tools can pick them up by path —
    // no new tool, no upload dialog, just fs + a text reference in the message.
    // Text-like files are written as-is (file.text()); anything else is
    // base64-encoded (writeFile only accepts strings) with a `.b64` suffix so
    // it round-trips exactly and is visibly not raw text.
    const TEXT_EXT = /\.(txt|md|markdown|json|js|mjs|jsx|ts|tsx|py|csv|tsv|html|htm|css|xml|yaml|yml|sh|log|ini|toml)$/i;
    function looksTextual(file) {
        if (file.type && file.type.startsWith('text/')) return true;
        if (file.type === 'application/json' || file.type === 'application/javascript') return true;
        if ((!file.type || file.type === 'application/octet-stream') && TEXT_EXT.test(file.name || '')) return true;
        return false;
    }
    function bufferToBase64(buf) {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    // Pending attachment paths collected between drop and the next send, so
    // submit() can append their references to the outgoing message text.
    let pendingAttachments = [];
    async function handleDroppedFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length || !instance || !instance.fs) return [];
        const folder = '/attachments/' + sessionId + '-' + Date.now() + '/';
        const written = [];
        for (const file of files) {
            try {
                const safeName = String(file.name || 'file').replace(/[\\/]/g, '_');
                if (looksTextual(file)) {
                    const text = await file.text();
                    const path = folder + safeName;
                    instance.fs.writeFile(path, text);
                    written.push(path);
                } else {
                    const buf = await file.arrayBuffer();
                    const path = folder + safeName + '.b64';
                    instance.fs.writeFile(path, bufferToBase64(buf));
                    written.push(path);
                }
            } catch (e) { console.warn('[freddie-chat] attachment write failed for', file && file.name, e && e.message); }
        }
        if (instance.fs.flush) try { await instance.fs.flush(); } catch { /* swallow: flush is best-effort, attachments already written to fs */ }
        return written;
    }
    function onDragOverOrEnter(e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; chatEl.classList.add('tb-composer-dragover'); }
    function onDragLeave() { chatEl.classList.remove('tb-composer-dragover'); }
    async function onDrop(e) {
        e.preventDefault();
        chatEl.classList.remove('tb-composer-dragover');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        const written = await handleDroppedFiles(files);
        if (written.length) pendingAttachments.push(...written);
    }
    chatEl.addEventListener('dragover', onDragOverOrEnter);
    chatEl.addEventListener('dragenter', onDragOverOrEnter);
    chatEl.addEventListener('dragleave', onDragLeave);
    chatEl.addEventListener('drop', onDrop);

    const sync = () => { chatEl.messages = messages.slice(); persistMessages(); };

    function persistTranscriptMessage(role, text) {
        if (!transcriptStore) return;
        try { transcriptStore.createMessage(transcriptConversationId, transcriptSessionId, role, text); }
        catch (e) { console.warn('[freddie-chat] transcript createMessage failed:', e && e.message); }
    }
    // Dashboard `home` KPI + "recent sessions" table read host.pi.sessions
    // (freddie-host-surfaces.js's SQL-backed sessions/messages tables, exposed
    // over /api/sessions) — a completely separate store from transcriptStore
    // above. Nothing wrote to it before this, so /api/sessions was always
    // empty and the dashboard showed "0 sessions" even mid-conversation.
    // Lazily create the dashboard row once `host` is available (it is null
    // until the first submit()'s ensureHost() call) and append every message
    // so turn_count/updated_at stay live for the KPI and recency sort.
    let dashboardSessionEnsured = false;
    async function persistDashboardMessage(role, text) {
        if (!host || !host.pi || !host.pi.sessions) return;
        try {
            if (!dashboardSessionEnsured) {
                dashboardSessionEnsured = true;
                await host.pi.sessions.create({ id: sessionId, title: text.slice(0, 80), platform: 'thebird' });
            }
            await host.pi.sessions.append(sessionId, { role, content: text });
        } catch (e) { console.warn('[freddie-chat] dashboard session record failed:', e && e.message); }
    }
    function pushUser(text) { messages.push({ who: 'you', text, time: fmtTime(), name: 'you' }); sync(); chatEvents.emit(ChatEvent.MESSAGE_CREATED, { who: 'you', sessionId, text }); persistTranscriptMessage('user', text); persistDashboardMessage('user', text); chatBroadcast.emit('message_created', { conversationId: transcriptConversationId, who: 'you', sessionId, text }); }
    function pushFreddie(text) { messages.push({ who: 'them', text, time: fmtTime(), name: 'assistant' }); sync(); chatEvents.emit(ChatEvent.MESSAGE_CREATED, { who: 'them', sessionId, text }); persistTranscriptMessage('assistant', text); persistDashboardMessage('assistant', text); chatBroadcast.emit('message_created', { conversationId: transcriptConversationId, who: 'them', sessionId, text }); }
    // Surface the agent's tool activity as compact, readable steps. Without this
    // the thread jumps from the user's prompt straight to the final answer and
    // the (often several-second) tool loop looks like a dead pause. We pair each
    // assistant tool_call with its role:tool result and render one line per call.
    function renderToolSteps(agentMsgs, fromIndex) {
        if (!Array.isArray(agentMsgs)) return;
        const slice = agentMsgs.slice(Math.max(0, fromIndex || 0));
        // Map tool_call_id -> result text for quick pairing.
        // Map, not a plain object literal: tool_call_id originates from
        // LLM/provider output and is never sanitized. A plain {} treats keys
        // like "__proto__"/"constructor"/"prototype" as prototype-chain
        // assignments instead of normal entries, silently corrupting lookups
        // for every other id in the same render pass. Map has no such
        // special-key semantics for any string key.
        const resultById = new Map();
        for (const m of slice) {
            // Pair on a guaranteed-non-empty id: ensureToolCallId mints a stable
            // synthetic id for id-less results, matching the same guarantee applied
            // to tool_calls at parse time (lines 263/310/340). Without this an
            // undefined id coerces to the string 'undefined' and collides every
            // id-less result into one bin, cross-pairing unrelated calls.
            if (m && m.role === 'tool') resultById.set(ensureToolCallId(m.tool_call_id), typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
        }
        const summarize = (s, n) => { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) + '…' : s; };
        // Build the step lines first so we can collapse consecutive identical
        // calls (weak models loop the same failing call many times — showing
        // each is noise). Identical = same name+args+result.
        const lines = [];
        for (const m of slice) {
            if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
            for (const tc of m.tool_calls) {
                const name = tc.name || tc.function?.name || 'tool';
                let args = tc.arguments != null ? tc.arguments : tc.function?.arguments;
                if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = '[malformed JSON: ' + (e && e.message || 'invalid') + ']'; } }
                const argStr = summarize(typeof args === 'string' ? args : JSON.stringify(args || {}), 80);
                const res = resultById.get(ensureToolCallId(tc.id));
                if (res === undefined) console.warn('[freddie-chat] no tool result paired for call', tc.name, tc.id);
                let resLine = '';
                if (res !== undefined) {
                    let r = res;
                    try { const parsed = JSON.parse(res); if (parsed && typeof parsed === 'object') { r = parsed.error ? t('chat.errorPrefix', 'error: {msg}', { msg: parsed.error }) : ((parsed.ok === true && Object.keys(parsed).length === 1) ? t('chat.ok', 'ok') : summarize(res, 90)); } } catch {
                        // swallow: tool result isn't JSON — keep it as the raw string summary
                    }
                    resLine = '\n  -> ' + summarize(r, 100);
                }
                lines.push('[tool] ' + name + '(' + argStr + ')' + resLine);
            }
        }
        let any = false;
        for (let i = 0; i < lines.length; i++) {
            let count = 1;
            while (i + 1 < lines.length && lines[i + 1] === lines[i]) { count++; i++; }
            const text = count > 1 ? lines[i] + '  (x' + count + ')' : lines[i];
            messages.push({ who: 'them', text, time: fmtTime(), name: 'tool' });
            any = true;
        }
        if (any) sync();
    }

    // The gm hook_user_prompt_submit was authored for a CLI operator that walks
    // a filesystem verb-spool (.gm/exec-spool/in/<verb>/N.txt). In the browser
    // there is no spool: freddie has the gm verbs (and read/write/edit/grep/list/
    // memory/web_search) as DIRECT registered tools. Injecting the spool prose
    // verbatim makes weak models conclude they "don't have tools" and decline
    // (witnessed: kimi returned a refusal, zero tool_calls). So we rewrite any
    // spool-protocol context into a browser-native, tool-affirming directive,
    // preserving the genuinely useful part (recalled memory / phase guidance)
    // while dropping the "write to instruction/N.txt" mechanics.
    const SPOOL_TELLS = /exec-spool|instruction\/<?N>?\.txt|Invoke the gm-skill|spool-dispatch gate|dispatch the (instruction|next) verb|\.gm\/|write .* into the spool/i;
    function browserizeHookContext(text) {
        if (!text) return text;
        if (!SPOOL_TELLS.test(text)) return text; // recall packs / plain context pass through
        // Keep any lines that read as recalled facts or guidance, drop spool mechanics.
        const kept = String(text).split(/\n+/).filter(line => line.trim() && !SPOOL_TELLS.test(line));
        const native = 'You are freddie running inside thebird (a browser OS). You have these tools available RIGHT NOW and should call them directly to do the work — there is no shell or file-spool to set up. Tools: gm (verbs: recall, memorize, codesearch, fs_read, fs_write, fs_stat, fs_readdir, env_get, codeinsight_index), read, write, edit, grep, list, memory, chat, web_search. When a task needs project knowledge, call gm with verb "recall" or "codesearch"; to persist a fact call gm verb "memorize"; to read/write files use the read/write tools or gm fs_read/fs_write. Prefer making a tool call over describing what you would do.';
        return kept.length ? native + '\n\n' + kept.join('\n') : native;
    }

    async function fireUserPromptSubmitHooks(prompt) {
        const arr = (host && host.pi && host.pi.hooks && host.pi.hooks.user_prompt_submit) || [];
        const injectedContext = [];
        for (const h of arr) {
            try {
                const r = await h({ prompt });
                if (!r || typeof r !== 'object') continue;
                if (r.decision === 'block') return { blocked: true, reason: r.reason || 'blocked by hook' };
                const sysMsg = r.systemMessage || r.system_message;
                if (sysMsg) injectedContext.push(browserizeHookContext(String(sysMsg)));
                const hso = r.hookSpecificOutput;
                if (hso && hso.additionalContext) injectedContext.push(browserizeHookContext(String(hso.additionalContext)));
            } catch (e) { console.warn('[freddie-chat] user_prompt_submit hook error:', e && e.message || e); }
        }
        return { blocked: false, context: injectedContext.filter(Boolean).join('\n\n') };
    }

    // C-queue: FIFO of messages submitted while a turn is already active
    // (busy===true). Array lives in this closure alongside `busy`/`messages`
    // so it is per-chat-surface-instance, not module-global. drainQueue() is
    // called from the single place submit() already reaches on every turn
    // exit (the finally block) so a queued message is picked up whether the
    // prior turn ended in success or error — never left stranded.
    const pendingQueue = [];
    function drainQueue() {
        if (!pendingQueue.length) return;
        const next = pendingQueue.shift();
        chatEvents.emit(ChatEvent.QUEUE_ITEM_DEQUEUED, { text: next.text, remaining: pendingQueue.length });
        updateQueueIndicator();
        // Re-enter submit() with the dequeued text — reuses the exact same
        // turn-starting logic (no duplicated LLM/tool-loop code).
        submit(next.text);
    }
    // Plain text-node + className-toggle status indicator, matching the
    // existing pushFreddie-as-status-line / tb-chat-resume-btn convention
    // (no new CSS authored — thebird ships zero design CSS upstream).
    const queueIndicator = document.createElement('span');
    queueIndicator.className = 'tb-chat-queue-indicator tb-chat-queue-indicator-hidden';
    node.appendChild(queueIndicator);
    // F2: per-item cancel for queued-but-not-yet-started sends. A rapid
    // double/triple send (e.g. mashing Enter on a slow first response)
    // previously had no undo short of losing the whole session — clicking
    // the indicator now reveals the queued texts with a remove control per
    // row, backed by the same `pendingQueue` array drainQueue() already
    // consumes (removing an entry here just means drainQueue() never
    // reaches it — no separate cancel path to keep in sync).
    const queueList = document.createElement('div');
    queueList.className = 'tb-chat-queue-list tb-chat-queue-indicator-hidden';
    node.appendChild(queueList);
    function renderQueueList() {
        queueList.textContent = '';
        pendingQueue.forEach((item, i) => {
            const row = document.createElement('div');
            row.className = 'tb-chat-queue-row';
            const label = document.createElement('span');
            label.className = 'tb-chat-queue-row-text';
            label.textContent = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tb-chat-queue-row-remove';
            btn.textContent = t('chat.queueRemove', 'remove');
            btn.addEventListener('click', () => {
                const idx = pendingQueue.indexOf(item);
                if (idx !== -1) pendingQueue.splice(idx, 1);
                chatEvents.emit(ChatEvent.QUEUE_STATUS, { queued: pendingQueue.length });
                updateQueueIndicator();
            });
            row.appendChild(label);
            row.appendChild(btn);
            queueList.appendChild(row);
        });
    }
    queueIndicator.addEventListener('click', () => {
        if (!pendingQueue.length) return;
        const willShow = queueList.classList.contains('tb-chat-queue-indicator-hidden');
        if (willShow) renderQueueList();
        queueList.classList.toggle('tb-chat-queue-indicator-hidden', !willShow);
    });
    function updateQueueIndicator() {
        const n = pendingQueue.length;
        queueIndicator.textContent = n > 0 ? t('chat.queuedCount', '{n} queued', { n }) : '';
        queueIndicator.classList.toggle('tb-chat-queue-indicator-hidden', n === 0);
        if (n === 0) queueList.classList.add('tb-chat-queue-indicator-hidden');
        else if (!queueList.classList.contains('tb-chat-queue-indicator-hidden')) renderQueueList();
    }
    chatEvents.on && chatEvents.on(ChatEvent.QUEUE_STATUS, () => updateQueueIndicator());

    async function submit(text) {
        if ((!text || !text.trim()) && !pendingAttachments.length) return;
        if (!text) text = '';
        // A turn is already active/streaming for this chat surface (busy is
        // the same flag the try/finally below sets) — queue instead of
        // racing a second runAgentTurn against the same agentMessages array.
        // The chatActor's 'active' state is a structural mirror of `busy`
        // (both flip together around the same turn), so gating on `busy`
        // here is equivalent to gating on chatActor.getSnapshot().value —
        // busy is used directly because it is already the exact boolean the
        // rest of submit() depends on, avoiding a second source of truth.
        if (busy) {
            pendingQueue.push({ text, timestamp: Date.now() });
            chatEvents.emit(ChatEvent.QUEUE_STATUS, { queued: pendingQueue.length });
            updateQueueIndicator();
            return;
        }
        // Fold any files dropped since the last send into the outgoing message
        // so the agent's context (and its read tool) can find them by path.
        if (pendingAttachments.length) {
            const refs = pendingAttachments.map(p => '[attached: ' + p + ']').join(' ');
            text = text + '\n\n' + refs;
            pendingAttachments = [];
        }
        busy = true;
        pushUser(text);
        // C11: a fresh transcriptStore session marks THIS turn's lifecycle,
        // separate from the long-lived transcriptSessionId created once at
        // chat-surface-init (which only scopes createMessage calls). One
        // session per turn is what makes 'active' status meaningful for C3's
        // crash-recovery scan (a session found still 'active' on a later boot
        // is exactly a turn that was streaming when the tab died). Created
        // even if the turn ends up handled by a slash command / hook-block
        // short-circuit below, then immediately marked complete in those
        // branches -- so 'active' in storage always corresponds to real work
        // in flight, never a permanently-orphaned row for a turn that never
        // actually ran the agent loop.
        let turnSession = null;
        try { if (transcriptStore) turnSession = transcriptStore.createSession(transcriptConversationId); } catch (e) { console.warn('[freddie-chat] turn session create failed:', e && e.message); }
        // submit() owns the full ready->queued->active transition itself
        // rather than relying on every caller to have already dispatched
        // SUBMIT first (the DOM 'send' listener did; window.__debug...chat.send
        // and the C3 resume-button handler call submit() directly and must
        // not silently no-op STREAM against a machine still in 'ready').
        // SUBMIT is a harmless no-op if the caller already sent it (queued
        // has no SUBMIT handler, so a duplicate dispatch here is inert).
        chatActor.send({ type: 'SUBMIT' });
        chatActor.send({ type: 'STREAM' });
        try {
            if (!host) host = await ensureHost(instance);
            const slashOut = await dispatchSlash(host, text);
            if (slashOut && typeof slashOut === 'object' && slashOut._clear) {
                messages.length = 0; agentMessages.length = 0; pushFreddie(t('chat.cleared', '(cleared)'));
            } else if (slashOut !== null) {
                pushFreddie(String(slashOut));
            } else {
                const hookRes = await fireUserPromptSubmitHooks(text);
                if (hookRes.blocked) {
                    pushFreddie(t('chat.hookBlock', '[hook block] {reason}', { reason: hookRes.reason }));
                } else {
                    if (hookRes.context && typeof window !== 'undefined') {
                        window.__debug = window.__debug || {};
                        window.__debug.lastHookContext = hookRes.context;
                        agentMessages.push({ role: 'system', content: hookRes.context });
                        // Black-magic made visible: when gm rs-learn recalled relevant memories
                        // for this prompt, surface a compact chip in the transcript so the user
                        // SEES why freddie answered as it did (otherwise the recall is silent).
                        try {
                            const recalled = hookRes.context.split(/\n+/).filter(l => /^[-•]\s+/.test(l.trim()));
                            if (recalled.length) {
                                const preview = recalled.slice(0, 3).map(l => l.replace(/^[-•]\s+/, '').trim().slice(0, 90)).join(' · ');
                                const label = recalled.length > 1
                                    ? t('chat.recalledMemories', '[recalled {n} memories] {preview}', { n: recalled.length, preview })
                                    : t('chat.recalledMemory', '[recalled {n} memory] {preview}', { n: recalled.length, preview });
                                messages.push({ who: 'them', text: label, time: fmtTime(), name: 'memory' });
                                sync();
                            }
                        } catch (_) {
                            // swallow: recalled-memories chip rendering is cosmetic — a parse hiccup here shouldn't block the turn
                        }
                    }
                    // Snapshot the pre-turn length so we can surface only the
                    // tool steps THIS turn produced (not the whole history).
                    const preLen = agentMessages.length;
                    const out = await runAgentTurn({ host, prompt: text, messages: agentMessages });
                    if (out && Array.isArray(out.messages)) agentMessages.splice(0, agentMessages.length, ...out.messages);
                    // Make the agent's work visible: render each tool call + its
                    // result as a compact step in the thread, so the user SEES
                    // freddie searching/reading/writing instead of a silent gap
                    // followed by a final answer. Pairs assistant tool_calls with
                    // the following role:tool results by tool_call_id.
                    try { renderToolSteps(out && out.messages, preLen); } catch (e) { console.warn('[freddie-chat] tool-step render:', e && e.message); }
                    let reply;
                    if (out && out.result) reply = out.result;
                    else if (out && out.error) reply = t('chat.errorPrefix', 'error: {msg}', { msg: out.error });
                    else {
                        // No result, no error — agent loop produced no text. Common when
                        // the model returns empty content+no tool_calls because it saw
                        // the tools list but couldn't decide what to do. Surface an
                        // actionable hint instead of a blank "(no response)".
                        const toolsFired = Array.isArray(out?.messages) && out.messages.some(m => m.role === 'tool');
                        reply = toolsFired
                            ? t('chat.toolsRanNoText', 'tools ran but the model returned no final text — try asking for a summary.')
                            : t('chat.noTextNoToolCall', 'the model returned no text and no tool call. try a more specific prompt, e.g. "use the memory tool to save: ..." or "use web_search to find ..."');
                    }
                    pushFreddie(reply);
                    // Auto-detect: if this turn's tool_calls included any `write`,
                    // install any declared npm dependency and execute the agent's
                    // RUN:/FILE: command for real, then read the file(s) back to
                    // prove they exist — the same rigor the standalone autocode
                    // app used to provide, now automatic for any chat turn that
                    // writes files (no separate mode). A turn that wrote nothing
                    // is a no-op (runInstallExecuteVerify returns null).
                    try {
                        const runSummary = await runInstallExecuteVerify({ instance, agentMsgs: out && out.messages, replyText: reply });
                        if (runSummary) pushFreddie(runSummary);
                    } catch (e) { console.warn('[freddie-chat] install/run/verify:', e && e.message); }
                }
            }
            // Successful turn: clear the persisted draft (composer textarea is
            // already cleared by the element on 'send').
            chatActor.send({ type: 'DONE', messages: messages.slice() });
            chatEvents.emit(ChatEvent.STREAMING_COMPLETE, { sessionId });
            chatBroadcast.emit('streaming_complete', { conversationId: transcriptConversationId, sessionId });
            if (turnSession && transcriptStore) { try { transcriptStore.updateSessionStatus(turnSession.id, 'complete'); } catch (e) { console.warn('[freddie-chat] session status->complete failed:', e && e.message); } }
        } catch (e) {
            pushFreddie(t('chat.errorPrefix', 'error: {msg}', { msg: (e?.message || String(e)) }));
            chatActor.send({ type: 'ERROR' });
            chatEvents.emit(ChatEvent.STREAMING_ERROR, { sessionId, error: (e && e.message) || String(e) });
            chatBroadcast.emit('streaming_error', { conversationId: transcriptConversationId, sessionId, error: (e && e.message) || String(e) });
            if (turnSession && transcriptStore) { try { transcriptStore.updateSessionStatus(turnSession.id, 'error'); } catch (e2) { console.warn('[freddie-chat] session status->error failed:', e2 && e2.message); } }
        } finally {
            busy = false;
            // Drain after `busy` flips false so the dequeued re-entrant
            // submit() call sees the guard open, not itself re-queued.
            drainQueue();
        }
    }

    const RESUME_WINDOW_MS = 10 * 60 * 1000;
    // C3: scan transcriptStore for sessions this chat surface's fs left
    // 'active' from a previous page load, and either offer to resume them
    // (recent) or silently mark them 'error' (stale) so they stop looking
    // like a turn is perpetually in flight. Runs once at boot, after `submit`
    // and `pushFreddie` exist (called from the ensureHost().then() block
    // below, once the host + transcriptStore are both live).
    function recoverInterruptedSessions() {
        if (!transcriptStore) return;
        const now = Date.now();
        let active;
        try { active = transcriptStore.getActiveSessions(); } catch (e) { console.warn('[freddie-chat] getActiveSessions failed:', e && e.message); return; }
        for (const s of active) {
            if (!s || !s.id) continue;
            const age = now - (Number(s.startedAt) || 0);
            if (age < RESUME_WINDOW_MS) {
                try { transcriptStore.updateSessionStatus(s.id, 'interrupted'); } catch (e) { console.warn('[freddie-chat] mark interrupted failed:', e && e.message); }
                renderResumeAffordance(s);
            } else {
                try { transcriptStore.updateSessionStatus(s.id, 'error'); } catch (e) { console.warn('[freddie-chat] mark stale-active->error failed:', e && e.message); }
            }
        }
    }

    // Reuses the same pushFreddie-style status-line convention every other
    // system message in this thread uses (no new visual/DOM machinery), plus
    // a plain className-only <button> appended directly under the composer
    // wrap -- the same functional-button pattern already used elsewhere in
    // docs/*.js (e.g. freddie-keys.js's retryBtn), not a new visual surface.
    // BUG FIX (stale stuck message): the original handler removed the button
    // on click but never called transcriptStore.updateSessionStatus(session.id,
    // ...) in ANY branch (resume-succeeded, resume-found-nothing-to-resend, or
    // resume-threw). That left the underlying session row permanently stuck at
    // status:'interrupted' in storage — harmless to getActiveSessions() (which
    // only re-surfaces status==='active' rows) but meant the row was never
    // actually marked resolved, and gave a real resume failure no distinct,
    // terminal outcome the user could see. Every exit path below now resolves
    // the session to 'complete' (genuinely resumed) or 'error' (couldn't/
    // didn't resume), wrapped in try/catch/finally so a thrown error from
    // getMessages()/submit() can never leave the affordance stuck mid-click —
    // and a plain "discard" button gives the user an explicit way to clear the
    // message when they don't want to (or can't) resume it.
    function renderResumeAffordance(session) {
        pushFreddie(t('chat.turnInterruptedResume', '[interrupted] a turn from a previous session ({when}) did not finish (tab closed/refreshed/crashed mid-stream). Click resume to re-send the last message, or discard to clear this notice.', { when: new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
        const wrap = document.createElement('span');
        wrap.className = 'tb-chat-resume-wrap';
        const btn = document.createElement('button');
        btn.textContent = t('chat.resumeButton', 'resume interrupted turn');
        btn.className = 'tb-chat-resume-btn';
        const discardBtn = document.createElement('button');
        discardBtn.textContent = t('chat.discardButton', 'discard');
        discardBtn.className = 'tb-chat-discard-btn';
        const resolveSession = (status) => {
            if (!transcriptStore) return;
            try { transcriptStore.updateSessionStatus(session.id, status); }
            catch (e) { console.warn('[freddie-chat] resume-affordance session status->' + status + ' failed:', e && e.message); }
        };
        btn.onclick = async () => {
            btn.disabled = true;
            discardBtn.disabled = true;
            let lastUser = null;
            let outcome = 'error';
            try {
                let msgs = [];
                try { msgs = transcriptStore.getMessages(transcriptConversationId) || []; }
                catch (e) { console.warn('[freddie-chat] resume getMessages failed:', e && e.message); }
                for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i] && msgs[i].role === 'user') { lastUser = msgs[i]; break; } }
                if (!lastUser || !lastUser.text) {
                    pushFreddie(t('chat.resumeNoMessage', 'could not find the interrupted message to resume — nothing sent. Marking this notice resolved.'));
                    return;
                }
                chatActor.send({ type: 'SUBMIT' });
                await submit(lastUser.text);
                // submit() owns its own turnSession lifecycle (a fresh session,
                // separate from `session` here) and never throws past its own
                // try/catch — reaching this line means the resend was actually
                // dispatched, so the ORIGINAL interrupted-session row this
                // affordance was for is now genuinely superseded.
                outcome = 'complete';
            } catch (e) {
                console.warn('[freddie-chat] resume-interrupted-turn click failed:', e && e.message);
                pushFreddie(t('chat.resumeFailed', 'resume failed: {msg}. Marking this notice resolved — you can resend manually.', { msg: (e && e.message) || String(e) }));
            } finally {
                wrap.remove();
                resolveSession(outcome);
            }
        };
        discardBtn.onclick = () => {
            wrap.remove();
            resolveSession('error');
            pushFreddie(t('chat.resumeDiscarded', '[discarded] the interrupted-turn notice was cleared without resending.'));
        };
        wrap.append(btn, discardBtn);
        node.appendChild(wrap);
    }

    chatEl.addEventListener('send', (e) => {
        chatActor.send({ type: 'SUBMIT' });
        submit(e.detail && e.detail.text);
    });

    // Seed restored transcript + unsent draft. The element renders its composer
    // lazily, so set messages now and (re)apply the draft once the textarea exists.
    if (messages.length) chatEl.messages = messages.slice();
    const applyDraft = () => {
        const draft = (chatActor.getSnapshot().context.draft) || '';
        const ta = chatEl.querySelector('.chat-composer textarea');
        if (ta && draft && !ta.value) {
            ta.value = draft;
            chatEl._composerValue = draft;
            if (chatEl._syncSendButton) try { chatEl._syncSendButton(); } catch {
                // swallow: composer send-button sync is cosmetic — a DOM timing hiccup here is non-fatal
            }
        }
        // Persist the live composer text as the user types (debounced).
        if (ta && !ta._draftBound) {
            ta._draftBound = true;
            ta.addEventListener('input', () => persistDraft(ta.value));
        }
    };
    applyDraft();
    setTimeout(applyDraft, 0);
    setTimeout(applyDraft, 300);

    ensureHost(instance).then(h => {
        host = h;
        chatActor.send({ type: 'READY' });
        // Runtime ready — flip the composer out of the booting state.
        chatEl.setAttribute('sub', t('chat.readySub', 'agentic chat — agent runtime in-page · /help'));
        chatEl.setAttribute('placeholder', t('chat.readyPlaceholder', 'message assistant · /tools · /tool name {json} · /run …'));
        if (cfgUI) try { cfgUI.refresh(); } catch {
            // swallow: config-strip refresh is cosmetic UI sync — a failure here doesn't affect chat readiness
        }
        pushFreddie(t('chat.assistantOnline', 'assistant online (agent runtime in-page) for {id}. tools: {tools}', { id: instance.id, tools: [...h.pi.tools.keys()].sort().join(' ') }));
        // C3: crash/refresh recovery. Any transcriptStore session still
        // 'active' at this point in a FRESH boot was left that way by a prior
        // page load that never reached DONE/ERROR (tab closed/refreshed/
        // crashed mid-turn -- this boot's own turns haven't started yet, so
        // nothing here is from the current load). Sessions within the
        // 10-minute resume window get an 'interrupted' status + a resumable
        // affordance; older ones are silently swept to 'error' so they don't
        // sit as permanently-active zombies.
        try { recoverInterruptedSessions(); } catch (e) { console.warn('[freddie-chat] crash-recovery scan failed:', e && e.message); }
        // Real mid-turn resumability (distinct from the transcript-level
        // affordance above, which just re-sends the last user message from
        // scratch): if the IndexedDB agent-turn snapshot store has a live
        // (status==='active') snapshot for THIS instance, a prior turn was
        // interrupted mid-tool-call/mid-LLM-call (tab closed/refreshed/
        // crashed) with real in-flight progress journaled. Attempt to resume
        // it via runAgentTurn({resume:true}) — createPersistentActor's own
        // rehydration (via the SAME kind/key) picks the actor back up from
        // its persisted snapshot inside runAgentTurn, so no prompt/messages
        // need to be re-sent here. Best-effort: a resume failure degrades to
        // "left as-is" (the transcript-level affordance above still offers a
        // manual resend), never blocks the rest of boot.
        (async () => {
            // Claim `busy` synchronously BEFORE the await below so a submit()
            // call racing this IIFE during the hasResumableTurn() IDB read
            // sees busy===true and queues instead of starting a second
            // concurrent runAgentTurn against the same agentMessages array
            // (see resume-vs-submit-busy-race). If it turns out there was
            // nothing to resume, release the claim immediately and drain
            // anything that queued behind it in the meantime.
            if (busy) return;
            busy = true;
            try {
                if (!(await hasResumableTurn(h))) { busy = false; drainQueue(); return; }
                pushFreddie(t('chat.resumingInterruptedTurn', '[resuming] a prior turn was interrupted mid-flight (tab closed/refreshed). Picking up where it left off…'));
                chatActor.send({ type: 'SUBMIT' });
                chatActor.send({ type: 'STREAM' });
                const preLen = agentMessages.length;
                const out = await runAgentTurn({ host: h, prompt: '', messages: agentMessages, resume: true });
                if (out && Array.isArray(out.messages)) agentMessages.splice(0, agentMessages.length, ...out.messages);
                try { renderToolSteps(agentMessages, preLen); } catch { /* render is best-effort; transcript state is already updated */ }
                if (out && out.result) pushFreddie(out.result);
                else if (out && out.error) pushFreddie(t('chat.errorPrefix', 'error: {msg}', { msg: out.error }));
                chatActor.send({ type: 'DONE', messages: messages.slice() });
            } catch (e) {
                console.warn('[freddie-chat] resume-interrupted-turn failed:', e && e.message);
                try { chatActor.send({ type: 'ERROR' }); } catch { /* actor may already be stopped; the failure is already logged just above */ }
            } finally {
                busy = false;
            }
        })();
        if (typeof window !== 'undefined') {
            globalThis.__freddieRuntimeBridge = { host: h, callLLM: buildBrowserCallLLM(h) };
            const probe = createAgentMachine({ maxIterations: 1 });
            const probeActor = createActor(probe, { input: { messages: [] } });
            probeActor.start();
            exposeRuntime({ machine: probe, actor: probeActor, run: (prompt) => submit(prompt) });
            // Bridge thebird's tools into the vendored agent host as soon as the
            // host is up, and AGAIN when the gm tool finishes registering (it
            // appears only after the 149MB wasm cold-load). This makes even the
            // first user turn flawless — gm is in the agent registry before the
            // user can realistically send a message, instead of being missed on
            // turn 1 and self-healing on turn 2.
            bridgeAgentTools(h);
            window.addEventListener('freddie:gm-ready', () => { bridgeAgentTools(h); }, { once: true });
        }
    }).catch(e => {
        chatActor.send({ type: 'ERROR' });
        pushFreddie(t('chat.hostBootFailed', 'host boot failed: {msg}', { msg: e.message }));
    });

    // The 149MB gm/plugkit wasm loads after bootHost() returns (fire-and-forget),
    // so a fetch failure surfaces here, not in the ensureHost chain. Drop the
    // "booting runtime…" state and tell the user the engine could not download
    // instead of leaving a hung-looking loader.
    if (typeof window !== 'undefined') {
        window.addEventListener('freddie:gm-error', (e) => {
            const err = (e && e.detail && e.detail.error) || t('chat.unknownError', 'unknown error');
            chatEl.setAttribute('sub', t('chat.engineFailedSub', 'runtime engine failed to download — check connection / reload'));
            pushFreddie(t('chat.engineFailedMsg', 'freddie engine (plugkit wasm) failed to download: {err}. Tools that need the engine are unavailable until it loads; reload to retry.', { err }));
        }, { once: true });
    }

    // gm-skill's wasm chain (plugkit fetch -> bert ~136MB -> libsql -> wasi ->
    // ready) runs fire-and-forget after ensureHost() already resolved and
    // flipped the composer to "ready" above -- so without this, the chat looks
    // fully live for the 1-3 minutes the ~136MB bert embedder is still
    // downloading, and any gm-dependent tool call in that window just hangs
    // with no visible reason. loadGmSkillPlugin (freddie-host-plugkit.js)
    // writes globalThis.__GM_BOOT_STAGE__ at each real stage transition
    // (plugkit-fetch -> bert-await -> bert-ready/bert-failed ->
    // libsql-ready/libsql-failed -> ready/degraded/error); poll it and mirror
    // the live stage + elapsed time into the sub line instead of a static
    // string, so the user sees which artifact is in flight and stops the
    // moment a terminal stage lands.
    if (typeof window !== 'undefined') {
        const STAGE_LABELS = {
            'plugkit-fetch': 'downloading engine (plugkit)…',
            'bert-await': 'downloading embedder model (~136MB, bert)…',
            'bert-ready': 'embedder ready — loading memory store (libsql)…',
            'bert-failed': 'embedder unavailable (bm25 search only) — loading memory store (libsql)…',
            'libsql-ready': 'finalizing runtime (wasi)…',
            'libsql-failed': 'finalizing runtime (wasi) — memory persistence unavailable…',
        };
        const gmBootStart = Date.now();
        const gmBootPoll = setInterval(() => {
            const st = globalThis.__GM_BOOT_STAGE__;
            if (!st || !st.stage) return;
            if (st.stage === 'ready' || st.stage === 'degraded' || st.stage === 'error') { clearInterval(gmBootPoll); return; }
            const label = STAGE_LABELS[st.stage] || st.stage;
            const secs = Math.round((Date.now() - gmBootStart) / 1000);
            chatEl.setAttribute('sub', t('chat.gmBootProgress', 'runtime ready · loading gm engine — {label} ({secs}s)', { label, secs }));
        }, 1000);
        window.addEventListener('freddie:gm-ready', () => {
            clearInterval(gmBootPoll);
            chatEl.setAttribute('sub', t('chat.readySub', 'agentic chat — agent runtime in-page · /help'));
        }, { once: true });
        window.addEventListener('freddie:gm-degraded', () => clearInterval(gmBootPoll), { once: true });
        window.addEventListener('freddie:gm-error', () => clearInterval(gmBootPoll), { once: true });
    }

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[instance.id] = window.__debug.instances[instance.id] || {};
        window.__debug.instances[instance.id].chat = {
            root: node,
            get chatEl() { return chatEl; },
            get config() { return cfgUI; },
            get thread() { return chatEl.querySelector('.chat-thread'); },
            send: submit,
            get messages() { return messages; },
            get agentMessages() { return agentMessages; },
            get host() { return host; },
            get runtime() { return _runtimeHandle; },
            get chatMachine() { return chatMachine; },
            get chatActor() { return chatActor; },
            get chatSnapshot() { return chatActor.getSnapshot(); },
        };
    }
    return { node, dispose: () => { try { chatActor.stop(); } catch {
        // swallow: actor may already be stopped — dispose is idempotent teardown
    } try { chatBroadcast.close(); } catch {
        // swallow: broadcast channel may already be closed — dispose is idempotent teardown
    } messages.length = 0; agentMessages.length = 0; } };
}
