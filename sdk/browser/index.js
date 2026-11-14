const api = {
  async registry() { return (await fetch('/__thebird/registry')).json(); },
  async settings(id) { return (await fetch('/sites/' + id + '/settings')).json(); },
  async saveSettings(id, values) { return (await fetch('/sites/' + id + '/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) })).json(); },
  async mcp(id, method, params = {}) { return (await fetch('/__thebird/mcp/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })).json(); },
  async progress(payload) { return (await fetch('/__thebird/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json(); },
  events(handler) { const source = new EventSource('/__thebird/events'); source.addEventListener('webservers', (event) => handler(JSON.parse(event.data))); return source; },
  feature(payload) { return globalThis.THEBIRD_FEATURES?.applyFeatureRequest?.(payload) ?? globalThis.thebird?.applyFeatureRequest?.(payload); },
};
globalThis.THEBIRD_WEBSERVERS = api;
export default api;
export { api };
