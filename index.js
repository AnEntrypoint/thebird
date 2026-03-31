const { getClient } = require('./lib/client');
const { GeminiError, withRetry } = require('./lib/errors');
const { convertMessages, convertTools, cleanSchema, extractModelId, buildConfig } = require('./lib/convert');

function streamGemini({ model, system, messages, tools, onStepFinish, apiKey,
  temperature, maxOutputTokens, topP, topK, safetySettings }) {
  return {
    fullStream: createFullStream({ model, system, messages, tools, onStepFinish, apiKey,
      temperature, maxOutputTokens, topP, topK, safetySettings }),
    warnings: Promise.resolve([])
  };
}

async function* createFullStream({ model, system, messages, tools, onStepFinish, apiKey,
  temperature, maxOutputTokens, topP, topK, safetySettings }) {
  const client = getClient(apiKey);
  const modelId = extractModelId(model);
  let contents = convertMessages(messages);
  const { config } = buildConfig({ system, tools, temperature, maxOutputTokens, topP, topK, safetySettings });

  while (true) {
    yield { type: 'start-step' };
    try {
      const allParts = await withRetry(async () => {
        const stream = client.models.generateContentStream({ model: modelId, contents, config });
        const parts = [];
        for await (const chunk of await stream) {
          for (const candidate of (chunk.candidates || [])) {
            for (const part of (candidate.content?.parts || [])) {
              parts.push(part);
              if (part.text && !part.thought) yield { type: 'text-delta', textDelta: part.text };
            }
          }
        }
        return parts;
      });

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

async function generateGemini({ model, system, messages, tools, apiKey,
  temperature, maxOutputTokens, topP, topK, safetySettings }) {
  const client = getClient(apiKey);
  const modelId = extractModelId(model);
  let contents = convertMessages(messages);
  const { config } = buildConfig({ system, tools, temperature, maxOutputTokens, topP, topK, safetySettings });

  while (true) {
    const response = await withRetry(() =>
      client.models.generateContent({ model: modelId, contents, config })
    );
    const candidate = response.candidates?.[0];
    if (!candidate) throw new GeminiError('No candidates returned', { retryable: false });
    const allParts = candidate.content?.parts || [];
    const fcParts = allParts.filter(p => p.functionCall);

    if (fcParts.length === 0) {
      const text = allParts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      return { text, parts: allParts, response };
    }

    const toolResultParts = [];
    const toolResults = [];
    for (const part of fcParts) {
      const name = part.functionCall.name;
      const args = part.functionCall.args || {};
      const toolDef = tools?.[name];
      let result = toolDef ? null : { error: true, message: 'Tool not found: ' + name };
      if (toolDef?.execute) {
        try { result = await toolDef.execute(args); }
        catch (e) { result = { error: true, message: e.message }; }
      }
      toolResults.push({ name, args, result });
      toolResultParts.push({ functionResponse: { name, response: result || {} } });
    }
    contents.push({ role: 'model', parts: allParts });
    contents.push({ role: 'user', parts: toolResultParts });
  }
}

module.exports = { streamGemini, generateGemini, convertMessages, convertTools, cleanSchema, GeminiError };
