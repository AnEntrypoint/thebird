const { getClient } = require('./lib/client');
const { GeminiError, withRetry } = require('./lib/errors');
const { convertMessages, convertTools, cleanSchema, extractModelId, buildConfig } = require('./lib/convert');
const { loadConfig } = require('./lib/config');
const { route } = require('./lib/router');
const { resolveTransformers, applyRequestTransformers } = require('./lib/transformers');
const openaiProv = require('./lib/providers/openai');

function streamGemini({ model, system, messages, tools, onStepFinish, apiKey,
  temperature, maxOutputTokens, topP, topK, safetySettings, responseModalities }) {
  return {
    fullStream: createFullStream({ model, system, messages, tools, onStepFinish, apiKey, temperature, maxOutputTokens, topP, topK, safetySettings, responseModalities }),
    warnings: Promise.resolve([])
  };
}

async function* createFullStream({ model, system, messages, tools, onStepFinish, apiKey, temperature, maxOutputTokens, topP, topK, safetySettings, responseModalities }) {
  const client = getClient(apiKey);
  const modelId = extractModelId(model);
  let contents = convertMessages(messages);
  const { config } = buildConfig({ system, tools, temperature, maxOutputTokens, topP, topK, safetySettings, responseModalities });
  while (true) {
    yield { type: 'start-step' };
    try {
      const stream = await withRetry(() => client.models.generateContentStream({ model: modelId, contents, config }));
      const allParts = [];
      for await (const chunk of stream) {
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
        toolResultParts.push({ functionResponse: { name, response: typeof result === 'string' ? { output: result } : (result || {}) } });
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

async function generateGemini({ model, system, messages, tools, apiKey, temperature, maxOutputTokens, topP, topK, safetySettings, responseModalities }) {
  const client = getClient(apiKey);
  const modelId = extractModelId(model);
  let contents = convertMessages(messages);
  const { config } = buildConfig({ system, tools, temperature, maxOutputTokens, topP, topK, safetySettings, responseModalities });
  while (true) {
    const response = await withRetry(() => client.models.generateContent({ model: modelId, contents, config }));
    const candidate = response.candidates?.[0];
    if (!candidate) throw new GeminiError('No candidates returned', { retryable: false });
    const allParts = candidate.content?.parts || [];
    const fcParts = allParts.filter(p => p.functionCall);
    if (fcParts.length === 0) {
      const text = allParts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      return { text, parts: allParts, response };
    }
    const toolResultParts = [];
    for (const part of fcParts) {
      const name = part.functionCall.name;
      const args = part.functionCall.args || {};
      const toolDef = tools?.[name];
      let result = toolDef ? null : { error: true, message: 'Tool not found: ' + name };
      if (toolDef?.execute) {
        try { result = await toolDef.execute(args); }
        catch (e) { result = { error: true, message: e.message }; }
      }
      toolResultParts.push({ functionResponse: { name, response: typeof result === 'string' ? { output: result } : (result || {}) } });
    }
    contents.push({ role: 'model', parts: allParts });
    contents.push({ role: 'user', parts: toolResultParts });
  }
}

function isGeminiProvider(p) {
  return p.name === 'gemini' || (p.api_base_url || '').includes('generativelanguage.googleapis.com');
}

function findProvider(providers, providerName, modelName) {
  if (providerName) return providers.find(p => p.name === providerName);
  if (modelName) return providers.find(p => (p.models || []).includes(modelName));
  return providers[0];
}

function buildOpenAIUrl(base) {
  const clean = (base || '').replace(/\/$/g, '');
  return clean.includes('/completions') ? clean : clean + '/chat/completions';
}

function resolveForProvider(provider, model, customMap) {
  const useList = provider.transformer?.[model]?.use || provider.transformer?.use || [];
  return resolveTransformers(useList, customMap);
}

async function* routerStream(params, resolver) {
  const { provider, actualModel, transformers } = await resolver(params);
  if (isGeminiProvider(provider)) {
    yield* createFullStream({ ...params, model: actualModel, apiKey: provider.api_key || params.apiKey });
  } else {
    const oaiMsgs = openaiProv.convertMessages(params.messages, params.system);
    const oaiTools = openaiProv.convertTools(params.tools);
    let req = { messages: oaiMsgs, model: actualModel, max_tokens: params.maxOutputTokens || 8192, temperature: params.temperature ?? 0.5 };
    if (oaiTools) req.tools = oaiTools;
    req = applyRequestTransformers(req, transformers);
    yield* openaiProv.streamOpenAI({ url: buildOpenAIUrl(provider.api_base_url), apiKey: provider.api_key, headers: req._extraHeaders, body: req, tools: params.tools, onStepFinish: params.onStepFinish });
  }
}

function createRouter(config) {
  const providers = config.Providers || config.providers || [];
  const routerCfg = config.Router || {};
  async function resolve(params) {
    const { providerName, modelName } = await route(params, routerCfg, config.customRouter);
    const provider = findProvider(providers, providerName, modelName) || providers[0];
    if (!provider) throw new Error('[thebird] no provider configured');
    const actualModel = modelName || (provider.models || [])[0] || extractModelId(params.model) || 'gemini-2.0-flash';
    const transformers = resolveForProvider(provider, actualModel, config._transformers);
    return { provider, actualModel, transformers };
  }
  return {
    stream(params) { return { fullStream: routerStream(params, resolve), warnings: Promise.resolve([]) }; },
    async generate(params) {
      const { provider, actualModel, transformers } = await resolve(params);
      if (isGeminiProvider(provider)) return generateGemini({ ...params, model: actualModel, apiKey: provider.api_key || params.apiKey });
      const oaiMsgs = openaiProv.convertMessages(params.messages, params.system);
      const oaiTools = openaiProv.convertTools(params.tools);
      let req = { messages: oaiMsgs, model: actualModel, max_tokens: params.maxOutputTokens || 8192, temperature: params.temperature ?? 0.5 };
      if (oaiTools) req.tools = oaiTools;
      req = applyRequestTransformers(req, transformers);
      return openaiProv.generateOpenAI({ url: buildOpenAIUrl(provider.api_base_url), apiKey: provider.api_key, headers: req._extraHeaders, body: req, tools: params.tools });
    }
  };
}

function streamRouter(params) {
  const config = loadConfig(params.configPath);
  if (!(config.Providers || config.providers)?.length) return streamGemini(params);
  return createRouter(config).stream(params);
}

async function generateRouter(params) {
  const config = loadConfig(params.configPath);
  if (!(config.Providers || config.providers)?.length) return generateGemini(params);
  return createRouter(config).generate(params);
}

const { cloudGenerate, streamCloud, cloudStream } = require('./lib/cloud-generate');
const { ensureAuth, login: oauthLogin } = require('./lib/oauth');

module.exports = { streamGemini, generateGemini, streamRouter, generateRouter, createRouter, convertMessages, convertTools, cleanSchema, GeminiError, cloudGenerate, streamCloud, cloudStream, ensureAuth, oauthLogin };
