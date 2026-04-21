import { createElement, applyDiff, htm } from './vendor/ui-libs.js';
import { agentGenerate } from './agent-chat.js';

const html = htm.bind(createElement);

const PROVIDERS = {
  gemini:   { label: 'Google Gemini',   baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyPlaceholder: 'GEMINI_API_KEY', models: [] },
  openai:   { label: 'OpenAI',          baseUrl: 'https://api.openai.com/v1',                        keyPlaceholder: 'OPENAI_API_KEY', models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'] },
  xai:      { label: 'xAI Grok',        baseUrl: 'https://api.x.ai/v1',                              keyPlaceholder: 'XAI_API_KEY',    models: ['grok-3', 'grok-3-mini', 'grok-3-fast'] },
  groq:     { label: 'Groq',            baseUrl: 'https://api.groq.com/openai/v1',                   keyPlaceholder: 'GROQ_API_KEY',   models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  mistral:  { label: 'Mistral',         baseUrl: 'https://api.mistral.ai/v1',                        keyPlaceholder: 'MISTRAL_API_KEY', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
  deepseek: { label: 'DeepSeek',        baseUrl: 'https://api.deepseek.com/v1',                      keyPlaceholder: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  cerebras: { label: 'Cerebras',        baseUrl: 'https://api.cerebras.ai/v1',                      keyPlaceholder: 'CEREBRAS_API_KEY', models: ['gpt-oss-120b', 'llama3.1-8b'] },
  kilo:     { label: 'Kilo Code',              baseUrl: 'http://localhost:4780',                     keyPlaceholder: '(no key needed)', models: ['x-ai/grok-code-fast-1:optimized:free', 'kilo-auto/free', 'openrouter/free', 'stepfun/step-3.5-flash:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'bytedance-seed/dola-seed-2.0-pro:free'] },
  opencode: { label: 'opencode (zen)',         baseUrl: 'http://localhost:4790',                     keyPlaceholder: '(needs opencode auth login)', models: ['minimax-m2.5-free', 'nemotron-3-super-free'] },
  custom:   { label: 'Custom (OpenAI-compat)', baseUrl: '',                                          keyPlaceholder: 'API_KEY',        models: [] },
};

async function fetchGeminiModels(apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) throw new Error(`Models API ${res.status}`);
  const { models = [] } = await res.json();
  return models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name }));
}

async function fetchOpenAIModels(baseUrl, apiKey) {
  const url = baseUrl.replace(/\/$/, '') + '/models';
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Models API ${res.status}`);
  const { data = [] } = await res.json();
  return data.map(m => ({ id: m.id, label: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchModels(providerType, baseUrl, apiKey) {
  if (providerType === 'gemini') return fetchGeminiModels(apiKey);
  const staticModels = PROVIDERS[providerType]?.models || [];
  try {
    return await fetchOpenAIModels(baseUrl, apiKey);
  } catch {
    return staticModels.map(id => ({ id, label: id }));
  }
}

class BirdChat extends HTMLElement {
  constructor() {
    super();
    const rawSaved = localStorage.getItem('provider_type') || 'gemini';
    const savedProvider = PROVIDERS[rawSaved] ? rawSaved : (rawSaved === 'acp' || rawSaved === 'kilohttp' ? 'kilo' : 'gemini');
    const savedBaseUrl = localStorage.getItem('provider_base_url') || PROVIDERS[savedProvider]?.baseUrl || '';
    this.state = {
      messages: [], streaming: false,
      providerType: savedProvider,
      baseUrl: savedBaseUrl,
      model: localStorage.getItem('provider_model') || (savedProvider === 'gemini' ? 'gemini-2.5-flash' : (PROVIDERS[savedProvider]?.models[0] || '')),
      apiKey: localStorage.getItem('provider_api_key') || '',
      models: [], modelsLoading: false, status: '', streamingText: '',
    };
    const self = this;
    Object.assign(window.__debug = window.__debug || {}, {
      get state() { return self.state; },
      get messages() { return self.state.messages; },
      get models() { return self.state.models; },
    });
  }

  connectedCallback() {
    this.render();
    Object.assign(window.__debug, { acp: { baseUrl: this.state.baseUrl, provider: this.state.providerType } });
    if (this.state.apiKey) this.loadModels();
  }

  setState(patch) { Object.assign(this.state, patch); this.render(); }

  async loadModels() {
    const { providerType, baseUrl, apiKey } = this.state;
    this.setState({ modelsLoading: true, status: '' });
    try {
      const models = await fetchModels(providerType, baseUrl, apiKey);
      const current = this.state.model;
      const model = models.find(m => m.id === current) ? current : (models[0]?.id || current);
      this.setState({ models, model, modelsLoading: false });
    } catch (err) {
      this.setState({ modelsLoading: false, status: 'Failed to load models: ' + (err?.message || String(err)) });
    }
  }

  setProvider(type) {
    const def = PROVIDERS[type] || {};
    const baseUrl = type === 'custom' ? '' : (def.baseUrl || '');
    const model = def.models?.[0] || '';
    localStorage.setItem('provider_type', type);
    localStorage.setItem('provider_base_url', baseUrl);
    localStorage.setItem('provider_model', model);
    this.setState({ providerType: type, baseUrl, model, models: [], apiKey: localStorage.getItem('provider_api_key') || '' });
  }

  renderBaseUrlInput() {
    const { providerType, baseUrl } = this.state;
    if (providerType !== 'custom' && providerType !== 'kilo' && providerType !== 'opencode') return null;
    const ph = providerType === 'kilo' ? 'http://localhost:4780' : (providerType === 'opencode' ? 'http://localhost:4790' : 'https://your-endpoint/v1');
    return html`<input type="text" class="tui-input" style="flex:1;min-width:140px" placeholder=${ph} value=${baseUrl}
      onchange=${e => { localStorage.setItem('provider_base_url', e.target.value); this.setState({ baseUrl: e.target.value }); }} />`;
  }
  renderApiKeyInput() {
    const { providerType, apiKey } = this.state;
    if (providerType === 'kilo' || providerType === 'opencode') return null;
    const provDef = PROVIDERS[providerType] || PROVIDERS.custom;
    return html`<input id="api-key-input" type="password" class="tui-input" style="flex:1;min-width:120px" placeholder=${provDef.keyPlaceholder} value=${apiKey}
      onchange=${e => { const v = e.target.value.trim(); localStorage.setItem('provider_api_key', v); this.setState({ apiKey: v }); if (v) this.loadModels(); }} />`;
  }

  render() {
    const { messages, streaming, model, apiKey, models, modelsLoading, status, providerType, baseUrl, streamingText } = this.state;
    const provDef = PROVIDERS[providerType] || PROVIDERS.custom;
    const opts = (models.length === 0 ? (provDef.models.length ? provDef.models.map(id => ({ id, label: id })) : [{ id: model, label: model }]) : models)
      .map(m => html`<option value=${m.id} selected=${m.id === model}>${m.label}</option>`);
    const provOpts = Object.entries(PROVIDERS).map(([id, p]) =>
      html`<option value=${id} selected=${id === providerType}>${p.label}</option>`);

    applyDiff(this, html`
      <div style="display:flex;flex-direction:column;height:100%">
        <div class="tui-toolbar">
          <label>provider:</label>
          <select class="tui-select" onchange=${e => this.setProvider(e.target.value)}>${provOpts}</select>
          ${this.renderBaseUrlInput()}
          ${this.renderApiKeyInput()}
          ${modelsLoading
            ? html`<span class="tui-spinner"></span>`
            : html`<select class="tui-select" value=${model}
                onchange=${e => { localStorage.setItem('provider_model', e.target.value); this.setState({ model: e.target.value }); }}>${opts}</select>`}
          <button class="tui-btn" onclick=${() => this.setState({ messages: [], status: '' })}>[clear]</button>
        </div>

        <div id="msg-list" class="tui-msglist">
          ${messages.map((m, i) => html`
            <div key=${i} class=${'tui-msg ' + m.role}>${typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')}</div>`)}
          ${streaming && !streamingText && html`<div class="tui-msg assistant"><span class="tui-spinner"></span> thinking...</div>`}
        </div>

        ${status && html`<div class="tui-error-text" style="padding:0 1ch">${status}</div>`}

        <form class="tui-compose" onsubmit=${e => { e.preventDefault(); this.send(); }}>
          <textarea id="chat-input" class="tui-textarea" style="flex:1;resize:none;min-height:24px;max-height:120px"
            placeholder="type message... (shift+enter for newline)" rows="1" disabled=${streaming}
            onkeydown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }}
            oninput=${e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}></textarea>
          <button type="submit" class="tui-btn primary" disabled=${streaming}>
            ${streaming ? html`<span class="tui-spinner"></span>` : '[send]'}
          </button>
        </form>
      </div>`);
  }

  async send() {
    const input = this.querySelector('#chat-input');
    const text = input?.value.trim();
    if (!text || this.state.streaming) return;
    const { apiKey, model, providerType, baseUrl } = this.state;
    if (!apiKey && providerType !== 'kilo' && providerType !== 'opencode') { this.setState({ status: 'Enter an API key above.' }); return; }
    input.value = '';
    input.style.height = 'auto';
    const normalizedMessages = [...this.state.messages, { role: 'user', content: text }].map(m => ({
      ...m, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
    }));
    this.setState({ messages: normalizedMessages, streaming: true, status: '', streamingText: '' });
    const provider = { type: providerType, apiKey, model, baseUrl: providerType === 'gemini' ? '' : baseUrl, url: baseUrl };
    try {
      let full = '';
      const streamEl = document.createElement('div');
      streamEl.className = 'tui-msg assistant';
      const cursor = document.createElement('span');
      cursor.style.cssText = 'animation:blink 0.5s step-end infinite';
      cursor.textContent = '█';
      const wrap = document.createElement('div');
      wrap.appendChild(streamEl);
      wrap.appendChild(cursor);
      const list = this.querySelector('#msg-list');
      if (list) list.appendChild(wrap);
      await agentGenerate(provider, normalizedMessages,
        chunk => { full += chunk; streamEl.textContent = full; const l = this.querySelector('#msg-list'); if (l) l.scrollTop = l.scrollHeight; },
        (name, args) => { full += `\n[tool: ${name}(${JSON.stringify(args)})]\n`; streamEl.textContent = full; }
      );
      wrap.remove();
      this.setState({ messages: [...normalizedMessages, { role: 'assistant', content: [{ type: 'text', text: full || '(empty)' }] }], streaming: false, streamingText: '' });
      const l2 = this.querySelector('#msg-list');
      if (l2) l2.scrollTop = l2.scrollHeight;
    } catch (err) {
      this.setState({ streaming: false, streamingText: '', status: 'Error: ' + (err?.message || String(err)) });
    }
  }
}

customElements.define('bird-chat', BirdChat);
