import * as fs from './shims/fs.js';
import * as fsPromises from './shims/fs-promises.js';
import * as path from './shims/path.js';
import * as crypto from './shims/crypto.js';
import { Buffer } from './shims/buffer.js';

const INTERFACE = 1;
const MINOR = 0;

class FxHostError extends Error {
  constructor(name, code, message, extra = {}) {
    super(message);
    this.name = name;
    this.code = code;
    Object.assign(this, extra);
  }
}

export const unsupported = (name) => new FxHostError('FxUnsupported', 'ERR_FX_UNSUPPORTED', name + ' is not provided by the thebird host', { target: name });

const timerPromises = {
  setTimeout: (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value)),
  scheduler: { wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
};

const MODULES = [
  ['fs', fs],
  ['fs/promises', fsPromises],
  ['path', path],
  ['crypto', crypto],
  ['buffer', { Buffer }],
  ['timers/promises', timerPromises],
];

const TOOLS = {
  read_file: ({ path: file }) => fs.readFileSync(file, 'utf8'),
  write_file: ({ path: file, content }) => {
    fs.writeFileSync(file, content);
    return 'wrote ' + file;
  },
  FetchURL: async ({ url }) => (await fetch(url)).text(),
};

const guarded = (name, table) => new Proxy(Object.freeze({ ...table }), {
  get: (target, key) => {
    if (typeof key !== 'string' || key in target) return target[key];
    throw unsupported(name + '.' + key);
  },
});

export const modules = Object.freeze(Object.fromEntries(MODULES.map(([name, implementation]) => [name, implementation])));

export const host = Object.freeze({
  version: Object.freeze({ interface: INTERFACE, minor: MINOR, host: 'thebird' }),
  capabilities: Object.freeze(['tools', ...Object.keys(modules)]),
  tools: guarded('tools', TOOLS),
  verbs: guarded('verbs', {}),
  modules,
});

export const { version, capabilities, tools, verbs } = host;
export default host;
