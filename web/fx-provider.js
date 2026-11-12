export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
const GATEWAY_PATHS = ['/v4/ai/language-model', '/v3/ai/language-model'];
const CLI_MODEL_METADATA = {
  'claude-hy4[1m]': { contextWindow: 1000000, maxOutputTokens: 64000, supportsToolUse: true, supportsVision: true },
};

export const providerOf = (options) => {
  if (options.provider) return options.provider;
  const url = options.gatewayChatUrl ? new URL(options.gatewayChatUrl) : null;
  if (!url || url.hostname === 'ai-gateway.vercel.sh' || GATEWAY_PATHS.some((path) => url.pathname.endsWith(path))) return undefined;
  const baseUrl = options.gatewayChatUrl.replace(/\/chat\/completions\/?$/, '');
  const model = options.model ?? DEFAULT_MODEL;
  return { name: 'gy4', baseUrl, models: { [model]: options.modelMetadata ?? CLI_MODEL_METADATA[model] ?? {} } };
};

const snakeCase = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export const providerRegistry = (provider) => JSON.stringify({
  [provider.name]: {
    protocol: 'openai-chat-completions',
    base_url: provider.baseUrl,
    auth: { type: 'none' },
    model_metadata: Object.fromEntries(Object.entries(provider.models).map(([model, metadata]) => [
      model,
      Object.fromEntries(Object.entries(metadata).map(([key, value]) => [snakeCase(key), value])),
    ])),
  },
});

export const providerFetch = (provider, apiKey) => (url, init = {}) => {
  if (apiKey === undefined || !String(url).startsWith(`${provider.baseUrl}/`)) return fetch(url, init);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${apiKey}`);
  return fetch(url, { ...init, headers });
};
