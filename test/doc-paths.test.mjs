import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_DOCS = ['AGENTS.md', 'ARCHITECTURE.md', 'README.md'];
const REPO_PATH = /(?:^|[\s\x60(\["'])((?:web|scripts|src|test|docs|bin|spikes|sdk|vendor)\/[A-Za-z0-9_.\/-]*[A-Za-z0-9_])/g;

test('every repo path the live docs name exists in the tree', () => {
  const missing = [];
  for (const doc of LIVE_DOCS) {
    for (const match of readFileSync(join(root, doc), 'utf8').matchAll(REPO_PATH)) {
      const named = match[1].replace(/\/$/, '');
      if (!existsSync(join(root, named))) missing.push(doc + ' names ' + named);
    }
  }
  assert.deepEqual(missing, []);
});
