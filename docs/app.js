import { createElement, applyDiff } from 'https://esm.sh/webjsx@0.0.73';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(createElement);

const MODELS_API = key => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

async function fetchModels(apiKey) {
  const res = await fetch(MODELS_API(apiKey));
  if (!res.ok) throw new Error(`Models API ${res.status}: ${await res.text()}`);
  const { models = [] } = await res.json();
  return models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name }));
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
        if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input || {} } };
        if (b.type === 'tool_result') {
          let resp;
          try { resp = typeof b.content === 'string' ? JSON.parse(b.content) : (b.content || {}); }
          catch { resp = { result: b.content }; }
          return { functionResponse: { name: b.name || 'unknown', response: resp } };
        }
        return null;
      }).filter(Boolean);
      if (parts.length) contents.push({ role, parts });
    }
  }
  return contents;
}

function buildConfig({ system, temperature } = {}) {
  const config = { maxOutputTokens: 8192, temperature: temperature ?? 0.7 };
  if (system) config.systemInstruction = system;
  return config;
}

class BirdChat extends HTMLElement {
  constructor() {
    super();
    this.state = {
      messages: [], streaming: false, model: 'gemini-2.5-flash',
      apiKey: localStorage.getItem('gemini_api_key') || '',
      models: [], modelsLoading: false, status: '', streamingText: '',
    };
    window.__debug = {
      get state() { return this.state; }.bind(this),
      get messages() { return this.state.messages; }.bind(this),
      get models() { return this.state.models; }.bind(this),
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
    const modelOptions = (models.length === 0 ? [{ id: model, label: model }] : models)
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
                    onchange=${e => this.setState({ model: e.target.value })}>${modelOptions}</select>`}
            </div>
            <button class="btn btn-sm btn-ghost" onclick=${() => this.setState({ messages: [], status: '' })}>Clear</button>
          </div>
        </header>

        <div id="msg-list" class="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
          ${messages.map((m, i) => html`
            <div key=${i} class=${'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div class=${'msg-bubble card px-4 py-3 text-sm leading-relaxed ' + (m.role === 'user' ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content')}>${m.content}</div>
            </div>`)}
          ${streamingText && html`
            <div class="flex justify-start">
              <div class="msg-bubble card bg-base-200 text-base-content px-4 py-3 text-sm leading-relaxed">${streamingText}<span class="animate-pulse ml-1">▋</span></div>
            </div>`}
          ${!streamingText && streaming && html`<div class="flex justify-start"><div class="card bg-base-200 px-4 py-3"><span class="loading loading-dots loading-sm"></span></div></div>`}
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
      const { GoogleGenAI } = await import('https://esm.sh/@google/genai@1');
      const ai = new GoogleGenAI({ apiKey });
      const stream = await ai.models.generateContentStream({ model, contents: convertMessages(messages), config: buildConfig() });
      let full = '';
      for await (const chunk of stream) {
        for (const candidate of (chunk.candidates || []))
          for (const part of (candidate.content?.parts || []))
            if (part.text && !part.thought) { full += part.text; this.setState({ streamingText: full }); }
      }
      const list = document.getElementById('msg-list');
      if (list) list.scrollTop = list.scrollHeight;
      this.setState({ messages: [...messages, { role: 'assistant', content: full || '(empty)' }], streaming: false, streamingText: '' });
    } catch (err) {
      this.setState({ streaming: false, streamingText: '', status: 'Error: ' + (err?.message || String(err)) });
    }
  }
}

customElements.define('bird-chat', BirdChat);
