const API_URL = new URL('./features.json', import.meta.url).href;

const call = async (payload) => {
  const features = globalThis.THEBIRD_FEATURES;
  if (!features) throw new Error('THEBIRD_FEATURES is not mounted yet');
  const { op, id, spec, patch, source } = payload;
  if (op === 'register') return features.register(id, spec ?? {}, { source: source ?? 'txiki' });
  if (op === 'update') return features.update(id, patch ?? {});
  if (op === 'remove') return features.remove(id);
  if (op === 'list') return features.list();
  if (op === 'clear') return features.clear();
  throw new Error(`unknown feature operation: ${op}`);
};

const manifest = {
  version: 1,
  api: 'THEBIRD_FEATURES',
  module: new URL('./features.js', import.meta.url).pathname,
  bridge: new URL('./features-bridge.js', import.meta.url).pathname,
  endpoints: [new URL('./features.json', import.meta.url).pathname, '/__thebird/registry', '/__thebird/events', '/__thebird/mcp'],
  operations: ['register', 'update', 'remove', 'list', 'clear', 'mcp', 'progress'],
  demo: 'fx-visible-demo',
};

export async function applyFeatureRequest(payload) {
  if (payload?.version && payload.version !== manifest.version) throw new Error(`feature API version ${payload.version} is not supported`);
  return call(payload ?? {});
}

export async function loadFeatureRequests(url = API_URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`feature manifest returned ${response.status}`);
  const document = await response.json();
  const requests = Array.isArray(document) ? document : document.requests ?? [];
  for (const request of requests) await applyFeatureRequest(request);
  return requests.length;
}

globalThis.THEBIRD_FEATURE_BRIDGE = { manifest, applyFeatureRequest, loadFeatureRequests };
export default { manifest, applyFeatureRequest, loadFeatureRequests };
export { manifest };
