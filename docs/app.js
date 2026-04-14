import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';

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

function buildConfig({ system, temperature, maxOutputTokens } = {}) {
  const config = { maxOutputTokens: maxOutputTokens ?? 8192, temperature: temperature ?? 0.7 };
  if (system) config.systemInstruction = system;
  return config;
}

const state = { messages: [], streaming: false, model: 'gemini-2.0-flash' };

window.__debug = {
  get state() { return state; },
  get messages() { return state.messages; },
};

const $messages = document.getElementById('messages');
const $input = document.getElementById('input');
const $form = document.getElementById('chat-form');
const $send = document.getElementById('send-btn');
const $apiKey = document.getElementById('api-key');
const $model = document.getElementById('model-select');
const $status = document.getElementById('status');
const $clear = document.getElementById('clear-btn');

const savedKey = localStorage.getItem('gemini_api_key') || '';
if (savedKey) $apiKey.value = savedKey;
$apiKey.addEventListener('change', () => localStorage.setItem('gemini_api_key', $apiKey.value.trim()));
$model.addEventListener('change', () => { state.model = $model.value; });

function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  $messages.appendChild(el);
  $messages.scrollTop = $messages.scrollHeight;
  return el;
}

function setStatus(t) { $status.textContent = t; }

async function sendMessage(userText) {
  const apiKey = $apiKey.value.trim();
  if (!apiKey) { addMsg('error', 'Enter a Gemini API key above.'); return; }
  state.messages.push({ role: 'user', content: userText });
  addMsg('user', userText);
  state.streaming = true;
  $send.disabled = true;
  setStatus('Streaming…');
  const modelEl = addMsg('model', '');
  let full = '';
  try {
    const ai = new GoogleGenAI({ apiKey });
    const stream = await ai.models.generateContentStream({
      model: state.model,
      contents: convertMessages(state.messages),
      config: buildConfig({ temperature: 0.7 }),
    });
    for await (const chunk of stream) {
      for (const candidate of (chunk.candidates || [])) {
        for (const part of (candidate.content?.parts || [])) {
          if (part.text && !part.thought) { full += part.text; modelEl.textContent = full; $messages.scrollTop = $messages.scrollHeight; }
        }
      }
    }
    if (!full) full = '(empty response)';
    modelEl.textContent = full;
    state.messages.push({ role: 'assistant', content: full });
    setStatus('');
  } catch (err) {
    modelEl.remove();
    addMsg('error', 'Error: ' + (err?.message || String(err)));
    state.messages.pop();
    setStatus('');
  } finally {
    state.streaming = false;
    $send.disabled = false;
    $input.focus();
  }
}

$input.addEventListener('input', () => { $input.style.height = 'auto'; $input.style.height = Math.min($input.scrollHeight, 160) + 'px'; });

$form.addEventListener('submit', e => {
  e.preventDefault();
  const text = $input.value.trim();
  if (!text || state.streaming) return;
  $input.value = '';
  $input.style.height = 'auto';
  sendMessage(text);
});

$input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $form.requestSubmit(); }
});

$clear.addEventListener('click', () => {
  state.messages = [];
  $messages.innerHTML = '';
  setStatus('Cleared.');
  setTimeout(() => setStatus(''), 1500);
});
