import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(root, 'scripts', 'reds.mjs');
const scratch = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'reds-anchors-'));

test.after(() => rmSync(scratch, { recursive: true, force: true }));

const check = (env) => spawnSync(process.execPath, [runner, '--anchors'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });

test('every anchor in scripts/reds.json is present once, and the check mutates no file', () => {
  const before = readFileSync(join(root, 'web', 'shell-core.js'), 'utf8');
  const run = check({});
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^anchors: all \d+ unique$/m);
  assert.equal(readFileSync(join(root, 'web', 'shell-core.js'), 'utf8'), before);
});

test('a missing anchor and a repeated anchor are both reported, and the check exits non-zero', () => {
  const table = join(scratch, 'broken.json');
  writeFileSync(table, JSON.stringify([
    { name: 'gone', file: 'web/shell-core.js', anchor: 'no such text anywhere in this file zz', replace: 'x', command: ['true'] },
    { name: 'twice', file: 'test/fx-host.test.mjs', anchor: 'test(', replace: 'x', command: ['true'] },
    { name: 'once', file: 'scripts/reds.mjs', anchor: 'const root = join(', replace: 'x', command: ['true'] },
  ]));
  const run = check({ REDS_TABLE: table });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /^RED gone ANCHOR 0$/m);
  assert.match(run.stdout, /^RED twice ANCHOR [2-9]\d*$/m);
  assert.doesNotMatch(run.stdout, /RED once/);
  assert.match(run.stdout, /^anchors: 2 not unique or missing$/m);
});
