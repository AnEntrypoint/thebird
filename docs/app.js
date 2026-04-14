import { createElement, applyDiff } from 'https://esm.sh/webjsx@0.0.73';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(createElement);

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function fetchModels(apiKey) {
  const res = await fetch(`${BASE}/models?key=${apiKey}`);
  if (!res.ok) throw new Error(`Models API ${res.status}`);
  const { models = [] } = await res.json();
  return models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name }));
}

async function* streamGenerate(apiKey, model, contents) {
  const res = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } }),
  });
  if (!res.ok) throw new Error(`Generate API ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const chunk = JSON.parse(json);
        for (const c of (chunk.candidates || []))
          for (const p of (c.content?.parts || []))
            if (p.text && !p.thought) yield p.text;
      } catch {}
    }
  }
}

function convertMessages(messages) {
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      if (m.content) contents.push({ role, parts: [{ text: m.content }] });
      continue;
    }
    if (Array.isArray(m.content)) {
      const parts = m.content.map(b => {
        if (b.type === 'text' && b.text) return { text: b.text };
        return null;
      }).filter(Boolean);
      if (parts.length) contents.push({ role, parts });
    }
  }
  return contents;
}

class BirdChat extends HTMLElement {
  constructor() {
    super();
    this.state = {
      messages: [], streaming: false, model: 'gemini-2.5-flash',
      apiKey: localStorage.getItem('gemini_api_key') || '',
      models: [], modelsLoading: false, status: '', streamingText: '',
    };
    const self = this;
    window.__debug = {
      get state() { return self.state; },
      get messages() { return self.state.messages; },
      get models() { return self.state.models; },
    };
  }

  connectedCallback() {
    this.render();
    if (this.state.apiKey) this.loadModels(this.state.apiKey);
  }

  setState(patch) { Object.assign(this.state, patch); this.render(); }

  async loadModels(apiKey) {
    this.setState({ modelsLoading: true, status: '' });
    try {
      const models = await fetchModels(apiKey);
      const current = this.state.model;
      const model = models.find(m => m.id === current) ? current : (models[0]?.id || current);
      this.setState({ models, model, modelsLoading: false });
    } catch (err) {
      this.setState({ modelsLoading: false, status: 'Failed to load models: ' + (err?.message || String(err)) });
    }
  }

  render() {
    const { messages, streaming, model, apiKey, models, modelsLoading, status, streamingText } = this.state;
    const opts = (models.length === 0 ? [{ id: model, label: model }] : models)
      .map(m => html`<option value=${m.id} selected=${m.id === model}>${m.label}</option>`);

    applyDiff(this, html`
      <div class="flex flex-col h-full">
        <header class="navbar bg-base-200 border-b border-base-300 gap-2 flex-wrap px-4 py-2">
          <span class="text-primary font-bold text-lg mr-2">🐦 thebird</span>
          <span class="text-base-content/50 text-xs hidden sm:inline">Anthropic SDK format → Gemini API</span>
          <div class="flex gap-2 flex-1 min-w-0 items-center flex-wrap">
            <input id="api-key-input" type="password" class="input input-sm input-bordered flex-1 min-w-[160px]"
              placeholder="GEMINI_API_KEY" value=${apiKey}
              onchange=${e => { const v = e.target.value.trim(); localStorage.setItem('gemini_api_key', v); this.setState({ apiKey: v }); if (v) this.loadModels(v); }} />
            <div class="relative">
              ${modelsLoading
                ? html`<span class="loading loading-spinner loading-sm text-primary"></span>`
                : html`<select class="select select-sm select-bordered" value=${model} disabled=${models.length === 0}
                    onchange=${e => this.setState({ model: e.target.value })}>${opts}</select>`}
            </div>
            <button class="btn btn-sm btn-ghost" onclick=${() => this.setState({ messages: [], status: '' })}>Clear</button>
          </div>
        </header>

        <div id="msg-list" class="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
          ${messages.map((m, i) => html`
            <div key=${i} class=${'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div class=${'msg-bubble card px-4 py-3 text-sm leading-relaxed ' + (m.role === 'user' ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content')}>${m.content}</div>
            </div>`)}
          ${streaming && !streamingText && html`<div class="flex justify-start"><div class="card bg-base-200 px-4 py-3"><span class="loading loading-dots loading-sm"></span></div></div>`}
        </div>

        ${status && html`<div class="text-xs text-error px-4 pb-1">${status}</div>`}

        <form class="flex gap-2 p-3 border-t border-base-300 bg-base-200" onsubmit=${e => { e.preventDefault(); this.send(); }}>
          <textarea id="chat-input" class="textarea textarea-bordered flex-1 resize-none min-h-[42px] max-h-[120px] text-sm"
            placeholder="Message… (Shift+Enter for newline)" rows="1" disabled=${streaming}
            onkeydown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }}
            oninput=${e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}></textarea>
          <button type="submit" class="btn btn-primary self-end" disabled=${streaming}>
            ${streaming ? html`<span class="loading loading-spinner loading-sm"></span>` : 'Send'}
          </button>
        </form>
      </div>`);
  }

  async send() {
    const input = this.querySelector('#chat-input');
    const text = input?.value.trim();
    if (!text || this.state.streaming) return;
    const { apiKey, model } = this.state;
    if (!apiKey) { this.setState({ status: 'Enter a Gemini API key above.' }); return; }
    input.value = '';
    input.style.height = 'auto';
    const messages = [...this.state.messages, { role: 'user', content: text }];
    this.setState({ messages, streaming: true, status: '', streamingText: '' });
    try {
      let full = '';
      const streamEl = document.createElement('div');
      streamEl.className = 'msg-bubble card bg-base-200 text-base-content px-4 py-3 text-sm leading-relaxed';
      const cursor = document.createElement('span');
      cursor.className = 'animate-pulse ml-1';
      cursor.textContent = '▋';
      const list = this.querySelector('#msg-list');
      const wrap = document.createElement('div');
      wrap.className = 'flex justify-start';
      wrap.appendChild(streamEl);
      wrap.appendChild(cursor);
      if (list) list.appendChild(wrap);
      for await (const chunk of streamGenerate(apiKey, model, convertMessages(messages))) {
        full += chunk;
        streamEl.textContent = full;
        if (list) list.scrollTop = list.scrollHeight;
      }
      wrap.remove();
      this.setState({ messages: [...messages, { role: 'assistant', content: full || '(empty)' }], streaming: false, streamingText: '' });
      if (list) list.scrollTop = list.scrollHeight;
    } catch (err) {
      this.setState({ streaming: false, streamingText: '', status: 'Error: ' + (err?.message || String(err)) });
    }
  }
}

customElements.define('bird-chat', BirdChat);
