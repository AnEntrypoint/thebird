import { gitBuiltin } from './git-in-page.js';
import { sqliteBuiltin } from './sqlite-in-txiki.js';
import { pythonBuiltin, pipBuiltin } from './python-in-page.js';
import { curlBuiltin } from './curl-in-page.js';
import { qjsBuiltin } from './qjs-in-txiki.js';
import { tjsBuiltin } from './txiki-in-page.js';
import { nodeBuiltin } from './node-in-txiki.js';
import { fxBuiltin } from './fx-in-page.js';
import { playwriterBuiltin } from './playwriter-in-page.js';
import { npmBuiltin, npxBuiltin } from './npm-in-txiki.js';
import { applyFeatureRequest } from './features-bridge.js';

export const BUILTIN_NAMES = ['git', 'sqlite3', 'python3', 'pip', 'qjs', 'tjs', 'node', 'npm', 'npx', 'curl', 'wget', 'fx', 'playwriter', 'feature'];

const RUNNERS = {
  git: ({ argv }) => gitBuiltin(argv),
  sqlite3: ({ argv, cwd }) => sqliteBuiltin(argv, cwd),
  python3: ({ argv, signal }) => pythonBuiltin(argv, signal),
  pip: ({ argv, signal }) => pipBuiltin(argv, signal),
  qjs: ({ argv, signal, timeoutMs }) => qjsBuiltin(argv, { signal, timeoutMs }),
  tjs: ({ argv, cwd, signal, timeoutMs }) => tjsBuiltin(argv, cwd, { signal, timeoutMs }),
  node: ({ argv, cwd, signal, timeoutMs }) => nodeBuiltin(argv, cwd, { signal, timeoutMs }),
  npm: ({ argv, cwd, signal, timeoutMs }) => npmBuiltin(argv, cwd, { signal, timeoutMs }),
  npx: ({ argv, cwd, signal, timeoutMs }) => npxBuiltin(argv, cwd, { signal, timeoutMs }),
  curl: ({ argv, cwd, signal }) => curlBuiltin('curl', argv, cwd, signal),
  wget: ({ argv, cwd, signal }) => curlBuiltin('wget', argv, cwd, signal),
  fx: ({ argv, signal }) => fxBuiltin(argv, { signal }),
  playwriter: ({ argv, signal }) => playwriterBuiltin(argv, { signal }),
  feature: async ({ argv }) => JSON.stringify(await applyFeatureRequest(JSON.parse(argv[0]))),
};

export const runBuiltin = (name, argv, { cwd, signal, timeoutMs } = {}) => RUNNERS[name]({ argv, cwd, signal, timeoutMs });
