import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (path) => pathToFileURL(join(root, path)).href;

globalThis.window ??= globalThis;
globalThis.location ??= { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1' };
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.postMessage ??= () => {};

const bashkit = await import(url('web/vendor/bashkit/index.js'));
await bashkit.initBashkit(readFileSync(join(root, 'web/vendor/bashkit/bashkit_wasm_bg.wasm')));
const { createShell } = await import(url('web/bash-shell.js'));
const shell = await createShell({ cwd: '/' });
const run = (command) => shell.run(command);

test('sort at the typed prompt orders lines in en_US collation, as GNU sort does', async () => {
  const r = await run("printf 'b\\na\\nB\\n' | sort; echo rc=$?");
  assert.equal(r.output, 'a\nb\nB\nrc=0\n');
});

test('sort at the typed prompt reads a file operand, as GNU sort does', async () => {
  await run("mkdir -p /srtchk && printf 'b\\na\\n' > /srtchk/f");
  const r = await run('sort /srtchk/f');
  assert.equal(r.output, 'a\nb\n');
});

test('sort at the typed prompt reports a missing file as GNU sort does, with status 2', async () => {
  const r = await run('sort /srtchk/none; echo rc=$?');
  assert.equal(r.output, 'rc=2\nsort: cannot read: /srtchk/none: No such file or directory\n');
});

test('touch at the typed prompt creates a file and returns 0 for a new or an existing file, as GNU touch does', async () => {
  const r = await run("mkdir -p /tchk && cd /tchk && touch new.txt; echo rc=$?; touch new.txt; echo rc=$?; cd /; ls /tchk");
  assert.equal(r.output, 'rc=0\nrc=0\nnew.txt\n');
});

test('touch -c at the typed prompt creates nothing, as GNU touch does', async () => {
  const r = await run('touch -c /tchk/none.txt; echo rc=$?; ls /tchk');
  assert.equal(r.output, 'rc=0\nnew.txt\n');
});

test('touch at the typed prompt reports a missing directory as GNU touch does, with status 1', async () => {
  const r = await run('touch /tchk/nodir/x; echo rc=$?');
  assert.equal(r.output, "rc=1\ntouch: cannot touch '/tchk/nodir/x': No such file or directory\n");
});

test('touch -c with no file reports the missing operand as GNU touch does, with status 1', async () => {
  const r = await run('touch -c; echo rc=$?');
  assert.equal(r.output, "rc=1\ntouch: missing file operand\nTry 'touch --help' for more information.\n");
});
