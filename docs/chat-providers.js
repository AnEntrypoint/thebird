export const PROVIDERS = {
  gemini:   { label: 'Google Gemini',   baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyPlaceholder: 'GEMINI_API_KEY', models: [] },
  openai:   { label: 'OpenAI',          baseUrl: 'https://api.openai.com/v1',                        keyPlaceholder: 'OPENAI_API_KEY', models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'] },
  xai:      { label: 'xAI Grok',        baseUrl: 'https://api.x.ai/v1',                              keyPlaceholder: 'XAI_API_KEY',    models: ['grok-3', 'grok-3-mini', 'grok-3-fast'] },
  groq:     { label: 'Groq',            baseUrl: 'https://api.groq.com/openai/v1',                   keyPlaceholder: 'GROQ_API_KEY',   models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  mistral:  { label: 'Mistral',         baseUrl: 'https://api.mistral.ai/v1',                        keyPlaceholder: 'MISTRAL_API_KEY', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
  deepseek: { label: 'DeepSeek',        baseUrl: 'https://api.deepseek.com/v1',                      keyPlaceholder: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  cerebras: { label: 'Cerebras',        baseUrl: 'https://api.cerebras.ai/v1',                      keyPlaceholder: 'CEREBRAS_API_KEY', models: ['gpt-oss-120b', 'llama3.1-8b'] },
  openrouter: { label: 'OpenRouter',    baseUrl: 'https://openrouter.ai/api/v1',                    keyPlaceholder: 'OPENROUTER_API_KEY', models: ['anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.1', 'google/gemini-2.5-flash', 'google/gemini-2.5-pro', 'openai/gpt-4.1', 'openai/gpt-4o-mini', 'x-ai/grok-code-fast-1', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat', 'qwen/qwen-2.5-coder-32b-instruct'] },
  kilo:     { label: 'Kilo Code',              baseUrl: 'http://localhost:4780',                     keyPlaceholder: '(no key needed)', models: ['x-ai/grok-code-fast-1:optimized:free', 'kilo-auto/free', 'openrouter/free', 'stepfun/step-3.5-flash:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'bytedance-seed/dola-seed-2.0-pro:free'] },
  opencode: { label: 'opencode (zen)',         baseUrl: 'http://localhost:4790',                     keyPlaceholder: '(needs opencode auth login)', models: ['minimax-m2.5-free', 'nemotron-3-super-free'] },
  acp2openai: { label: 'acp2openai (OpenAI-compat)', baseUrl: 'http://localhost:4800/v1',             keyPlaceholder: '(no key needed)', models: ['kilo/x-ai/grok-code-fast-1:optimized:free', 'kilo/kilo-auto/free', 'kilo/openrouter/free', 'opencode/minimax-m2.5-free'] },
  custom:   { label: 'Custom (OpenAI-compat)', baseUrl: '',                                          keyPlaceholder: 'API_KEY',        models: [] },
};

async function fetchGeminiModels(apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) throw new Error(`Models API ${res.status}`);
  const { models = [] } = await res.json();
  return models.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name }));
}

async function fetchOpenAIModels(baseUrl, apiKey) {
  const url = baseUrl.replace(/\/$/, '') + '/models';
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Models API ${res.status}`);
  const { data = [] } = await res.json();
  return data.map(m => ({ id: m.id, label: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModels(providerType, baseUrl, apiKey) {
  if (providerType === 'gemini') return fetchGeminiModels(apiKey);
  const staticModels = PROVIDERS[providerType]?.models || [];
  try { return await fetchOpenAIModels(baseUrl, apiKey); }
  catch { return staticModels.map(id => ({ id, label: id })); }
}

const fmtArgs = a => { try { const s = JSON.stringify(a); return s.length > 140 ? s.slice(0, 137) + '...' : s; } catch { return '?'; } };
const badge = (label, cls) => `\n\n[${cls}] ${label}\n`;

const fmtOut = o => { if (o == null) return ''; const s = typeof o === 'string' ? o : JSON.stringify(o); return s.length > 400 ? s.slice(0, 397) + '...' : s; };

const RENDERERS = {
  status: ev => badge('status: ' + ev.message, 'i'),
  'model-info': ev => badge('model: ' + (ev.providerID || '') + '/' + ev.modelID, 'i'),
  'tool-event': ev => {
    const head = badge('tool ' + (ev.status || '') + ': ' + ev.toolName + ' ' + fmtArgs(ev.input), 't');
    const out = ev.output != null ? '\n  → ' + fmtOut(ev.output).replace(/\n/g, '\n    ') + '\n' : '';
    const err = ev.error ? '\n  ✗ ' + fmtOut(ev.error) + '\n' : '';
    return head + out + err;
  },
  'tool-call': ev => badge('tool: ' + ev.toolName + ' ' + fmtArgs(ev.args), 't'),
  'file-event': ev => badge('file: ' + (ev.filename || ev.url || '?'), 'f'),
  'file-mirrored': ev => badge('wrote: ' + ev.path, 'f'),
  'reasoning-delta': ev => ev.textDelta,
  'step-start': () => badge('step start', 's'),
  'step-finish': ev => badge('step finish' + (ev.tokens ? ' tokens=' + JSON.stringify(ev.tokens) : ''), 's'),
  'unknown-part': ev => badge('?part ' + ev.partType + (ev.text ? ' text=' + fmtOut(ev.text) : ''), 'i'),
};

export function renderEvent(ev) { const r = RENDERERS[ev.type]; return r ? r(ev) : ''; }

export function formatStats(a) {
  if (!a) return '';
  const dur = a.active ? ((Date.now() - a.startedAt) / 1000).toFixed(1) : ((a.durationMs || 0) / 1000).toFixed(1);
  const parts = [a.active ? '●' : '○', a.provider, a.modelActual || a.model, dur + 's', 'txt=' + a.textChars];
  if (a.reasoningChars) parts.push('rsn=' + a.reasoningChars);
  if (a.toolCalls) parts.push('tool=' + a.toolCalls);
  if (a.files) parts.push('file=' + a.files);
  if (a.steps) parts.push('step=' + a.steps);
  if (a.lastError) parts.push('ERR:' + a.lastError.message.slice(0, 40));
  return parts.join(' · ');
}
