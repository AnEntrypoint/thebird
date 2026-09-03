import { createFs } from './instance-fs.js';
import { createFreddieChat } from './freddie-chat.js';

class BirdChat extends HTMLElement {
    async connectedCallback() {
        this.classList.add('freddie-chat-host');
        const fs = await createFs('site-app');
        const instance = { id: 'site-app', fs, shells: [], windows: [], browser: null };
        const { node } = createFreddieChat({ instance });
        this.appendChild(node);
    }
}

customElements.define('bird-chat', BirdChat);
