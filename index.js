const { GoogleGenAI } = require('@google/genai');

let _client = null;
function getClient(apiKey) {
  if (!_client || apiKey) _client = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
  return _client;
}

function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

function convertTools(tools) {
  if (!tools || typeof tools !== 'object') return [];
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description || '',
    parameters: cleanSchema(t.parameters?.jsonSchema || t.parameters || { type: 'object' })
  }));
}

function convertMessages(messages) {
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') { if (m.content) contents.push({ role, parts: [{ text: m.content }] }); continue; }
    if (Array.isArray(m.content)) {
      const parts = m.content.map(b => {
        if (b.type === 'text' && b.text) return { text: b.text };
        if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input || {} } };
        if (b.type === 'tool_result') {
          let resp;
          try { resp = typeof b.content === 'string' ? JSON.parse(b.content) : (b.content || {}); } catch { resp = { result: b.content }; }
          return { functionResponse: { name: b.name || 'unknown', response: resp } };
        }
        return null;
      }).filter(Boolean);
      if (parts.length) contents.push({ role, parts });
    }
  }
  return contents;
}

function extractModelId(model) {
  if (typeof model === 'string') return model;
  if (model?.modelId) return model.modelId;
  if (model?.id) return model.id;
  return 'gemini-2.0-flash';
}

function streamGemini({ model, system, messages, tools, onStepFinish, apiKey }) {
  return {
    fullStream: createFullStream({ model, system, messages, tools, onStepFinish, apiKey }),
    warnings: Promise.resolve([])
  };
}

async function* createFullStream({ model, system, messages, tools, onStepFinish, apiKey }) {
  const client = getClient(apiKey);
  const geminiTools = convertTools(tools);
  const modelId = extractModelId(model);
  let contents = convertMessages(messages);
  const config = { maxOutputTokens: 8192, temperature: 0.5, topP: 0.95 };
  if (system) config.systemInstruction = system;
  if (geminiTools.length > 0) config.tools = [{ functionDeclarations: geminiTools }];

  while (true) {
    yield { type: 'start-step' };
    try {
      const stream = client.models.generateContentStream({ model: modelId, contents, config });
      const allParts = [];
      for await (const chunk of await stream) {
        for (const candidate of (chunk.candidates || [])) {
          for (const part of (candidate.content?.parts || [])) {
            allParts.push(part);
            if (part.text && !part.thought) yield { type: 'text-delta', textDelta: part.text };
          }
        }
      }
      const fcParts = allParts.filter(p => p.functionCall);
      if (fcParts.length === 0) {
        yield { type: 'finish-step', finishReason: 'stop' };
        if (onStepFinish) await onStepFinish();
        return;
      }
      const toolResultParts = [];
      for (const part of fcParts) {
        const name = part.functionCall.name;
        const args = part.functionCall.args || {};
        const toolId = 'toolu_' + Math.random().toString(36).slice(2, 10);
        yield { type: 'tool-call', toolCallId: toolId, toolName: name, args };
        const toolDef = tools?.[name];
        let result = toolDef ? null : { error: true, message: 'Tool not found: ' + name };
        if (toolDef?.execute) {
          try { result = await toolDef.execute(args, { toolCallId: toolId }); }
          catch (e) { result = { error: true, message: e.message }; }
        }
        yield { type: 'tool-result', toolCallId: toolId, toolName: name, args, result };
        toolResultParts.push({ functionResponse: { name, response: result || {} } });
      }
      yield { type: 'finish-step', finishReason: 'tool-calls' };
      if (onStepFinish) await onStepFinish();
      contents.push({ role: 'model', parts: allParts });
      contents.push({ role: 'user', parts: toolResultParts });
    } catch (err) {
      yield { type: 'error', error: err };
      yield { type: 'finish-step', finishReason: 'error' };
      if (onStepFinish) await onStepFinish();
      return;
    }
  }
}

module.exports = { streamGemini, convertMessages, convertTools, cleanSchema };
