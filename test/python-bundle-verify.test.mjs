import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unpack } from '../web/python-bundle.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function bundle(files, { format = 'pyodide-minimal/1', digests = {} } = {}) {
  let offset = 0;
  const entries = files.map(([name, data]) => {
    const entry = { name, offset, bytes: data.length, sha256: digests[name] ?? sha(data) };
    offset += data.length;
    return entry;
  });
  const header = Buffer.from(JSON.stringify({ format, files: entries }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  return Buffer.concat([length, header, ...files.map(([, data]) => Buffer.from(data))]);
}

test('a file whose bytes no longer match the manifest digest is refused', () => {
  const raw = bundle([['pyodide-lock.json', '{"packages":{}}']]);
  raw[raw.length - 1] ^= 1;
  assert.throws(() => unpack(raw), /pyodide-lock\.json sha256 [0-9a-f]{64} does not match the manifest/);
});

test('a core file whose digest matches the manifest but not the Pyodide 314.0.7 pin is refused', () => {
  const raw = bundle([['pyodide.mjs', 'export default 1;']]);
  assert.throws(() => unpack(raw), /pyodide\.mjs sha256 [0-9a-f]{64} does not match the Pyodide 314\.0\.7 pin/);
});

test('a file shorter than its manifest entry is refused as truncated', () => {
  const header = Buffer.from(JSON.stringify({ format: 'pyodide-minimal/1', files: [{ name: 'pyodide-lock.json', offset: 0, bytes: 40, sha256: sha('short') }] }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  assert.throws(() => unpack(Buffer.concat([length, header, Buffer.from('short')])), /pyodide-lock\.json is truncated/);
});

test('a bundle in another format is refused by name', () => {
  assert.throws(() => unpack(bundle([['pyodide-lock.json', '{}']], { format: 'pyodide-minimal/2' })), /unknown bundle format pyodide-minimal\/2/);
});

test('a bundle without the core files is refused as missing one of them', () => {
  assert.throws(() => unpack(bundle([['pyodide-lock.json', '{}']])), /pyodide\.asm\.mjs is missing from the bundle/);
});

test('a file name that is not a plain name is refused', () => {
  assert.throws(() => unpack(bundle([['../escape.json', '{}']])), /bad file name "\.\.\/escape\.json"/);
});

test('a name that appears twice in the manifest is refused', () => {
  const header = Buffer.from(JSON.stringify({ format: 'pyodide-minimal/1', files: [{ name: 'pyodide-lock.json', offset: 0, bytes: 2, sha256: sha('{}') }, { name: 'pyodide-lock.json', offset: 2, bytes: 2, sha256: sha('{}') }] }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  assert.throws(() => unpack(Buffer.concat([length, header, Buffer.from('{}{}')])), /bad file name "pyodide-lock\.json"/);
});
