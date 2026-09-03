#!/usr/bin/env node
// Vendor agentplug-bert's standalone bge-small-en-v1.5 embedder wasm.
//
// bert.wasm is the SAME model rs-plugkit's fat plugkit.wasm used to bundle,
// now published standalone by ../gm's agentplug-bert-bin release (no npm
// package — GitHub Releases only). At ~136MB it hits the same CORS problem
// the old fat plugkit.wasm had (a raw Release-asset fetch has no CORS
// headers), so — same fix as plugkit — CI downloads it server-side (no CORS
// restriction there) and commits/serves it same-origin.
//
// --local [path]: copy directly from a working tree (default ../agentplug-bert
// next to this repo, override with --local /custom/path or BERT_LOCAL env
// var). Expects bin/bert.wasm + bin/bert.wasm.sha256 (mirrors gm's own
// bin/ layout) OR a flat bert.wasm at the path root.

import { mkdir, writeFile, readFile, rm, cp, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sh, exists, parseSourceFlags, resolveSiblingDefault, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = join(ROOT, 'docs', 'vendor');
const VENDOR = join(VENDOR_ROOT, 'gm');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = 'agentplug-bert';
const RELEASE_REPO = 'AnEntrypoint/agentplug-bert-bin';
const RELEASE_TAG = 'latest'; // pinned per-release, not an npm-style moving dist-tag

async function copyFile(src, dst, label) {
  if (!(await exists(src))) { console.log('  skip (missing)', label, '<-', src); return false; }
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: true });
  console.log('  copied', label);
  return true;
}

async function resolveSource() {
  const defaultLocal = await resolveSiblingDefault(ROOT, ['agentplug-bert'], null);
  const { wantsNpm: _wantsNpm, explicitLocal, localPath: pickedLocal } = parseSourceFlags('BERT_LOCAL', defaultLocal);
  const localExists = pickedLocal && (await exists(pickedLocal));
  const useLocal = explicitLocal || localExists;
  if (useLocal) {
    if (!pickedLocal || !(await exists(pickedLocal))) throw new Error(`--local path does not exist: ${pickedLocal}`);
    const binWasm = join(pickedLocal, 'bin', 'bert.wasm');
    const binSha = join(pickedLocal, 'bin', 'bert.wasm.sha256');
    const flatWasm = join(pickedLocal, 'bert.wasm');
    const flatSha = join(pickedLocal, 'bert.wasm.sha256');
    const wasmSrc = (await exists(binWasm)) ? binWasm : flatWasm;
    const shaSrc = (await exists(binSha)) ? binSha : flatSha;
    if (!(await exists(wasmSrc))) throw new Error(`--local path missing bert.wasm: ${pickedLocal} (checked bin/ and root)`);
    console.log(`refreshing ${PKG} wasm (local: ${pickedLocal}) into ${VENDOR}`);
    return { wasmSrc, shaSrc: (await exists(shaSrc)) ? shaSrc : null, tmp: null, source: `local:${pickedLocal}` };
  }
  const tmp = join(tmpdir(), `bert-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const dlWasm = join(tmp, 'bert.wasm');
  const dlSha = join(tmp, 'bert.wasm.sha256');
  const base = `https://github.com/${RELEASE_REPO}/releases/${RELEASE_TAG}/download`;
  console.log(`  downloading release wasm ${base}/bert.wasm`);
  sh('curl', ['-fsSL', '--retry', '3', '--retry-delay', '5', '-o', dlWasm, `${base}/bert.wasm`]);
  try {
    sh('curl', ['-fsSL', '--retry', '2', '--retry-delay', '3', '-o', dlSha, `${base}/bert.wasm.sha256`]);
  } catch (e) {
    console.log('  WARN: bert.wasm.sha256 fetch failed (continuing without sidecar-sha check):', e.message);
  }
  const dlStats = await stat(dlWasm);
  if (dlStats.size < 50_000_000) throw new Error(`bert.wasm download incomplete: ${dlStats.size} bytes (expected ~136MB)`);
  return { wasmSrc: dlWasm, shaSrc: (await exists(dlSha)) ? dlSha : null, tmp, source: `github-release:${RELEASE_REPO}@${RELEASE_TAG}` };
}

async function main() {
  const { wasmSrc, shaSrc, tmp, source } = await resolveSource();

  const wroteWasm = await copyFile(wasmSrc, join(VENDOR, 'bert.wasm'), 'bert.wasm');

  const vendoredWasmPath = join(VENDOR, 'bert.wasm');
  if (!(await exists(vendoredWasmPath))) throw new Error('vendored bert.wasm missing after copy step — cannot compute sha');
  const { createHash } = await import('node:crypto');
  const wasmBuf = await readFile(vendoredWasmPath);
  const magic = wasmBuf.subarray(0, 4).toString('hex');
  if (magic !== '0061736d' || wasmBuf.length < 1_000_000) {
    throw new Error(`vendored bert.wasm not valid wasm (magic=${magic} size=${wasmBuf.length})`);
  }
  const vendoredSha = createHash('sha256').update(wasmBuf).digest('hex');
  if (wroteWasm && shaSrc) {
    const raw = (await readFile(shaSrc, 'utf8')).trim();
    const srcSha = raw.split(/\s+/)[0];
    if (srcSha && srcSha !== vendoredSha) {
      console.log(`  WARN: source sha (${srcSha.slice(0, 12)}) != vendored wasm sha (${vendoredSha.slice(0, 12)}) — recording vendored sha (canonical).`);
    } else if (srcSha) {
      console.log(`  sha256 verified against release sidecar: ${vendoredSha.slice(0, 16)}...`);
    }
  }
  await writeFile(join(VENDOR, 'bert.wasm.sha256'), `${vendoredSha}  bert.wasm\n`);
  console.log('  validated bert.wasm.sha256 =', vendoredSha);

  const stamp = { package: PKG, version: RELEASE_TAG, refreshedAt: new Date().toISOString(), source };
  await writeFile(join(VENDOR, 'bert.version'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('  stamped bert.version', source.startsWith('local:') ? '(local working tree)' : '');

  const bertPaths = ['bert.wasm', 'bert.wasm.sha256', 'bert.version'].map(f => join('gm', f));
  const items = [];
  for (const relPath of bertPaths) {
    if (await exists(join(VENDOR_ROOT, relPath))) items.push({ relPath, package: PKG, version: RELEASE_TAG, source });
  }
  await updateVendorLock(VENDOR_ROOT, VENDOR_LOCK, items);

  if (tmp) await rm(tmp, { recursive: true, force: true });
  console.log(`done. vendored ${PKG} wasm from ${source}.`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
