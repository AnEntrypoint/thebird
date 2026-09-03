#!/usr/bin/env node
// Vendor oxibrowser's wasm32-wasip1 agentplug plugin build
// (crates/oxibrowser-core, cargo build --no-default-features --release
// --target wasm32-wasip1 -p oxibrowser-core -> oxibrowser_core.wasm).
//
// Exports plugkit_alloc/plugkit_free/plugin_call (verbs: navigate, evaluate,
// dom-query, extract-markdown, capabilities) — the same loadable-plugin ABI
// as agentplug-treesitter/agentplug-bert/agentplug-libsql, verified live
// against gm's agentplug daemon (docs/CHANGELOG entry: wasm-gm-integration).
//
// No published GitHub release exists yet, so this is local-only: build the
// wasm in a sibling ../oxibrowser checkout, then run this script.
//
// --local [path]: copy directly from a working tree (default ../oxibrowser
// next to this repo, override with --local /custom/path or OXIBROWSER_LOCAL
// env var). Expects target/wasm32-wasip1/release/oxibrowser_core.wasm under
// the given path — this script does NOT invoke cargo itself.

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceFlags, exists, copyIfExists, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = join(ROOT, 'docs', 'vendor');
// Every agentplug shared-plugin wasm (bert/libsql/treesitter/plugkit) lives
// under vendor/gm/ regardless of its actual source repo -- freddie-host-wasm
// -plugin.js's loadWasmPlugin() hardcodes that path, so oxibrowser follows
// the same convention rather than a repo-named vendor/oxibrowser/ directory.
const VENDOR = join(VENDOR_ROOT, 'gm');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = 'oxibrowser-core';
const TAG = 'local'; // no release channel yet -- see header comment

// resolveSiblingDefault (refresh-common.mjs) only recognizes an npm
// package.json marker, so it can't find a pure-Rust sibling like
// ../oxibrowser (no package.json, only Cargo.toml). Detect it directly.
async function resolveOxibrowserSiblingDefault() {
  const candidate = join(ROOT, '..', 'oxibrowser');
  return (await exists(join(candidate, 'Cargo.toml'))) ? candidate : null;
}

async function main() {
  const defaultLocal = await resolveOxibrowserSiblingDefault();
  const { explicitLocal, localPath: pickedLocal } = parseSourceFlags('OXIBROWSER_LOCAL', defaultLocal);
  if (!pickedLocal) {
    throw new Error(
      'no oxibrowser checkout found -- pass --local <path> or set OXIBROWSER_LOCAL (no published release channel exists yet, unlike refresh-gm.mjs/refresh-libsql.mjs)'
    );
  }
  if (!(await exists(pickedLocal))) {
    throw new Error(`--local path does not exist: ${pickedLocal}`);
  }

  const wasmSrc = join(pickedLocal, 'target', 'wasm32-wasip1', 'release', 'oxibrowser_core.wasm');
  if (!(await exists(wasmSrc))) {
    throw new Error(
      `${wasmSrc} not found -- build it first: cd ${pickedLocal} && cargo build -p oxibrowser-core --no-default-features --release --target wasm32-wasip1`
    );
  }
  console.log(`refreshing ${PKG} wasm (local: ${pickedLocal}) into ${VENDOR}`);

  const wroteWasm = await copyIfExists(wasmSrc, join(VENDOR, 'oxibrowser.wasm'), 'oxibrowser.wasm');
  if (!wroteWasm) throw new Error('copy of oxibrowser.wasm failed');

  const vendoredWasmPath = join(VENDOR, 'oxibrowser.wasm');
  const { createHash } = await import('node:crypto');
  const wasmBuf = await readFile(vendoredWasmPath);
  const magic = wasmBuf.subarray(0, 4).toString('hex');
  if (magic !== '0061736d') {
    throw new Error(`vendored oxibrowser.wasm not valid wasm (magic=${magic} size=${wasmBuf.length})`);
  }
  const vendoredSha = createHash('sha256').update(wasmBuf).digest('hex');
  await writeFile(join(VENDOR, 'oxibrowser.wasm.sha256'), `${vendoredSha}  oxibrowser.wasm\n`);
  console.log('  validated oxibrowser.wasm.sha256 =', vendoredSha);

  const stamp = { package: PKG, version: TAG, refreshedAt: new Date().toISOString(), source: `local:${pickedLocal}` };
  await writeFile(join(VENDOR, 'oxibrowser.version'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('  stamped oxibrowser.version (local working tree)');

  const paths = ['oxibrowser.wasm', 'oxibrowser.wasm.sha256', 'oxibrowser.version'].map(f => join('gm', f));
  const items = [];
  for (const relPath of paths) {
    if (await exists(join(VENDOR_ROOT, relPath))) {
      items.push({ relPath, package: PKG, version: TAG, source: `local:${pickedLocal}` });
    }
  }
  await updateVendorLock(VENDOR_ROOT, VENDOR_LOCK, items);

  console.log(`done. vendored ${PKG} wasm from local:${pickedLocal}.`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
