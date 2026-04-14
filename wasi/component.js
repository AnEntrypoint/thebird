import { GoogleGenAI } from '@google/genai';

function cleanSchema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(cleanSchema);
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

function partToGemini(b) {
  if (b.kind === 'text' && b.text) return { text: b.text };
  if (b.kind === 'tool_use') return { functionCall: { name: b.toolName || '', args: b.toolInput ? JSON.parse(b.toolInput) : {} } };
  if (b.kind === 'tool_result') {
    let resp;
    try { resp = JSON.parse(b.text || '{}'); } catch { resp = { result: b.text }; }
    return { functionResponse: { name: b.toolName || 'unknown', response: resp } };
  }
  return null;
}

function convertMessages(messages) {
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = m.content.map(partToGemini).filter(Boolean);
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

function buildConfig({ system, temperature, maxOutputTokens } = {}) {
  const config = {
    maxOutputTokens: maxOutputTokens ?? 8192,
    temperature: temperature ?? 0.7,
  };
  if (system) config.systemInstruction = system;
  return config;
}

export async function generate(messages, config) {
  const { apiKey, model, system, temperature, maxOutputTokens } = config;
  if (!apiKey) return { text: '', error: 'apiKey required' };
  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = convertMessages(messages);
    const geminiConfig = buildConfig({ system, temperature, maxOutputTokens });
    const response = await ai.models.generateContent({
      model: model || 'gemini-2.0-flash',
      contents,
      config: geminiConfig,
    });
    const candidate = response.candidates?.[0];
    if (!candidate) return { text: '', error: 'no candidates returned' };
    const text = (candidate.content?.parts || [])
      .filter(p => p.text && !p.thought)
      .map(p => p.text)
      .join('');
    return { text, error: null };
  } catch (err) {
    return { text: '', error: err?.message || String(err) };
  }
}

export function convertMessagesExport(messages) {
  return JSON.stringify(convertMessages(messages));
}
