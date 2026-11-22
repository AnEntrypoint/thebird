import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const listed = (...flags) => spawnSync(process.execPath, [join(root, 'scripts', 'witness.mjs'), '--list', ...flags], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line && !line.startsWith('browser cleanup'));

test('--part=i/n splits the group list into n disjoint slices that together are every group', () => {
  const all = listed();
  const slices = [1, 2, 3].map((index) => listed('--part=' + index + '/3'));
  assert.deepEqual(slices.flat().sort(), [...all].sort());
  assert.equal(new Set(slices.flat()).size, all.length);
  assert.ok(slices.every((slice) => slice.length >= Math.floor(all.length / 3)));
});
