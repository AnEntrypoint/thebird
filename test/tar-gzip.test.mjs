import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { scratchDir } from './scratch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createShell } = await import(pathToFileURL(join(root, 'web', 'shell-core.js')).href);

function diskHost() {
  const info = (path, stats) => (stats ? { dir: stats.isDirectory(), size: stats.size } : null);
  return {
    exists: (path) => existsSync(path),
    stat: (path) => (existsSync(path) ? info(path, statSync(path)) : null),
    lstat: (path) => {
      if (!existsSync(path) && !isLink(path)) return null;
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) return { dir: false, link: true, size: readlinkSync(path).length };
      return info(path, stats);
    },
    read: (path) => readFileSync(path, 'utf8'),
    readBytes: (path) => new Uint8Array(readFileSync(path)),
    write: (path, data) => writeFileSync(path, typeof data === 'string' ? data : Buffer.from(data)),
    list: (path) => readdirSync(path),
    mkdir: (path) => mkdirSync(path),
    remove: (path, recursive) => rmSync(path, { recursive: Boolean(recursive), force: false }),
    readlink: (path) => readlinkSync(path),
    symlink: (target, path) => symlinkSync(target, path),
  };
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function workspace() {
  return scratchDir('tar-gzip-');
}

function lines(length, seed) {
  let text = '';
  for (let index = 0; index < length; index++) text += 'line ' + index + ' ' + ((index * seed) % 97) + '\n';
  return text;
}

test('tar -z writes a gzip archive that node zlib reads back to the plain tar bytes', async () => {
  const dir = workspace();
  writeFileSync(join(dir, 'x.txt'), 'hit\n');
  const sh = await createShell({ host: diskHost(), cwd: dir });
  const made = await sh.run('tar -cf plain.tar x.txt && tar -czf a.tgz x.txt; echo rc=$?');
  assert.equal(made.stdout, 'rc=0\n');
  assert.equal(made.stderr, '');
  const archive = readFileSync(join(dir, 'a.tgz'));
  assert.deepEqual([...archive.subarray(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual(gunzipSync(archive), readFileSync(join(dir, 'plain.tar')));
});

test('tar -z writes a multi-block stored gzip archive that zlib reads back', async () => {
  const dir = workspace();
  writeFileSync(join(dir, 'big.txt'), lines(20000, 7));
  const sh = await createShell({ host: diskHost(), cwd: dir });
  const made = await sh.run('tar -cf plain.tar big.txt && tar -czf big.tgz big.txt; echo rc=$?');
  assert.equal(made.stdout, 'rc=0\n');
  assert.ok(statSync(join(dir, 'plain.tar')).size > 0xffff);
  assert.deepEqual(gunzipSync(readFileSync(join(dir, 'big.tgz'))), readFileSync(join(dir, 'plain.tar')));
});

test('tar -z reads gzip from zlib at stored, fixed and dynamic Huffman levels', async () => {
  const dir = workspace();
  const content = lines(3000, 11);
  writeFileSync(join(dir, 'x.txt'), content);
  const sh = await createShell({ host: diskHost(), cwd: dir });
  await sh.run('tar -cf plain.tar x.txt');
  const plain = readFileSync(join(dir, 'plain.tar'));
  for (const level of [0, 1, 9]) {
    const name = 'zlib' + level + '.tgz';
    writeFileSync(join(dir, name), gzipSync(plain, { level }));
    const out = join(dir, 'out' + level);
    const extracted = await sh.run('mkdir -p out' + level + ' && tar -xzf ' + name + ' -C out' + level + '; echo rc=$?');
    assert.equal(extracted.stdout, 'rc=0\n', 'level ' + level);
    assert.equal(readFileSync(join(out, 'x.txt'), 'utf8'), content, 'level ' + level);
    const listed = await sh.run('tar -tzf ' + name);
    assert.equal(listed.stdout, 'x.txt\n', 'level ' + level);
  }
});

test('tar -z rejects a gzip stream whose CRC is wrong', async () => {
  const dir = workspace();
  writeFileSync(join(dir, 'x.txt'), 'hit\n');
  const sh = await createShell({ host: diskHost(), cwd: dir });
  await sh.run('tar -cf plain.tar x.txt');
  const good = gzipSync(readFileSync(join(dir, 'plain.tar')));
  const bad = Buffer.from(good);
  bad[bad.length - 8] ^= 0xff;
  writeFileSync(join(dir, 'bad.tgz'), bad);
  const result = await sh.run('tar -tzf bad.tgz; echo rc=$?');
  assert.equal(result.stdout, 'rc=2\n');
  assert.match(result.stderr, /^gzip: stdin: invalid compressed data--crc error\n/);
});
