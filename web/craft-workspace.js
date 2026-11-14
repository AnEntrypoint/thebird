import sdk from '../sdk/browser/index.js';

const workspace = document.getElementById('craft-workspace') ?? document.createElement('section');
workspace.id = 'craft-workspace';
workspace.dataset.workspace = 'documents';
workspace.dataset.lazy = 'idle';
if (!workspace.isConnected) document.body.append(workspace);

const card = (event) => {
  const id = 'craft-' + (event.id ?? 'task');
  const body = [
    { type: 'p', text: 'File: ' + (event.file ?? 'unknown') },
    { type: 'p', text: 'App: ' + (event.id ?? 'unknown') },
    { type: 'p', text: 'Status: ' + (event.status ?? 'working') },
    { type: 'pre', text: (event.stdout ?? '').slice(0, 1200) },
  ];
  if (event.preview) body.push({ type: 'img', src: event.preview, alt: 'document preview' });
  globalThis.THEBIRD_FEATURES?.register(id, {
    title: 'Document workspace',
    description: 'Live document being worked on',
    status: event.status ?? 'working',
    body,
  }, { source: 'craft' });
  workspace.dataset.lazy = 'active';
  workspace.dataset.document = id;
};

const api = {
  async apps() { return (await fetch('/__thebird/craft')).json(); },
  async intent(text) { return (await fetch('/__thebird/craft/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).json(); },
  async task(text, file, method) { return (await fetch('/__thebird/craft/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, file, method }) })).json(); },
  async open(file, app) { const appId = app ?? (await api.intent(file)).app; return sdk.mcp(appId, 'open', { file }); },
  async call(app, method, params = {}) { return sdk.mcp(app, method, params); },
  display: card,
};

globalThis.THEBIRD_CRAFT = api;
sdk.events((event) => { if (event.type === 'document' || event.type === 'progress') card(event); });
export default api;
export { api };
