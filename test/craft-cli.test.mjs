import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('craft open on a missing file exits non-zero and reports ok false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-cli-'));
  const result = spawnSync(process.execPath, [join(root, 'bin/thebird-craft.js'), 'open', join(dir, 'missing.pdf')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
