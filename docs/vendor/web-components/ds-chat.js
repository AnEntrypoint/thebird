// <ds-chat> custom element — auto-registers when SDK loads in a browser.
// Attributes / properties:
//   el.messages = [{who,text,time,name,...}, ...]
//   el.placeholder, el.title, el.sub, el.disabled
// Emits a bubbling, composed 'send' event with { detail: { text } } when the
// user submits via the built-in composer.

import * as webjsx from '../../vendor/webjsx/index.js';
import { Chat, ChatComposer } from '../components/chat.js';

class DsChat extends HTMLElement {
    constructor() {
        super();
        this._messages = [];
        this._placeholder = 'type, then enter';
        this._title = 'chat';
        this._sub = '';
        this._composerValue = '';
        this._disabled = false;
        this._scrollPending = false;
    }
    static get observedAttributes() { return ['messages', 'placeholder', 'title', 'sub', 'disabled']; }
    attributeChangedCallback(name, _old, val) {
        if (name === 'messages') {
            try { this._messages = JSON.parse(val); } catch { this._messages = []; }
            this._scrollPending = true;
        } else if (name === 'placeholder') {
            this._placeholder = val || '';
        } else if (name === 'title') {
            this._title = val || 'chat';
            if (!this.hasAttribute('aria-label') || this._ariaLabelAuto) { this.setAttribute('aria-label', this._title); this._ariaLabelAuto = true; }
        } else if (name === 'sub') {
            this._sub = val || '';
        } else if (name === 'disabled') {
            this._disabled = val != null && val !== 'false';
        }
        this._render();
    }
    set messages(v) { this._messages = Array.isArray(v) ? v : []; this._scrollPending = true; this._render(); }
    get messages() { return this._messages; }
    set placeholder(v) { this._placeholder = v || ''; this._render(); }
    get placeholder() { return this._placeholder; }
    set title(v) { this._title = v || 'chat'; this._render(); }
    get title() { return this._title; }
    set sub(v) { this._sub = v || ''; this._render(); }
    get sub() { return this._sub; }
    set disabled(v) { this._disabled = !!v; this._render(); }
    get disabled() { return this._disabled; }
    connectedCallback() {
        this.classList.add('ds-247420');
        // Accessible name for the custom element itself: <ds-chat> has no
        // implicit ARIA role/name, so a screen reader landmark/element list
        // shows an unlabeled item without this. role="region" + aria-label
        // (falling back to the chat title) makes it identifiable on its own,
        // separate from the inner .chat-thread's role="log"/aria-live, which
        // announces individual streamed messages rather than naming the widget.
        if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
        if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', this._title || 'chat');
        this._render();
    }
    _send(text) {
        this._composerValue = '';
        this.dispatchEvent(new CustomEvent('send', { detail: { text }, bubbles: true, composed: true }));
        this._render();
    }
    _render() {
        if (!this.isConnected) return;
        // The factory captures `value` at construction time, so the click handler
        // it builds sees a stale empty string. Pass a no-op and own send wiring
        // ourselves by reading the live textarea below.
        const self = this;
        const composer = ChatComposer({
            value: this._composerValue,
            placeholder: this._placeholder,
            disabled: this._disabled,
            onInput: (v) => { self._composerValue = v; self._syncSendButton(); },
            onSend: () => { /* superseded by live read below */ },
        });
        const node = Chat({
            title: this._title,
            sub: this._sub,
            messages: this._messages,
            composer,
        });
        webjsx.applyDiff(this, node);
        // Wire send button + Enter-key to read the LIVE textarea value rather than
        // the closure's stale prop. Idempotent — only attach once per composer DOM node.
        const composerEl = this.querySelector('.chat-composer');
        if (composerEl && !composerEl._dsBound) {
            composerEl._dsBound = true;
            const ta = composerEl.querySelector('textarea');
            const btn = composerEl.querySelector('button.send');
            const submit = () => {
                const v = ta ? ta.value.trim() : '';
                if (!v || this._disabled) return;
                if (ta) ta.value = '';
                this._send(v);
            };
            if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); submit(); });
            if (ta) ta.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            });
        }
        if (this._scrollPending) {
            this._scrollPending = false;
            const thread = this.querySelector('.chat-thread');
            if (thread) thread.scrollTop = thread.scrollHeight;
        }
    }
    _syncSendButton() {
        const btn = this.querySelector('.chat-composer button.send');
        if (btn) btn.disabled = this._disabled || !this._composerValue.trim();
    }
}

export { DsChat };

let _registered = false;
export function registerChatElement() {
    if (_registered) return;
    if (typeof customElements === 'undefined') return;
    if (customElements.get('ds-chat')) { _registered = true; return; }
    customElements.define('ds-chat', DsChat);
    _registered = true;
}
