#!/usr/bin/env node
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'docs', 'vendor');

const PYODIDE_VERSION = '0.27.2';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'package.json'];

const MICROPYTHON_VERSION = '1.25.0';
const MICROPYTHON_BASE = `https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@${MICROPYTHON_VERSION}/`;
const MICROPYTHON_FILES = ['micropython.mjs', 'micropython.wasm', 'package.json'];

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function fetchTo(url, dest) {
  const exist = await exists(dest);
  if (exist) { console.log('  skip (exists)', dest); return; }
  await mkdir(dirname(dest), { recursive: true });
  console.log('  fetch', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log('         →', dest, '(' + buf.byteLength + ' bytes)');
}

async function fetchSet(label, base, files, outDir) {
  console.log(`\n# ${label}`);
  for (const f of files) await fetchTo(base + f, join(outDir, f));
}

async function writeManifest(outDir, entries) {
  const manifest = { fetchedAt: new Date().toISOString(), entries };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function main() {
  console.log('vendor-fetch — localizing CDN imports under docs/vendor/');
  await fetchSet(`pyodide v${PYODIDE_VERSION}`, PYODIDE_BASE, PYODIDE_FILES, join(VENDOR, 'pyodide'));
  await writeManifest(join(VENDOR, 'pyodide'), { version: PYODIDE_VERSION, base: PYODIDE_BASE, files: PYODIDE_FILES });

  await fetchSet(`micropython v${MICROPYTHON_VERSION}`, MICROPYTHON_BASE, MICROPYTHON_FILES, join(VENDOR, 'micropython'));
  await writeManifest(join(VENDOR, 'micropython'), { version: MICROPYTHON_VERSION, base: MICROPYTHON_BASE, files: MICROPYTHON_FILES });

  console.log('\ndone. Run again any time; existing files are skipped.');
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
