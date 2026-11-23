export function createHost({ host, modules, tools }) {
  class FxHostError extends Error {
    constructor(name, code, message, extra = {}) {
      super(message);
      this.name = name;
      this.code = code;
      Object.assign(this, extra);
    }
  }
  const unsupported = (name) => new FxHostError('FxUnsupported', 'ERR_FX_UNSUPPORTED', name + ' is not provided by the ' + host + ' host', { target: name });
  const guarded = (name, table) => new Proxy(Object.freeze({ ...table }), {
    get: (target, key) => {
      if (typeof key !== 'string' || key in target) return target[key];
      throw unsupported(name + '.' + key);
    },
  });
  return Object.freeze({
    version: Object.freeze({ interface: 1, minor: 0, host }),
    capabilities: Object.freeze([...(Object.keys(tools).length ? ['tools'] : []), ...Object.keys(modules)]),
    tools: guarded('tools', tools),
    verbs: guarded('verbs', {}),
    modules: Object.freeze({ ...modules }),
  });
}
