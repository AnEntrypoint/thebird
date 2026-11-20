import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const program = readFileSync(join(root, 'web/git-program.js'), 'utf8');

test('git init in the page prints the same line as real git, with the repository directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'git-init-message-'));
  const real = execFileSync('git', ['init', dir], { encoding: 'utf8' }).trim();
  assert.equal(real, `Initialized empty Git repository in ${dir}/.git/`);
  assert.ok(program.includes('return `Initialized empty Git repository in ${dir}/.git/`;'));
});
