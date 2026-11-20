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

test('README says a pasted line break becomes a space, as the pty adapter pastes it', () => {
  assert.match(readme, /Each pasted line break becomes a space/);
  const source = readFileSync(join(root, 'web/pty-adapter.js'), 'utf8');
  const [, expression] = source.match(/const PASTE_BREAKS = (\/.*\/g);/);
  const pattern = new Function('return ' + expression)();
  assert.equal('one\ntwo\r\nthree\tfour'.replace(pattern, ' '), 'one two three four');
});
