#!/usr/bin/env node
import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME = 'C:/dev/hermes-theme';
const OUT = join(ROOT, 'docs', 'vendor', 'hermes-theme');

async function copyTree(src, dst) {
  await mkdir(dst, { recursive: true });
  for (const ent of await readdir(src, { withFileTypes: true })) {
    const s = join(src, ent.name);
    const d = join(dst, ent.name);
    if (ent.isDirectory()) await copyTree(s, d);
    else await copyFile(s, d);
  }
}

async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else out.push(relative(THEME, p).replace(/\\/g, '/'));
    }
  }
  await walk(dir);
  return out;
}

async function main() {
  console.log('bundle-hermes-theme — copying c:/dev/hermes-theme → docs/vendor/hermes-theme/');
  if (!existsSync(THEME)) throw new Error('source missing: ' + THEME);
  await copyTree(THEME, OUT);
  const files = await listFiles(THEME);
  const manifest = {
    bundledAt: new Date().toISOString(),
    light: 'theme/clean.yaml',
    dark: 'theme/clean-dark.yaml',
    files,
  };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`done. ${files.length} files → docs/vendor/hermes-theme/`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
