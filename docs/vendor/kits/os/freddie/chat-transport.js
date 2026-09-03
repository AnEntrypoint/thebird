// The three send strategies the dashboard chat falls through, and the
// provider discovery that decides which are viable. All return (or synthesize)
// the same `{event, data}` list the server SSE path produces, so the render
// loop that consumes them is identical regardless of which path ran.

import { parseSseEvents } from './chat-protocol.js';

// Static deploy (no freddie-server, so /api/providers 404s): probe the
// acptoapi gateway directly and, when it answers, surface it as a real
// configured provider with its model list. Without this the dashboard
// tells the user to "run a gateway" even though one is live and chat works.
export async function loadProviders() {
    let providers = await fetch('/api/providers').then(r => r.json()).catch(() => []);
    if (!Array.isArray(providers)) providers = [];
    if (!providers.some(p => p.configured)) {
        try {
            const cfg = (window.__debug?.instances?.i1?.host?.fs?.readJson?.('/etc/freddie/freddie.json', null)) || {};
            const baseUrl = (cfg?.providers?.openai?.baseUrl || 'http://localhost:4800').replace(/\/+$/, '');
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 4000);
            const r = await fetch(baseUrl + '/v1/models', { signal: ac.signal }).catch(() => null);
            clearTimeout(t);
            if (r && r.ok) {
                const j = await r.json().catch(() => null);
                const models = Array.isArray(j?.data) ? j.data.map(m => m.id) : [];
                providers = [{ id: 'acptoapi', name: 'acptoapi gateway (' + baseUrl + ')', configured: true, models: ['auto', ...models] }, ...providers];
            }
        } catch { /* swallow: probing the local acptoapi gateway is opt-in best-effort, absence just means no providers shown */ }
    }
    return providers;
}

// Static deploy with an in-page agent runtime (e.g. thebird): drive
// the REAL multi-step agent loop (host tools + acptoapi gateway +
// tool execution) instead of a single bare completion, so the model
// emits tool_calls, the loop executes them, feeds results back, and
// iterates. We synthesize the same {event:'message'} stream the
// server path produces so the render loop is unchanged. The
// window global is the opt-in: hosts without it keep single-shot.
async function runInPageAgent(trimmed, chatState, renderPage) {
    const events = [];
    try {
        let stepN = 0;
        const onUpdate = (snap) => {
            try {
                const msgs = (snap && snap.context && snap.context.messages) || [];
                const toolMsgs = msgs.filter(m => m.role === 'tool');
                const lastAssist = [...msgs].reverse().find(m => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length);
                const running = lastAssist && lastAssist.tool_calls[0] && (lastAssist.tool_calls[0].function?.name || lastAssist.tool_calls[0].name);
                stepN = toolMsgs.length;
                chatState.progress = running
                    ? ('agent: ' + running + ' (step ' + (stepN + 1) + ')…')
                    : ('agent thinking' + (stepN ? ' (step ' + stepN + ')' : '') + '…');
                renderPage();
            } catch { /* swallow: progress-indicator update failing must not abort the agent run */ }
        };
        const out = await window.__thebirdRunAgent({ prompt: trimmed, onUpdate });
        const turnMsgs = (out && Array.isArray(out.messages)) ? out.messages : [];
        for (const m of turnMsgs) {
            if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
                const parts = [];
                if (m.content) parts.push({ type: 'text', text: String(m.content) });
                for (const tc of m.tool_calls) {
                    const rawArgs = tc.function?.arguments ?? tc.arguments;
                    let input = {};
                    if (rawArgs && typeof rawArgs === 'object') input = rawArgs;
                    else if (typeof rawArgs === 'string') { try { input = JSON.parse(rawArgs || '{}'); } catch { input = {}; } }
                    parts.push({ type: 'tool_use', name: tc.function?.name || tc.name, input });
                }
                events.push({ event: 'message', data: { role: 'assistant', content: parts } });
            } else if (m.role === 'tool') {
                events.push({ event: 'message', data: { role: 'tool', content: [{ content: String(m.content ?? '') }] } });
            }
        }
        const finalText = (out && out.result) || (out && out.error ? 'error: ' + out.error : '');
        if (finalText) events.push({ event: 'message', data: { role: 'assistant', content: [{ type: 'text', text: String(finalText) }] } });
        if (!events.length) events.push({ event: 'message', data: { role: 'assistant', content: [{ type: 'text', text: '' }] } });
        return events;
    } catch (e) {
        return [{ event: 'error', data: { error: e?.message || String(e) } }];
    }
}

// Static deploy without an in-page agent runtime: single direct
// acptoapi /v1/chat/completions call (no tool loop — one shot).
async function runDirectCompletion(trimmed, chatState) {
    const cfg = (window.__debug?.instances?.i1?.host?.fs?.readJson?.('/etc/freddie/freddie.json', null)) || {};
    const baseUrl = cfg?.providers?.openai?.baseUrl || 'http://localhost:4800';
    try {
        const url = baseUrl.replace(/\/+$/, '') + '/v1/chat/completions';
        const reqBody = { model: chatState.model || cfg?.providers?.openai?.model || 'auto', messages: [{ role: 'user', content: trimmed }] };
        const r2 = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reqBody), signal: chatState.abort.signal });
        if (!r2.ok) {
            const errText = await r2.text().catch(() => '');
            return [{ event: 'error', data: { error: 'acptoapi ' + r2.status + ': ' + errText.slice(0, 200) } }];
        }
        const j = await r2.json();
        const content = j?.choices?.[0]?.message?.content || '';
        const tool_calls = j?.choices?.[0]?.message?.tool_calls;
        const parts = [];
        if (content) parts.push({ type: 'text', text: content });
        if (Array.isArray(tool_calls)) {
            for (const tc of tool_calls) parts.push({ type: 'tool_use', name: tc.function?.name, input: (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })() });
        }
        return [{ event: 'message', data: { role: 'assistant', content: parts.length ? parts : [{ type: 'text', text: '' }] } }];
    } catch (e) {
        return [{ event: 'error', data: { error: e?.message || String(e) } }];
    }
}

// Try the real server SSE endpoint first; fall back to the in-page agent
// runtime, then to a single direct gateway completion.
export async function fetchChatEvents(trimmed, chatState, renderPage) {
    const body = { prompt: trimmed, cwd: chatState.cwd || undefined, skill: chatState.skill || undefined, provider: chatState.provider || undefined, model: chatState.model || undefined, sessionId: chatState.sessionId || undefined };
    let resp;
    try {
        resp = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: chatState.abort.signal });
    } catch (fetchErr) {
        resp = null;
    }
    if (resp && resp.ok) {
        const text = await resp.text();
        return parseSseEvents(text);
    }
    if (typeof window !== 'undefined' && typeof window.__thebirdRunAgent === 'function') {
        return runInPageAgent(trimmed, chatState, renderPage);
    }
    return runDirectCompletion(trimmed, chatState);
}

// Fold the event list into chatState.messages, resolving running tool calls to
// done/error and accumulating assistant prose. Returns the trailing assistant
// text the caller appends once the stream is fully drained.
export function applyChatEvents(events, chatState, syncMessages) {
    let assistantContent = '';
    for (const { event, data } of events) {
        if (event === 'start' && data.sessionId) chatState.sessionId = data.sessionId;
        if (event === 'done' && data.sessionId) chatState.sessionId = data.sessionId;
        if (event === 'message') {
            const role = data.role;
            if (role === 'assistant') {
                const content = Array.isArray(data.content) ? data.content : [{ type: 'text', text: String(data.content || '') }];
                for (const block of content) {
                    if (block.type === 'text') assistantContent += block.text;
                    if (block.type === 'tool_use') {
                        if (assistantContent) { chatState.messages.push({ role: 'assistant', content: assistantContent }); assistantContent = ''; }
                        const argsSummary = JSON.stringify(block.input || {}).slice(0, 60);
                        chatState.messages.push({ role: 'tool', name: block.name, argsSummary, content: JSON.stringify(block.input || {}, null, 2), status: 'running' });
                        syncMessages();
                    }
                }
            } else if (role === 'tool') {
                const tc = Array.isArray(data.content) ? data.content[0] : data;
                // Resolve the last running tool call to done with this result.
                for (let i = chatState.messages.length - 1; i >= 0; i--) {
                    const m = chatState.messages[i];
                    if (m.role === 'tool' && m.status === 'running') {
                        m.content = String(tc?.content || tc?.text || JSON.stringify(tc));
                        m.status = 'done';
                        break;
                    }
                }
                syncMessages();
            }
        }
        if (event === 'done' && data.result) { if (!assistantContent) assistantContent = data.result; }
        if (event === 'error') {
            const msg = 'error: ' + (data.error || 'unknown');
            // Mark any running tool as errored; record assistant error.
            for (let i = chatState.messages.length - 1; i >= 0; i--) {
                const m = chatState.messages[i];
                if (m.role === 'tool' && m.status === 'running') { m.status = 'error'; m.error = true; m.content = msg; break; }
            }
            if (!assistantContent) assistantContent = msg;
        }
    }
    return assistantContent;
}
