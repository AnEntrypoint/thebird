#!/usr/bin/env node
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'docs', 'vendor');

const PYODIDE_VERSION = '0.27.2';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`;
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'package.json'];
const PYODIDE_WHEELS_FROM_LOCK = ['micropip', 'ssl', 'sqlite3', 'distutils', 'packaging', 'pyparsing', 'pyyaml', 'pydantic', 'pydantic-core', 'annotated-types', 'idna', 'jinja2', 'markupsafe', 'rich', 'requests', 'charset-normalizer', 'urllib3', 'certifi', 'httpx', 'httpcore', 'h11', 'sniffio', 'anyio', 'attrs', 'six', 'typing-extensions', 'pygments', 'mdurl', 'markdown-it-py'];

const MICROPYTHON_VERSION = '1.25.0';
const MICROPYTHON_BASE = `https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@${MICROPYTHON_VERSION}/`;
const MICROPYTHON_FILES = ['micropython.mjs', 'micropython.wasm', 'package.json'];

const ESM_BUNDLES = [
  { id: 'browser_wasi_shim', url: 'https://esm.sh/@bjorn3/browser_wasi_shim@0.3.0?bundle&target=es2022' },
  { id: 'brotli-wasm', url: 'https://esm.sh/brotli-wasm@3.0.1?bundle&target=es2022' },
  { id: 'isomorphic-git', url: 'https://esm.sh/isomorphic-git@1.27.1?bundle&target=es2022' },
  { id: 'isomorphic-git-http-web', url: 'https://esm.sh/isomorphic-git@1.27.1/http/web?bundle&target=es2022' },
  { id: 'sql-wasm', url: 'https://esm.sh/sql.js@1.11.0?bundle&target=es2022' },
  { id: 'bcryptjs', url: 'https://esm.sh/bcryptjs@2.4.3?bundle&target=es2022' },
  { id: 'argon2-browser', url: 'https://esm.sh/argon2-browser@1.18.0?bundle&target=es2022' },
  { id: 'source-map-js', url: 'https://esm.sh/source-map-js@1.2.1?bundle&target=es2022' },
  { id: 'fflate', url: 'https://esm.sh/fflate@0.8.2?bundle&target=es2022' },
  { id: 'sucrase', url: 'https://esm.sh/sucrase@3.35.0?bundle&target=es2022' },
];

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function fetchTo(url, dest, { followStub = false } = {}) {
  const exist = await exists(dest);
  if (exist) { console.log('  skip (exists)', dest); return; }
  await mkdir(dirname(dest), { recursive: true });
  console.log('  fetch', url);
  let res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  let txt = await res.text();
  if (followStub && txt.length < 600) {
    const m = txt.match(/from\s+["']([^"']+\.bundle\.mjs)["']/);
    if (m) {
      const next = new URL(m[1], 'https://esm.sh').href;
      console.log('  → follow', next);
      res = await fetch(next);
      if (!res.ok) throw new Error(`${next} → ${res.status}`);
      txt = await res.text();
    }
  }
  await writeFile(dest, txt);
  console.log('         →', dest, '(' + Buffer.byteLength(txt) + ' bytes)');
}

async function fetchSet(label, base, files, outDir) {
  console.log(`\n# ${label}`);
  for (const f of files) await fetchTo(base + f, join(outDir, f));
}

async function writeManifest(outDir, entries) {
  const manifest = { fetchedAt: new Date().toISOString(), entries };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function fetchPyodideLockWheels(outDir) {
  const lockPath = join(outDir, 'pyodide-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf-8'));
  const pkgs = lock.packages || {};
  const want = new Set(PYODIDE_WHEELS_FROM_LOCK.map(s => s.toLowerCase()));
  for (const [n, p] of Object.entries(pkgs)) {
    if (!want.has(n.toLowerCase()) || !p.file_name) continue;
    await fetchTo(PYODIDE_BASE + p.file_name, join(outDir, p.file_name));
    for (const dep of p.depends || []) {
      const depPkg = pkgs[dep];
      if (depPkg?.file_name) await fetchTo(PYODIDE_BASE + depPkg.file_name, join(outDir, depPkg.file_name));
    }
  }
}

async function main() {
  console.log('vendor-fetch — localizing CDN imports under docs/vendor/');
  await fetchSet(`pyodide v${PYODIDE_VERSION}`, PYODIDE_BASE, PYODIDE_FILES, join(VENDOR, 'pyodide'));
  console.log('\n# pyodide bundled wheels');
  await fetchPyodideLockWheels(join(VENDOR, 'pyodide'));
  await writeManifest(join(VENDOR, 'pyodide'), { version: PYODIDE_VERSION, base: PYODIDE_BASE, files: PYODIDE_FILES, bundledWheels: PYODIDE_WHEELS_FROM_LOCK });

  await fetchSet(`micropython v${MICROPYTHON_VERSION}`, MICROPYTHON_BASE, MICROPYTHON_FILES, join(VENDOR, 'micropython'));
  await writeManifest(join(VENDOR, 'micropython'), { version: MICROPYTHON_VERSION, base: MICROPYTHON_BASE, files: MICROPYTHON_FILES });

  console.log('\n# esm.sh bundles');
  const esmDir = join(VENDOR, 'esm');
  for (const b of ESM_BUNDLES) await fetchTo(b.url, join(esmDir, b.id + '.mjs'), { followStub: true });
  await writeManifest(esmDir, { source: 'esm.sh', bundles: ESM_BUNDLES });

  console.log('\ndone. Run again any time; existing files are skipped.');
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
