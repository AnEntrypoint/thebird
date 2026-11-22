import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { NODE_TEST_CONTEXT, ...childEnv } = process.env;

test('the node tests leave nothing in their temp directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scratch-check-'));
  try {
    const files = readdirSync(here).filter((name) => name.endsWith('.test.mjs') && name !== 'scratch.test.mjs').map((name) => join(here, name));
    const run = spawnSync(process.execPath, ['--test', ...files], { env: { ...childEnv, TMPDIR: dir }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout.slice(-2000));
    assert.deepEqual(readdirSync(dir).filter((name) => name !== 'node-compile-cache'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
