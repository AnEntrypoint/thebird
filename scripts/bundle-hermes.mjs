#!/usr/bin/env node
import { mkdir, writeFile, readFile, copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERMES = 'C:/dev/hermes';
const OUT = join(ROOT, 'docs', 'vendor', 'hermes');

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

function modulePath(modName) {
  const parts = modName.split('.');
  const a = join(HERMES, ...parts) + '.py';
  if (existsSync(a)) return a;
  const b = join(HERMES, ...parts, '__init__.py');
  if (existsSync(b)) return b;
  return null;
}

function moduleNameFromPath(p) {
  const rel = relative(HERMES, p).replace(/\\/g, '/').replace(/\.py$/, '').replace(/\/__init__$/, '');
  return rel.replace(/\//g, '.');
}

function extractImports(src, currentMod) {
  const out = new Set();
  for (const line of src.split('\n')) {
    let m = line.match(/^\s*from\s+(\.{1,}|[\w.]+)\s+import\s+/);
    if (m) {
      let spec = m[1];
      if (spec.startsWith('.')) {
        const dots = spec.match(/^\.+/)[0].length;
        const rest = spec.slice(dots);
        const parts = currentMod.split('.');
        const base = parts.slice(0, parts.length - dots).join('.');
        spec = rest ? (base ? base + '.' + rest : rest) : base;
      }
      out.add(spec);
      continue;
    }
    m = line.match(/^\s*import\s+([\w.,\s]+)/);
    if (m) for (const part of m[1].split(',')) out.add(part.trim().split(' as ')[0]);
  }
  return out;
}

async function buildClosure(entry) {
  const visited = new Set();
  const queue = [entry];
  const files = new Set();
  while (queue.length) {
    const mod = queue.shift();
    const p = modulePath(mod);
    if (!p || visited.has(p)) continue;
    visited.add(p);
    files.add(p);
    const src = await readFile(p, 'utf8');
    const cm = moduleNameFromPath(p);
    for (const imp of extractImports(src, cm)) {
      const head = imp.split('.')[0];
      queue.push(imp);
      queue.push(head);
    }
  }
  return [...files];
}

async function copyTree(srcDir, dstDir) {
  await mkdir(dstDir, { recursive: true });
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const s = join(srcDir, entry.name);
    const d = join(dstDir, entry.name);
    if (entry.isDirectory()) await copyTree(s, d);
    else await copyFile(s, d);
  }
}

async function main() {
  console.log('bundle-hermes — copying import closure of hermes_cli.web_server');
  const closure = await buildClosure('hermes_cli.web_server');
  console.log(`closure: ${closure.length} files`);
  for (const src of closure) {
    const rel = relative(HERMES, src).replace(/\\/g, '/');
    const dst = join(OUT, rel);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
  console.log('copying hermes_cli/web_dist (prebuilt frontend)');
  const distSrc = join(HERMES, 'hermes_cli', 'web_dist');
  const distFiles = [];
  async function walkDist(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walkDist(p);
      else distFiles.push(relative(HERMES, p).replace(/\\/g, '/'));
    }
  }
  if (existsSync(distSrc)) {
    await copyTree(distSrc, join(OUT, 'hermes_cli', 'web_dist'));
    await walkDist(distSrc);
  }
  // Pack all sources into one JSON blob to avoid 245 individual fetches
  const sourcesPack = {};
  for (const src of closure) {
    const rel = relative(HERMES, src).replace(/\\/g, '/');
    sourcesPack[rel] = await readFile(src, 'utf8');
  }
  await writeFile(join(OUT, 'sources.json'), JSON.stringify(sourcesPack));
  const manifest = {
    bundledAt: new Date().toISOString(),
    entry: 'hermes_cli.web_server',
    sources: closure.map(p => relative(HERMES, p).replace(/\\/g, '/')),
    sourcesPack: 'sources.json',
    distDir: 'hermes_cli/web_dist',
    distFiles,
  };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`done. ${closure.length} files (packed) + web_dist → docs/vendor/hermes/`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
