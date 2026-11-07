const SHIMS = {
  'node:fs': '/web/shims/fs.js',
  'node:fs/promises': '/web/shims/fs-promises.js',
  'node:path': '/web/shims/path.js',
  'node:crypto': '/web/shims/crypto.js',
};
const STUBS = '/web/shims/node-stubs.js';

export function shimFor(specifier) {
  return SHIMS[specifier] ?? STUBS;
}

export function rewriteSpecifiers(source) {
  return source.replace(/from '(node:[^']+|acorn)'/g, (match, specifier) => `from '${shimFor(specifier)}'`);
}
