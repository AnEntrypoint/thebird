// Thread containers: Chat (the standard header + log + composer surface),
// AICat / AICatPortrait (the ascii-mascot variant), and ChatSuggestions (the
// blank-thread composer-priming CTA).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { t } from '../../i18n.js';
import { ChatMessage } from './message.js';
import { makeThreadAutoScroll } from './thread-scroll.js';
import { ensureCachesInit } from './stats.js';

const h = webjsx.createElement;

// ChatSuggestions — centered blank-thread heading + subtext + a wrapped row
// of prompt chips that fill the composer textarea on click and auto-dismiss
// on first send. Ported from docstudio's empty-state composer-priming CTA
// (distinct from a generic list EmptyState: this exists to seed a first
// message, not to describe an empty list). `onPick(prompt, item)` is the
// caller's single hook — the component does not touch the composer DOM
// itself, so the host decides how "fill the composer" actually happens.
// A rapid double-click on the same chip (or a click racing the first send)
// is guarded by a one-shot `_picked` flag: only the first click of any kind
// dispatches onPick, so the composer is never filled twice and the chips
// never reappear having already been "used".
export function ChatSuggestions({ heading = 'What can I help with?', subtext = '', suggestions = [] } = {}) {
    let picked = false;
    return h('div', { class: 'chat-suggestions', role: 'group', 'aria-label': heading },
        h('h2', { class: 'chat-suggestions-heading' }, heading),
        subtext ? h('p', { class: 'chat-suggestions-subtext' }, subtext) : null,
        h('div', { class: 'chat-suggestions-list' },
            ...suggestions.map((s, i) => h('button', {
                key: s.id || i, type: 'button', class: 'chat-suggestions-chip',
                onclick: () => { if (picked) return; picked = true; s.onPick ? s.onPick(s) : null; }
            }, s.label))
        )
    );
}

export function Chat({ title = 'chat', sub, messages = [], composer, header, suggestions, onSuggestionClick } = {}) {
    // Warm markdown/Prism caches once so library loading parallelizes.
    ensureCachesInit();
    const threadRef = makeThreadAutoScroll(() => messages.length);
    const msgCount = messages.length;
    return h('div', { class: 'chat' },
        header || h('div', { class: 'chat-head', role: 'banner' },
            h('h2', { class: 'ds-chat-title' }, title),
            sub ? h('span', { class: 'sub', 'aria-label': `subtitle: ${sub}` }, ' · ' + sub) : null,
            h('span', { class: 'spread' }),
            msgCount > 0
                ? h('span', { class: 'sub', 'aria-live': 'polite' }, msgCount + (msgCount === 1 ? ' message' : ' messages'))
                : null
        ),
        h('div', { class: 'chat-thread', ref: threadRef, role: 'log', 'aria-label': 'chat messages', 'aria-live': 'polite', 'aria-relevant': 'additions' },
            messages.length === 0
                ? h('div', { key: '_empty', class: 'chat-empty', role: 'status' },
                    h('p', { class: 'chat-empty-title' }, t('chat.startConversation', 'start a conversation')),
                    h('p', { class: 'chat-empty-sub' }, sub || t('chat.emptySub', 'Send a message to start the conversation')),
                    (suggestions && suggestions.length)
                        ? h('div', { class: 'chat-empty-suggestions' },
                            ...suggestions.map((s, i) => h('button', { key: 'sug' + i, type: 'button', class: 'chat-empty-suggestion',
                                onclick: () => { if (onSuggestionClick) onSuggestionClick(typeof s === 'string' ? s : (s.prompt || s.text || '')); } },
                                typeof s === 'string' ? s : (s.label || s.text || s.prompt))))
                        : null)
                : null,
            ...messages.map((m, i) => ChatMessage({ ...m, key: m.key != null ? m.key : i }))
        ),
        composer || null
    );
}

export const AICAT_FACE = ` /\\_/\\\n( o.o )\n > ^ <`;

// `status` is opt-in and omitted by default: this component renders IDENTITY
// (who you're talking to — name, avatar/face), not live conversation state.
// A caller that also renders a thread head with its own status (AICat below)
// should leave `status` unset here so there is exactly one place on the page
// showing dynamic state — passing it back in duplicates that source of truth.
export function AICatPortrait({ name = 'aicat', status, face } = {}) {
    return h('div', { class: 'aicat-portrait' },
        // role="img" collapses the ASCII art into a single named image for a
        // screen reader (otherwise the slashes and parens are read out
        // character by character as text). It is also what makes the
        // aria-label legal here: a bare <pre> has no role and so can carry no
        // accessible name, exactly like the chat reaction spans.
        h('pre', { class: 'aicat-face', role: 'img', 'aria-label': `${name} portrait` }, face || AICAT_FACE),
        h('div', { class: 'aicat-meta' },
            h('span', { class: 'name' }, name),
            status != null
                ? h('span', { class: 'status', 'aria-label': `status: ${status}` }, h('span', { class: 'dot ds-dot ds-dot-on', 'aria-hidden': 'true' }), ' ', status)
                : null
        )
    );
}

export function AICat({ name = 'aicat', messages = [], thinking, composer, status = 'online · purring', header } = {}) {
    ensureCachesInit();
    const annotated = messages.map((m) =>
        m.who === 'them' ? { ...m, aicat: true, avatar: m.avatar || '=^.^=' } : m);
    const all = thinking
        ? [...annotated, { who: 'them', aicat: true, avatar: '=^.^=', typing: true, key: '_thinking' }]
        : annotated;
    const threadRef = makeThreadAutoScroll(() => all.length);
    return h('div', { class: 'chat' },
        header || h('div', { class: 'chat-head', role: 'banner' },
            h('span', { class: 'dot', 'aria-hidden': 'true' }),
            h('h2', { class: 'ds-chat-title' }, name),
            h('span', { class: 'sub', 'aria-label': `status: ${status}` }, ' · ' + status),
            h('span', { class: 'spread' }),
            messages.length > 0
                ? h('span', { class: 'sub', 'aria-live': 'polite' }, messages.length + (messages.length === 1 ? ' turn' : ' turns'))
                : null
        ),
        h('div', { class: 'chat-thread', ref: threadRef, role: 'log', 'aria-label': 'conversation turns', 'aria-live': 'polite', 'aria-relevant': 'additions' },
            ...all.map((m, i) => ChatMessage({ ...m, key: m.key != null ? m.key : i }))
        ),
        composer || null
    );
}
