// Freddie conversational pages: the `chat` agent-workspace page (WebSocket
// over the freddie wire protocol — replay + live turn events + prompt/steer/
// cancel/approve, no more 120s POST ceiling) and the `voice` backend probe.
//
// Transport: WS /api/agent/stream?sessionId=<id> (plugins/gui/gui-agent).
// The page owns the session id (generated client-side so the socket can
// subscribe BEFORE the first prompt) and rebuilds its transcript from the
// server's wire log on (re)connect, so a refresh mid-turn loses nothing.
// The legacy POST /api/chat path remains only for the offline outbox flush.
//
// Event -> transcript mapping (freddie wire envelope {v,event,sessionId,ts,data}):
//   message.append(user|assistant)  -> thread messages
//   tool.start / tool.end           -> interleaved tool cards (running -> done/error)
//   approval.request / .resolved    -> ApprovalNode cards (approve/always/reject)
//   steer.append                    -> user message (mid-turn injection)
//   session.error                   -> error pinned to the live assistant turn

import * as webjsx from '../../../vendor/webjsx/index.js';
import { makePage, api, loadingState, emptyState } from './runtime.js';
import { Table, PageHeader, Select } from '../content.js';
import { Chip } from '../shell.js';
import { formatTime } from '../../locale.js';
import { queueMessage, watchReconnect, isOnline } from '../../idb-outbox.js';
import { AgentChat } from '../agent-chat.js';
import { section, noteAlert } from './shared.js';

const h = webjsx.createElement;

function newSessionId() {
    return (crypto.randomUUID ? crypto.randomUUID() : 's' + Date.now().toString(36) + Math.random().toString(16).slice(2));
}

// Apply one wire envelope to a messages array (shared by replay rebuild and
// the live stream). `sendApprove` is only needed for live approval cards.
function applyEnvelope(msgs, env, sendApprove) {
    const { event, data } = env;
    const ts = new Date(env.ts).getTime();
    const lastAssistant = () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return msgs[i]; return null; };
    // The page echoes its own sends into the thread optimistically; the server
    // then emits the SAME user/steer text as an authoritative event. The local
    // echo is followed by the placeholder assistant bubble, so scan back past
    // it (and any parts) for a matching user message before appending a dupe.
    const isDupUser = (text) => {
        for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 3; i--) {
            if (msgs[i].role === 'user' && msgs[i].content === (text || '')) return true;
        }
        return false;
    };
    if (event === 'message.append') {
        if (data.role === 'user') { if (!isDupUser(data.content)) msgs.push({ id: 'u' + msgs.length + env.ts, role: 'user', content: data.content || '', time: formatTime(ts) }); }
        else if (data.role === 'assistant') {
            const last = msgs[msgs.length - 1];
            // A new assistant turn starts after a user message; consecutive
            // assistant appends within one turn update the SAME bubble.
            if (last && last.role === 'assistant' && last._live) { if (data.content) last.content = data.content; }
            else msgs.push({ id: 'a' + msgs.length + env.ts, role: 'assistant', content: data.content || '', parts: [], time: formatTime(ts), _live: true });
        }
    } else if (event === 'steer.append') {
        if (!isDupUser(data.text)) msgs.push({ id: 'u' + msgs.length + env.ts, role: 'user', content: data.text || '', time: formatTime(ts) });
    } else if (event === 'queue.append') {
        if (!isDupUser(data.text)) msgs.push({ id: 'u' + msgs.length + env.ts, role: 'user', content: data.text || '', time: formatTime(ts) });
    } else if (event === 'assistant.delta') {
        // Progressive text mid-turn: accumulate into the live bubble; the
        // settled message.append at turn end overwrites with the authoritative
        // full content, so a dropped delta never corrupts the transcript.
        const a = lastAssistant(); if (a && a._live) a.content = (a.content || '') + (data.text || '');
    } else if (event === 'tool.start') {
        const a = lastAssistant(); if (a) (a.parts || (a.parts = [])).push({ kind: 'tool', name: data.name || 'tool', args: data.args || {}, status: 'running', _tcid: data.toolCallId });
    } else if (event === 'tool.end') {
        const a = lastAssistant(); if (a) {
            const p = (a.parts || []).find(p => p.kind === 'tool' && p._tcid === data.toolCallId);
            if (p) {
                p.status = data.denied ? 'error' : 'done';
                p.result = data.denied ? 'denied by user' : (typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? '', null, 2));
                if (data.denied) p.error = true;
            }
        }
    } else if (event === 'approval.request') {
        const a = lastAssistant(); if (a) (a.parts || (a.parts = [])).push({ kind: 'approval', id: data.id, name: data.name, args: data.args || {}, status: 'pending', onResolve: sendApprove ? (d) => sendApprove(data.id, d) : null });
    } else if (event === 'approval.resolved') {
        const a = lastAssistant(); if (a) {
            const p = (a.parts || []).find(p => p.kind === 'approval' && p.id === data.id);
            if (p) { p.status = data.approved ? 'approved' : 'rejected'; p.always = !!data.always; }
        }
    }
}

export const chat = makePage((ctx) => {
    Object.assign(ctx.state, { loading: false, messages: [], draft: '', busy: false, error: null, sessionId: null, ws: null, conn: 'closed', sessions: [], staged: [] });
    let unmounted = false;

    // Session picker (kimi web's sessions sidebar, compact form): recent
    // conversations from /api/sessions, needsInput badges included. Picking
    // one reconnects the WS under that id and rebuilds from server replay.
    api('/api/sessions').then(rows => { ctx.state.sessions = Array.isArray(rows) ? rows : []; ctx.rerender(); }).catch(() => { /* swallow: picker degrades to new-chat-only */ });

    // File upload (kimi web parity): files are staged to disk via the gui-agent
    // endpoint and ride the next prompt frame as path references — the agent
    // reads them with its file tools, so no model-capability negotiation here.
    async function attachFiles(fileList) {
        const st = ctx.state;
        if (!st.sessionId) st.sessionId = newSessionId();
        for (const file of fileList || []) {
            try {
                const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
                const base64 = String(dataUrl).split(',')[1] || '';
                const r = await api('/api/sessions/' + encodeURIComponent(st.sessionId) + '/files', { method: 'POST', body: { name: file.name, contentBase64: base64 } });
                if (r && r.path) { st.staged = [...st.staged, { name: r.name || file.name, path: r.path }]; }
            } catch (e) { ctx.set({ error: 'upload failed: ' + (e && e.message || e) }); }
        }
        ctx.rerender();
    }

    function switchSession(id) {
        const st = ctx.state;
        if (!id || id === st.sessionId) return;
        try { st.ws && st.ws.close(); } catch { /* already closed */ }
        ctx.set({ sessionId: id, messages: [], ws: null, conn: 'closed', busy: false, error: null });
        ensureWs();
    }

    // Offline outbox: a prompt sent while genuinely offline queues to
    // IndexedDB and auto-flushes on the real 'online' event via the legacy
    // single-shot POST path (no live UI to stream into for a message sent
    // while this page may not even be mounted).
    async function sendQueuedToServer(body) {
        const r = await api('/api/chat', { method: 'POST', body });
        const reply = r.result || r.content || r.message || (r.messages && r.messages.at(-1)?.content) || JSON.stringify(r);
        ctx.state.messages.push({ id: 'a' + Date.now(), role: 'assistant', content: String(reply), time: formatTime(Date.now()) });
        ctx.rerender();
    }
    watchReconnect('chat', sendQueuedToServer);
    ctx.onCleanup(() => {
        unmounted = true;
        try { ctx.state.ws && ctx.state.ws.close(); } catch { /* already closed */ }
    });

    const s = () => ctx.state;
    const cur = () => s().messages[s().messages.length - 1];

    function sendFrame(obj) {
        const ws = s().ws;
        if (!ws) return false;
        if (ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
        if (ws.readyState === 0) { ws.addEventListener('open', () => ws.send(JSON.stringify(obj)), { once: true }); return true; }
        return false;
    }

    function ensureWs() {
        if (unmounted) return null;
        const st = s();
        if (!st.sessionId) st.sessionId = newSessionId();
        if (st.ws && (st.ws.readyState === 1 || st.ws.readyState === 0)) return st.ws;
        try {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            const ws = new WebSocket(proto + '://' + location.host + '/api/agent/stream?sessionId=' + encodeURIComponent(st.sessionId));
            st.ws = ws;
            ws.onopen = () => { st.conn = 'open'; ctx.rerender(); };
            ws.onmessage = (e) => {
                let f; try { f = JSON.parse(e.data); } catch { return; }
                if (f.type === 'replay') {
                    // Rebuild from the server's wire log only when the local
                    // thread is empty (first mount / refresh), never clobber a
                    // live thread with a reconnect's replay.
                    if (!st.messages.length && f.events && f.events.length) {
                        const msgs = [];
                        for (const env of f.events) applyEnvelope(msgs, env, null);
                        // Settled replay: turns are complete, drop the _live marker.
                        for (const m of msgs) delete m._live;
                        st.messages = msgs;
                    }
                    ctx.rerender();
                } else if (f.type === 'event') {
                    applyEnvelope(st.messages, f, (id, d) => sendFrame({ type: 'approve', id, approved: d.approved, always: !!d.always }));
                    ctx.rerender();
                } else if (f.type === 'prompt.done') {
                    const c = cur();
                    if (c && c.role === 'assistant') {
                        delete c._live;
                        if (f.error && !c.error) c.error = f.error;
                    }
                    ctx.set({ busy: false });
                    // New turns can create/rename sessions — refresh the picker.
                    api('/api/sessions').then(rows => { ctx.state.sessions = Array.isArray(rows) ? rows : []; ctx.rerender(); }).catch(() => { /* swallow: picker refresh is best-effort */ });
                } else if (f.type === 'error') {
                    const c = cur();
                    if (c && c.role === 'assistant') c.error = f.error;
                    ctx.set({ busy: false });
                }
            };
            ws.onclose = () => {
                st.conn = 'closed';
                if (st.busy) {
                    const c = cur();
                    if (c && c.role === 'assistant') { delete c._live; c.incomplete = true; }
                    ctx.set({ busy: false });
                }
                ctx.rerender();
            };
            ws.onerror = () => { st.conn = 'closed'; };
            return ws;
        } catch { return null; }
    }

    async function send(text) {
        const t = (typeof text === 'string' ? text : s().draft || '').trim();
        if (!t) return;

        // Mid-turn send = QUEUE for after the turn (kimi 1.31's Enter channel);
        // injection mid-turn is /steer in the REPL or a wire steer frame.
        if (s().busy) {
            if (sendFrame({ type: 'queue', text: t })) {
                s().messages = [...s().messages, { id: 'u' + Date.now(), role: 'user', content: t, time: formatTime(Date.now()) }];
                ctx.set({ draft: '' });
            }
            return;
        }

        const userMsg = { id: 'u' + Date.now(), role: 'user', content: t, time: formatTime(Date.now()) };
        const curMsg = { id: 'a' + (Date.now() + 1), role: 'assistant', content: '', time: formatTime(Date.now()), parts: [], _live: true };
        s().messages = [...s().messages, userMsg, curMsg];
        ctx.set({ draft: '', busy: true, error: null });

        if (!isOnline()) {
            await queueMessage('chat', { prompt: t });
            s().messages = s().messages.slice(0, -1);
            s().messages.push({ id: curMsg.id, role: 'assistant', content: '(offline -- queued, will send when connection returns)', time: formatTime(Date.now()) });
            ctx.set({ busy: false });
            return;
        }

        if (!ensureWs() || !sendFrame({ type: 'prompt', text: t, attachments: s().staged.map(f => ({ name: f.name, path: f.path })) })) {
            curMsg.error = 'agent workspace connection unavailable';
            delete curMsg._live;
            ctx.set({ busy: false });
            return;
        }
        ctx.set({ staged: [] });
    }

    function stop() {
        sendFrame({ type: 'cancel' });
        const c = cur();
        if (c && c.role === 'assistant') c.stopped = true;
        ctx.rerender();
    }

    return () => {
        const st = s();
        return h('div', { class: 'fd-chat' },
            h('div', { class: 'fd-chat-picker' },
                st.sessions.length ? Select({
                    value: st.sessionId || '',
                    placeholder: 'new conversation',
                    'aria-label': 'switch conversation',
                    options: st.sessions.map(row => ({ value: row.id, label: (row.title || '(untitled)').slice(0, 60) + (row.needsInput ? ' — needs input' : '') })),
                    onChange: switchSession,
                }) : null,
                h('label', { class: 'fd-chat-attach', title: 'attach files to the next message' },
                    'attach',
                    h('input', { type: 'file', multiple: true, style: 'display:none', onchange: (e) => { attachFiles(e.target.files); e.target.value = ''; } })),
                ...st.staged.map((f, i) => h('span', { key: 'st' + i, class: 'fd-chat-staged' },
                    f.name,
                    h('button', { type: 'button', class: 'fd-chat-staged-x', 'aria-label': 'remove ' + f.name, onclick: () => { st.staged = st.staged.filter((_, j) => j !== i); ctx.rerender(); } }, '×')))),
            AgentChat({
                messages: st.messages,
                busy: st.busy,
                draft: st.draft,
                status: st.busy ? 'streaming…' : (st.conn === 'open' ? 'ready' : 'connecting…'),
                agentName: 'freddie',
                placeholder: st.busy ? 'queue a follow-up… (or stop)' : 'message…',
                showMinimap: true,
                banners: st.error ? [noteAlert({ kind: 'error', msg: st.error })] : [],
                onInput: (v) => { st.draft = v; },
                onSend: send,
                onStop: stop,
                onNewChat: () => {
                    try { st.ws && st.ws.close(); } catch { /* already closed */ }
                    ctx.set({ messages: [], draft: '', error: null, sessionId: null, ws: null, conn: 'closed' });
                },
            }));
    };
});

export const voice = makePage((ctx) => {
    async function load() {
        // Probe for a voice backend; the endpoint is optional, so a 404/!ok
        // means "not wired" rather than an error to surface.
        try { const v = await api('/api/voice').catch(() => null); ctx.set({ loading: false, voice: v, error: null }); }
        catch (e) { ctx.set({ loading: false, error: e }); }
    }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading voice config…');
        const v = s.voice;
        const enabled = v && (v.enabled || v.transcription || v.tts);
        return [
            PageHeader({ title: 'voice', lede: 'voice surfaces', right: enabled ? Chip({ tone: 'ok', children: 'enabled' }) : Chip({ tone: 'neutral', children: 'not configured' }) }),
            enabled
                ? section('backends', Table({ headers: ['capability', 'status'], rows: [['transcription', v.transcription ? Chip({ tone: 'ok', children: 'on' }) : Chip({ tone: 'neutral', children: 'off' })], ['tts', v.tts ? Chip({ tone: 'ok', children: 'on' }) : Chip({ tone: 'neutral', children: 'off' })]] }))
                : section('status', emptyState('no voice backend wired in this build. configure a transcription/tts plugin to enable.')),
        ];
    };
});
