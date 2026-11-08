import { gitBuiltin } from './git-in-page.js';
import { sqliteBuiltin } from './sqlite-in-txiki.js';
import { pythonBuiltin, pipBuiltin } from './python-in-page.js';
import { curlBuiltin } from './curl-in-page.js';
import { qjsBuiltin } from './qjs-in-txiki.js';
import { tjsBuiltin } from './txiki-in-page.js';
import { nodeBuiltin } from './node-in-txiki.js';

export const BUILTIN_NAMES = ['git', 'sqlite3', 'python3', 'pip', 'qjs', 'tjs', 'node', 'curl', 'wget'];

const RUNNERS = {
  git: ({ argv }) => gitBuiltin(argv),
  sqlite3: ({ argv, cwd }) => sqliteBuiltin(argv, cwd),
  python3: ({ argv, signal }) => pythonBuiltin(argv, signal),
  pip: ({ argv, signal }) => pipBuiltin(argv, signal),
  qjs: ({ argv, signal, timeoutMs }) => qjsBuiltin(argv, { signal, timeoutMs }),
  tjs: ({ argv, cwd, signal, timeoutMs }) => tjsBuiltin(argv, cwd, { signal, timeoutMs }),
  node: ({ argv, cwd, signal, timeoutMs }) => nodeBuiltin(argv, cwd, { signal, timeoutMs }),
  curl: ({ argv, cwd, signal }) => curlBuiltin('curl', argv, cwd, signal),
  wget: ({ argv, cwd, signal }) => curlBuiltin('wget', argv, cwd, signal),
};

export const runBuiltin = (name, argv, { cwd, signal, timeoutMs } = {}) => RUNNERS[name]({ argv, cwd, signal, timeoutMs });
