import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const limits = readme.slice(readme.indexOf('## Limits'), readme.indexOf('## Keys'));

test('README does not say node exits 127, because node is the in-page builtin', () => {
  assert.doesNotMatch(limits, /node[^\n]*exits? 127/);
  assert.match(readFileSync(join(root, 'web/builtins.js'), 'utf8'), /BUILTIN_NAMES = \[[^\]]*'node'/);
});
