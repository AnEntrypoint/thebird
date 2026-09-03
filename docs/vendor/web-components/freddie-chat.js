// <freddie-chat> — thin subclass of <ds-chat> with freddie-flavored defaults
// (title, sub, composer placeholder). Auto-registers in browsers.

import { DsChat, registerChatElement } from './ds-chat.js';
import { register } from '../debug.js';

let _stats = { mounts: 0, sends: 0 };

class FreddieChat extends DsChat {
    constructor() {
        super();
        this._title = 'freddie';
        this._sub = '/tools · /tool name {json} · /run …';
        this._placeholder = 'message freddie…';
    }

    connectedCallback() {
        _stats.mounts += 1;
        super.connectedCallback();
    }
}

let _registered = false;
export function registerFreddieChatElement() {
    registerChatElement();
    if (_registered) return;
    if (typeof customElements === 'undefined') return;
    if (!customElements.get('freddie-chat')) customElements.define('freddie-chat', FreddieChat);
    _registered = true;
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
    registerFreddieChatElement();
}

register('freddie-chat', () => ({ registered: _registered, ..._stats, instances: typeof document !== 'undefined' ? document.querySelectorAll('freddie-chat').length : 0 }));

export { FreddieChat };
