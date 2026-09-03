// Chat page — dashboard surface for the agent. Renders via the kit's
// Chat + ChatComposer primitives so the dashboard tab and the OS chat panel
// share the same bubble / tool-call / empty-state chrome. The bespoke
// cwd/skill/provider/model selectors live in a collapsible config strip
// above the thread (mirror of the OS panel cc-strip pattern).
//
// Wire-format translation lives in ./chat-protocol.js; provider discovery and
// the three send strategies (server SSE / in-page agent runtime / direct
// gateway completion) plus the event->state fold live in ./chat-transport.js.
// This module owns only the page's own state, DOM wiring, and config strip.

import * as webjsx from '../../../../vendor/webjsx/index.js';
import * as components from '../../../components.js';
import { getRecentPaths, saveRecentPath, skillLabel } from '../../../components/freddie/helpers.js';
import { toKitMessage } from './chat-protocol.js';
import { loadProviders, fetchChatEvents, applyChatEvents } from './chat-transport.js';

const h = webjsx.createElement;
const { Panel, Receipt, Chip, Icon } = components;

export function makeChatPage(ctx) {
    return async function chat(h0) {
        const root = ctx.root;
        const skills = [...h0.pi.skills.values()];
        const providers = await loadProviders();
        const configuredProviders = providers.filter(p => p.configured);

        const chatState = window.__fd_chatState = window.__fd_chatState || {
            cwd: '', skill: '', provider: '', model: '', messages: [], busy: false, sessionId: null, draft: '', abort: null,
        };
        if (!chatState.cwd) chatState.cwd = (getRecentPaths()[0] || '');

        // Find the chat container in the live DOM (set on the rendered <ds-chat>).
        const getChatHost = () => root.querySelector('ds-chat.fd-dashboard-chat');
        const syncMessages = () => {
            const host = getChatHost();
            if (host) host.messages = chatState.messages.map(toKitMessage);
        };

        const newSession = () => {
            if (chatState.busy) return;
            chatState.messages = [];
            chatState.sessionId = null;
            syncMessages();
        };

        const cancelInFlight = () => {
            if (chatState.abort) { try { chatState.abort.abort(); } catch { /* swallow: the in-flight request may already be settled, abort() is a no-op then */ } chatState.abort = null; }
            chatState.busy = false;
            syncMessages();
            renderPage();
        };

        const sendChat = async (prompt) => {
            if (chatState.busy) return;
            const trimmed = String(prompt || '').trim();
            if (!trimmed) return;
            chatState.messages.push({ role: 'user', content: trimmed });
            chatState.busy = true;
            chatState.progress = 'agent thinking…';
            chatState.abort = new AbortController();
            saveRecentPath(chatState.cwd);
            syncMessages();
            renderPage();
            try {
                const events = await fetchChatEvents(trimmed, chatState, renderPage);
                const assistantContent = applyChatEvents(events, chatState, syncMessages);
                if (assistantContent) chatState.messages.push({ role: 'assistant', content: assistantContent });
                if (!events.length) chatState.messages.push({ role: 'assistant', content: '(no response)' });
            } catch (e) {
                if (e.name === 'AbortError') chatState.messages.push({ role: 'assistant', content: '[cancelled]' });
                else chatState.messages.push({ role: 'assistant', content: 'error: ' + e.message });
            }
            chatState.abort = null;
            chatState.busy = false;
            chatState.progress = '';
            syncMessages();
            renderPage();
        };

        const recentPaths = getRecentPaths();
        const datalistId = 'fd-cwd-list';
        const byCat = skills.reduce((a, s) => { const c = s.category || 'other'; (a[c] = a[c] || []).push(s); return a; }, {});

        const renderPage = () => {
            const host = getChatHost();
            if (host) {
                host.busy = chatState.busy;
                host.placeholder = chatState.busy
                    ? (chatState.progress || 'agent working…')
                    : 'describe what you want to do in the working directory…';
            }
            // Refresh disabled state on header buttons.
            const newBtn = root.querySelector('.fd-chat-new');
            if (newBtn) newBtn.disabled = !!chatState.busy;
            const cancelBtn = root.querySelector('.fd-chat-cancel');
            if (cancelBtn) cancelBtn.style.display = chatState.busy ? '' : 'none';
        };

        // After mount, seed messages onto the ds-chat element + wire the send event.
        setTimeout(() => {
            const host = getChatHost();
            if (host && !host._fdBound) {
                host._fdBound = true;
                host.addEventListener('send', (e) => { sendChat(e.detail && e.detail.text); });
                host.messages = chatState.messages.map(toKitMessage);
                host.placeholder = 'describe what you want to do in the working directory…';
                host.sub = chatState.sessionId ? ('session ' + chatState.sessionId.slice(0, 8)) : 'agent';
            }
            renderPage();
        }, 50);

        const selSkill = h('select', { name: 'skill', onchange: (ev) => { chatState.skill = ev.target.value; } },
            h('option', { value: '' }, 'no skill'),
            ...Object.entries(byCat).map(([cat, ss]) =>
                h('optgroup', { label: cat },
                    ...ss.map(s => h('option', { value: s.name, selected: chatState.skill === s.name ? 'true' : null, title: s.description || s.name }, skillLabel(s)))
                )));

        const selProv = h('select', { name: 'provider', onchange: (ev) => { chatState.provider = ev.target.value; } },
            h('option', { value: '' }, configuredProviders.length ? 'auto' : 'no providers configured'),
            ...configuredProviders.map(p => h('option', { value: p.name, selected: chatState.provider === p.name ? 'true' : null }, (p.available ? '(on) ' : '(off) ') + p.name)));

        return [
            Panel({
                title: 'chat',
                right: h('div', { class: 'fd-chat-actions' },
                    h('button', { class: 'btn-secondary fd-btn-mini fd-chat-cancel', style: chatState.busy ? '' : 'display:none', onclick: (ev) => { ev.preventDefault(); cancelInFlight(); } }, 'cancel'),
                    h('button', { class: 'btn-primary fd-btn-mini fd-chat-new', onclick: (ev) => { ev.preventDefault(); newSession(); }, disabled: chatState.busy ? 'true' : null }, 'new session')
                ),
                children: [
                    h('datalist', { id: datalistId }, ...recentPaths.map(p => h('option', { value: p }))),
                    h('div', { class: 'fd-chat-config' },
                        h('div', { class: 'fd-chat-field fd-chat-field-grow' },
                            h('label', {}, 'working directory'),
                            h('input', { name: 'cwd', type: 'text', placeholder: 'e.g. C:/dev/myproject or /home/user/project', value: chatState.cwd, list: datalistId, oninput: (ev) => { chatState.cwd = ev.target.value; } })),
                        h('div', { class: 'fd-chat-row' },
                            h('div', { class: 'fd-chat-field fd-chat-field-grow' }, h('label', {}, 'skill'), selSkill),
                            h('div', { class: 'fd-chat-field fd-chat-field-grow' }, h('label', {}, 'provider'), selProv),
                            h('div', { class: 'fd-chat-field fd-chat-field-grow' }, h('label', {}, 'model (optional)'),
                                h('input', { name: 'model', type: 'text', placeholder: configuredProviders.find(p => p.name === chatState.provider)?.defaultModel || 'default', value: chatState.model, oninput: (ev) => { chatState.model = ev.target.value; } })))),
                    // Live chat surface — the kit's ds-chat web component handles
                    // layout, scroll, empty state, bubble chrome, tool-call cards,
                    // composer focus rings, send/cancel button swap, etc.
                    h('ds-chat', { class: 'fd-dashboard-chat ds-247420', title: 'chat', placeholder: 'describe what you want to do in the working directory…' }),
                ],
            }),
            configuredProviders.length === 0
                ? Panel({ title: 'no providers configured', children: Receipt({ rows: [
                    ['set API key', 'go to keys tab, click a provider chip to set its key'],
                    ['then reload', 'refresh this page to see providers here'],
                    ['or use a gateway', 'run a gateway server on localhost:4800 for local LLMs'],
                ] }) })
                : Panel({ title: 'configured providers', children: h('div', { class: 'fd-chip-wrap' },
                    ...providers.map(p => Chip({ tone: p.configured ? (p.available ? 'ok' : 'warn') : 'miss', children: p.configured ? [p.name, ' ', p.available ? Icon('circle-dot') : Icon('circle')] : p.name }))) }),
        ];
    };
}
