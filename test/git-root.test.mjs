import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from '../web/shims/fs.js';
import { repositoryDirFor } from '../web/git-in-page.js';

const fake = (paths) => (path) => paths.includes(path);

test('init uses the working directory even when a parent holds a repository', () => {
  assert.equal(repositoryDirFor('init', '/w/k', fake(['/w/.git'])), '/w/k');
});

test('a verb in a subdirectory of a repository uses the repository root', () => {
  assert.equal(repositoryDirFor('status', '/w/k/deep', fake(['/w/.git'])), '/w');
});

test('the nearest ancestor with a .git directory is the repository', () => {
  assert.equal(repositoryDirFor('log', '/w/k/deep', fake(['/w/.git', '/w/k/.git'])), '/w/k');
});

test('a verb with no repository above it uses the working directory', () => {
  assert.equal(repositoryDirFor('status', '/w/k', fake([])), '/w/k');
});

test('a verb in a repository root uses that root', () => {
  assert.equal(repositoryDirFor('add', '/w', fake(['/w/.git'])), '/w');
});

test('the in-page fs shim finds a repository created in the store', () => {
  mkdirSync('/git-root-test/repo/.git', { recursive: true });
  mkdirSync('/git-root-test/repo/sub/deep', { recursive: true });
  mkdirSync('/git-root-test/bare/inner', { recursive: true });
  assert.equal(existsSync('/git-root-test/repo/.git'), true);
  assert.equal(repositoryDirFor('status', '/git-root-test/repo/sub/deep', existsSync), '/git-root-test/repo');
  assert.equal(repositoryDirFor('init', '/git-root-test/repo/sub', existsSync), '/git-root-test/repo/sub');
  assert.equal(repositoryDirFor('status', '/git-root-test/bare/inner', existsSync), '/git-root-test/bare/inner');
});
