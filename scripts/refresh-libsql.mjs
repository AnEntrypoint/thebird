#!/usr/bin/env node
// Vendor agentplug-libsql's standalone in-memory SQLite/libsql wasm plugin.
//
// docs/lib/sqlite-shim.js's sql_open/sql_close/sql_exec/sql_query/
// sql_serialize/sql_deserialize verbs all route through plugkit's
// call_plugin("libsql", <verb>, body) (../gm/rs-plugkit/crates/plugkit-core/
// src/wasm_dispatch/verbs.rs) -- a generic host_plugin_call import, SEPARATE
// from host_vec_embed, that plugkit-slim.wasm needs the host to implement for
// ANY libsql-backed verb to work, same as bert.wasm is needed for embeddings.
// Found live 2026-07-30: sql_open failing with a SQLite3Error on GH Pages
// after the slim-wasm swap, because host_plugin_call was never wired at all.
//
// libsql.wasm is tiny (~1MB, verified) -- committed directly like
// plugkit.wasm, not CI-only-vendored like the much larger bert.wasm.
//
// --local [path]: copy directly from a working tree (default
// ../agentplug-libsql next to this repo, override with --local /custom/path
// or LIBSQL_LOCAL env var). Expects bin/libsql.wasm + bin/libsql.wasm.sha256
// (mirrors gm's own bin/ layout) OR a flat libsql.wasm at the path root.

import { mkdir, writeFile, readFile, rm, cp, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sh, exists, parseSourceFlags, resolveSiblingDefault, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = join(ROOT, 'docs', 'vendor');
const VENDOR = join(VENDOR_ROOT, 'gm');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = 'agentplug-libsql';
const RELEASE_REPO = 'AnEntrypoint/agentplug-libsql-bin';
const RELEASE_TAG = 'latest'; // pinned per-release, not an npm-style moving dist-tag

async function copyFile(src, dst, label) {
  if (!(await exists(src))) { console.log('  skip (missing)', label, '<-', src); return false; }
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: true });
  console.log('  copied', label);
  return true;
}

async function resolveSource() {
  const defaultLocal = await resolveSiblingDefault(ROOT, ['agentplug-libsql'], null);
  const { wantsNpm: _wantsNpm, explicitLocal, localPath: pickedLocal } = parseSourceFlags('LIBSQL_LOCAL', defaultLocal);
  const localExists = pickedLocal && (await exists(pickedLocal));
  const useLocal = explicitLocal || localExists;
  if (useLocal) {
    if (!pickedLocal || !(await exists(pickedLocal))) throw new Error(`--local path does not exist: ${pickedLocal}`);
    const binWasm = join(pickedLocal, 'bin', 'libsql.wasm');
    const binSha = join(pickedLocal, 'bin', 'libsql.wasm.sha256');
    const flatWasm = join(pickedLocal, 'libsql.wasm');
    const flatSha = join(pickedLocal, 'libsql.wasm.sha256');
    const wasmSrc = (await exists(binWasm)) ? binWasm : flatWasm;
    const shaSrc = (await exists(binSha)) ? binSha : flatSha;
    if (!(await exists(wasmSrc))) throw new Error(`--local path missing libsql.wasm: ${pickedLocal} (checked bin/ and root)`);
    console.log(`refreshing ${PKG} wasm (local: ${pickedLocal}) into ${VENDOR}`);
    return { wasmSrc, shaSrc: (await exists(shaSrc)) ? shaSrc : null, tmp: null, source: `local:${pickedLocal}` };
  }
  const tmp = join(tmpdir(), `libsql-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const dlWasm = join(tmp, 'libsql.wasm');
  const dlSha = join(tmp, 'libsql.wasm.sha256');
  const base = `https://github.com/${RELEASE_REPO}/releases/${RELEASE_TAG}/download`;
  console.log(`  downloading release wasm ${base}/libsql.wasm`);
  sh('curl', ['-fsSL', '--retry', '3', '--retry-delay', '5', '-o', dlWasm, `${base}/libsql.wasm`]);
  try {
    sh('curl', ['-fsSL', '--retry', '2', '--retry-delay', '3', '-o', dlSha, `${base}/libsql.wasm.sha256`]);
  } catch (e) {
    console.log('  WARN: libsql.wasm.sha256 fetch failed (continuing without sidecar-sha check):', e.message);
  }
  const dlStats = await stat(dlWasm);
  if (dlStats.size < 200_000) throw new Error(`libsql.wasm download incomplete: ${dlStats.size} bytes (expected ~1MB)`);
  return { wasmSrc: dlWasm, shaSrc: (await exists(dlSha)) ? dlSha : null, tmp, source: `github-release:${RELEASE_REPO}@${RELEASE_TAG}` };
}

async function main() {
  const { wasmSrc, shaSrc, tmp, source } = await resolveSource();

  const wroteWasm = await copyFile(wasmSrc, join(VENDOR, 'libsql.wasm'), 'libsql.wasm');

  const vendoredWasmPath = join(VENDOR, 'libsql.wasm');
  if (!(await exists(vendoredWasmPath))) throw new Error('vendored libsql.wasm missing after copy step — cannot compute sha');
  const { createHash } = await import('node:crypto');
  const wasmBuf = await readFile(vendoredWasmPath);
  const magic = wasmBuf.subarray(0, 4).toString('hex');
  if (magic !== '0061736d' || wasmBuf.length < 200_000) {
    throw new Error(`vendored libsql.wasm not valid wasm (magic=${magic} size=${wasmBuf.length})`);
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
  await writeFile(join(VENDOR, 'libsql.wasm.sha256'), `${vendoredSha}  libsql.wasm\n`);
  console.log('  validated libsql.wasm.sha256 =', vendoredSha);

  const stamp = { package: PKG, version: RELEASE_TAG, refreshedAt: new Date().toISOString(), source };
  await writeFile(join(VENDOR, 'libsql.version'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('  stamped libsql.version', source.startsWith('local:') ? '(local working tree)' : '');

  const libsqlPaths = ['libsql.wasm', 'libsql.wasm.sha256', 'libsql.version'].map(f => join('gm', f));
  const items = [];
  for (const relPath of libsqlPaths) {
    if (await exists(join(VENDOR_ROOT, relPath))) items.push({ relPath, package: PKG, version: RELEASE_TAG, source });
  }
  await updateVendorLock(VENDOR_ROOT, VENDOR_LOCK, items);

  if (tmp) await rm(tmp, { recursive: true, force: true });
  console.log(`done. vendored ${PKG} wasm from ${source}.`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
