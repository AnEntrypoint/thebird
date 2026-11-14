const API_VERSION = 1;
const registry = new Map();
let mounted = null;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};

const safeId = (id) => {
  const value = String(id ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) throw new Error(`invalid feature id: ${value || '(empty)'}`);
  return value;
};

const button = (spec) => {
  const node = element('button', 'thebird-feature-button', spec.label ?? spec.text ?? 'Run');
  node.type = 'button';
  node.dataset.featureAction = spec.id ?? spec.label ?? spec.text ?? 'run';
  node.addEventListener('click', () => globalThis.THEBIRD_FEATURES?.emit(`feature:${spec.id ?? 'button'}`, { id: spec.id ?? spec.label ?? spec.text }));
  return node;
};

const canvas = (spec) => {
  const node = element('canvas', 'thebird-feature-canvas');
  node.width = Number(spec.width ?? 240);
  node.height = Number(spec.height ?? 90);
  const context = node.getContext('2d');
  if (context) {
    context.fillStyle = spec.color ?? '#6fe1c6';
    context.fillRect(0, 0, node.width, node.height);
    context.fillStyle = '#101820';
    context.font = '16px sans-serif';
    context.fillText(spec.text ?? 'fx canvas', 12, 28);
  }
  return node;
};

const renderNode = (spec) => {
  if (spec === null || spec === undefined || typeof spec === 'string' || typeof spec === 'number') return document.createTextNode(String(spec ?? ''));
  if (Array.isArray(spec)) {
    const group = element('div', 'thebird-feature-group');
    for (const child of spec) group.append(renderNode(child));
    return group;
  }
  if (typeof spec !== 'object') return document.createTextNode(String(spec));
  const type = spec.type ?? spec.tag ?? 'div';
  if (type === 'button') return button(spec);
  if (type === 'canvas') return canvas(spec);
  if (!/^[a-z][a-z0-9-]*$/.test(type)) throw new Error(`invalid feature element: ${type}`);
  const node = element(type, `thebird-feature-${type}`, spec.text);
  for (const child of spec.children ?? []) node.append(renderNode(child));
  return node;
};

const render = (entry) => {
  entry.card.replaceChildren();
  entry.card.dataset.featureId = entry.id;
  entry.card.dataset.featureSource = entry.source;
  const title = element('h2', 'thebird-feature-title', entry.spec.title ?? entry.id);
  const close = element('button', 'thebird-feature-close', '×');
  close.type = 'button';
  close.ariaLabel = `Remove ${entry.id}`;
  close.addEventListener('click', () => globalThis.THEBIRD_FEATURES.remove(entry.id));
  const header = element('header', 'thebird-feature-header');
  header.append(title, close);
  entry.card.append(header);
  if (entry.spec.description) entry.card.append(element('p', 'thebird-feature-description', entry.spec.description));
  const body = entry.spec.body ?? entry.spec.content ?? [];
  for (const child of Array.isArray(body) ? body : [body]) entry.card.append(renderNode(child));
  if (entry.spec.status) entry.card.append(element('p', 'thebird-feature-status', entry.spec.status));
};

const ensureMount = () => {
  if (mounted?.isConnected) return mounted;
  mounted = document.getElementById('features') ?? element('aside', 'thebird-features');
  mounted.id = 'features';
  mounted.dataset.featureApi = String(API_VERSION);
  if (!mounted.isConnected) document.body.append(mounted);
  return mounted;
};

const listeners = new Map();

const api = {
  version: API_VERSION,
  mount: ensureMount,
  register(id, spec = {}, { source = 'page' } = {}) {
    const key = safeId(id);
    const mount = ensureMount();
    let card = registry.get(key)?.card;
    if (!card) {
      card = element('article', 'thebird-feature-card');
      mount.append(card);
    }
    const entry = { id: key, spec, source, card };
    registry.set(key, entry);
    render(entry);
    mount.dataset.featureCount = String(registry.size);
    document.body.dataset.featureCount = String(registry.size);
    api.emit('feature:registered', { id: key, source });
    return key;
  },
  update(id, patch = {}) {
    const entry = registry.get(safeId(id));
    if (!entry) throw new Error(`unknown feature: ${id}`);
    entry.spec = { ...entry.spec, ...patch };
    render(entry);
    api.emit('feature:updated', { id: entry.id, source: entry.source });
    return entry.id;
  },
  remove(id) {
    const key = safeId(id);
    const entry = registry.get(key);
    if (!entry) return false;
    entry.card.remove();
    registry.delete(key);
    const mount = ensureMount();
    mount.dataset.featureCount = String(registry.size);
    document.body.dataset.featureCount = String(registry.size);
    api.emit('feature:removed', { id: key, source: entry.source });
    return true;
  },
  list() {
    return [...registry.values()].map(({ id, source, spec }) => ({ id, source, spec }));
  },
  clear() {
    for (const id of [...registry.keys()]) api.remove(id);
  },
  on(name, handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
    return () => listeners.get(name)?.delete(handler);
  },
  emit(name, detail) {
    for (const handler of listeners.get(name) ?? []) handler(detail);
    document.dispatchEvent(new CustomEvent(name, { detail }));
  },
};

globalThis.THEBIRD_FEATURES = api;
ensureMount();
export default api;
export { API_VERSION, api as features };
