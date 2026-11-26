import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const LF = String.fromCharCode(10);

const parsesAsModule = (program) => {
  const scratch = mkdtempSync(join(root, '.thebird', 'shell-program-'));
  const file = join(scratch, 'program.mjs');
  try {
    writeFileSync(file, program);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return null;
  } catch (error) {
    return String(error.stderr);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

test('the shell program that shell-in-txiki.js concatenates parses as one module', () => {
  const listed = readFileSync(join(web, 'shell-in-txiki.js'), 'utf8').match(/^const MODULES = \[([^\]]*)\];/m);
  assert.ok(listed, 'the MODULES list is not found in shell-in-txiki.js');
  const modules = [...listed[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(modules.includes('shell-core.js'), 'shell-core.js is not in the MODULES list');
  const program = modules
    .map((name) => readFileSync(join(web, name), 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, ''))
    .join(LF);
  assert.equal(parsesAsModule(program), null);
});
