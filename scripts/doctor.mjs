#!/usr/bin/env node
// doctor.mjs — mirrors freddie's runDoctor() concept: a fast, static
// consistency check over thebird's repo state (no live server probe).
//
// Checks:
//   1. Vendor .version stamps present under docs/vendor/*/ and valid JSON
//      with the expected fields (package, version, refreshedAt, source).
//   2. docs/sw-i{1..N}/index.js stubs exist for the full instance cap
//      (N = MAX_RESTORE_INSTANCES from docs/lib/instance-cap.js).
//   3. scripts/witness-lib.mjs DEFAULT_URL port matches what `serve docs`
//      (per package.json's "serve" script) actually binds to by default.
//
// Exits non-zero if any check fails.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { hashVendorEntry } from './refresh-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = false;
const results = [];

function pass(msg) {
  results.push({ ok: true, msg });
}
function fail(msg) {
  failed = true;
  results.push({ ok: false, msg });
}

// ---------------------------------------------------------------------
// 1. Vendor .version stamps
// ---------------------------------------------------------------------
const vendorDir = path.join(root, 'docs', 'vendor');
// name -> relative path (from docs/vendor/) of the .version stamp file.
// design's stamp lands under vendor/kits/os/ (see scripts/refresh-design.mjs);
// freddie/gm stamp directly under their own vendor subdir.
const expectedVendors = {
  design: path.join('kits', 'os', '.version'),
  freddie: path.join('freddie', '.version'),
  gm: path.join('gm', '.version'),
  'spoint-ecs': path.join('spoint-ecs', '.version'),
};
const requiredFields = ['package', 'version', 'refreshedAt', 'source'];

for (const [name, rel] of Object.entries(expectedVendors)) {
  const versionPath = path.join(vendorDir, rel);
  if (!existsSync(versionPath)) {
    fail(`vendor:${name} — missing docs/vendor/${rel.split(path.sep).join('/')}`);
    continue;
  }
  let json;
  try {
    json = JSON.parse(readFileSync(versionPath, 'utf8'));
  } catch (e) {
    fail(`vendor:${name} — .version is not valid JSON (${e.message})`);
    continue;
  }
  const missing = requiredFields.filter((f) => !(f in json));
  if (missing.length) {
    fail(`vendor:${name} — .version missing field(s): ${missing.join(', ')}`);
    continue;
  }
  pass(`vendor:${name} — ${json.package}@${json.version} (refreshed ${json.refreshedAt})`);
}

// ---------------------------------------------------------------------
// 2. sw-i stubs matching the instance cap
// ---------------------------------------------------------------------
let maxInstances;
try {
  const mod = await import(pathToFileURL(path.join(root, 'docs', 'lib', 'instance-cap.js')).href);
  maxInstances = mod.MAX_RESTORE_INSTANCES;
  if (typeof maxInstances !== 'number') throw new Error('MAX_RESTORE_INSTANCES not a number');
} catch (e) {
  // Fallback: grep COUNT out of scripts/gen-static-sws.mjs directly.
  try {
    const src = readFileSync(path.join(root, 'scripts', 'gen-static-sws.mjs'), 'utf8');
    const m = src.match(/const COUNT\s*=\s*(\w[\w.]*)/);
    if (!m) throw new Error('COUNT not found in gen-static-sws.mjs');
    // If COUNT references an imported constant name, this fallback can't
    // resolve it further; report what we found for a human to check.
    fail(`sw-i-stubs — could not import docs/lib/instance-cap.js (${e.message}); ` +
      `scripts/gen-static-sws.mjs references COUNT = ${m[1]} (resolve manually)`);
    maxInstances = undefined;
  } catch (e2) {
    fail(`sw-i-stubs — could not determine instance cap: ${e.message}; fallback grep also failed: ${e2.message}`);
    maxInstances = undefined;
  }
}

if (typeof maxInstances === 'number') {
  const missingStubs = [];
  for (let i = 1; i <= maxInstances; i++) {
    const stubPath = path.join(root, 'docs', `sw-i${i}`, 'index.js');
    if (!existsSync(stubPath)) missingStubs.push(`sw-i${i}`);
  }
  if (missingStubs.length) {
    fail(`sw-i-stubs — missing ${missingStubs.length}/${maxInstances} stub(s): ${missingStubs.join(', ')}`);
  } else {
    pass(`sw-i-stubs — all ${maxInstances} docs/sw-i{1..${maxInstances}}/index.js stubs present`);
  }
}

// ---------------------------------------------------------------------
// 3. Serve port matching witness DEFAULT_URL
// ---------------------------------------------------------------------
try {
  const witnessSrc = readFileSync(path.join(root, 'scripts', 'witness-lib.mjs'), 'utf8');
  const urlMatch = witnessSrc.match(/const\s+DEFAULT_URL\s*=\s*['"]([^'"]+)['"]/);
  if (!urlMatch) {
    fail('serve-port — DEFAULT_URL not found in scripts/witness-lib.mjs');
  } else {
    const defaultUrl = urlMatch[1];
    const parsedPort = new URL(defaultUrl).port || (defaultUrl.startsWith('https') ? '443' : '80');

    const pkgJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const serveScript = pkgJson.scripts && pkgJson.scripts.serve;
    if (!serveScript) {
      fail('serve-port — package.json has no "serve" script to cross-reference');
    } else {
      // `npx serve docs` / `bunx serve docs` with no explicit -l/--listen flag
      // defaults to port 3000 (the `serve` package's documented default).
      const explicitPortMatch = serveScript.match(/(?:-l|--listen)[= ]\S*?(\d{2,5})/);
      const servePort = explicitPortMatch ? explicitPortMatch[1] : '3000';

      if (servePort === parsedPort) {
        pass(`serve-port — witness DEFAULT_URL port ${parsedPort} matches "serve" script default (${JSON.stringify(serveScript)})`);
      } else {
        fail(`serve-port — witness DEFAULT_URL port ${parsedPort} != serve default port ${servePort} (script: ${JSON.stringify(serveScript)})`);
      }
    }
  }
} catch (e) {
  fail(`serve-port — check errored: ${e.message}`);
}

// ---------------------------------------------------------------------
// 4. docs/vendor.lock.json — hand-edit drift check
//
// The lock file is the single manifest of every file/directory the three
// refresh-*.mjs scripts write under docs/vendor/. Recompute each entry's
// hash from what's actually on disk and compare against the recorded
// sha256; any mismatch means the vendored copy was hand-edited (or the
// lock file is stale) — either way it's the "fourth copy" drift this
// manifest exists to catch, so fail loudly.
// ---------------------------------------------------------------------
const vendorLockPath = path.join(root, 'docs', 'vendor.lock.json');
if (!existsSync(vendorLockPath)) {
  fail('vendor.lock — missing docs/vendor.lock.json');
} else {
  let lock;
  try {
    lock = JSON.parse(readFileSync(vendorLockPath, 'utf8'));
  } catch (e) {
    fail(`vendor.lock — not valid JSON (${e.message})`);
    lock = null;
  }
  if (lock) {
    const entries = lock.entries || {};
    const relPaths = Object.keys(entries);
    if (relPaths.length === 0) {
      fail('vendor.lock — docs/vendor.lock.json has no entries');
    } else {
      // Some locked entries (today: gm/bert.wasm, ~136MB, agentplug-bert's
      // standalone embedder) are DELIBERATELY gitignored (see .gitignore's
      // comment above docs/vendor/gm/bert.wasm — too big for GitHub's 100MB
      // cap, CI fetches it from a GitHub Release at build time instead,
      // refresh-bert.mjs writes it locally only for dev convenience). A fresh
      // CI checkout genuinely never has this file on disk before its own
      // later "vendor agentplug-bert embedder" step runs — that is not
      // hand-edit drift, it's the intended shape, so it must not fail this
      // check the same way a real mismatch does. Its integrity is already
      // covered by the separately-tracked bert.wasm.sha256 entry.
      // gm/plugkit.wasm (the SLIM variant, ~3.6MB) is NOT in this set — it
      // fits GitHub's 100MB cap and IS committed, so its absence on disk
      // (e.g. after a partial checkout) is a real problem this check must
      // still catch, unlike the old fat ~149MB plugkit.wasm this comment
      // used to describe.
      const GITIGNORED_LOCK_PATHS = new Set(['gm/bert.wasm']);
      let mismatches = 0;
      for (const relPath of relPaths) {
        const entry = entries[relPath];
        const absPath = path.join(vendorDir, relPath);
        const current = await hashVendorEntry(absPath);
        if (!current) {
          if (GITIGNORED_LOCK_PATHS.has(relPath)) {
            pass(`vendor.lock:${relPath} — not on disk (expected: gitignored, fetched at runtime, see .gitignore)`);
            continue;
          }
          fail(`vendor.lock:${relPath} — missing on disk (recorded in lock but not vendored)`);
          mismatches++;
          continue;
        }
        if (current.type !== entry.type || current.sha256 !== entry.sha256) {
          fail(`vendor.lock:${relPath} — hash mismatch (locked ${entry.type}:${entry.sha256.slice(0, 12)} != on-disk ${current.type}:${current.sha256.slice(0, 12)}) — vendored code was hand-edited or docs/vendor.lock.json is stale; re-run the matching scripts/refresh-*.mjs`);
          mismatches++;
        }
      }
      if (mismatches === 0) {
        pass(`vendor.lock — all ${relPaths.length} docs/vendor.lock.json entries match on-disk hashes`);
      }
    }
  }
}

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
console.log('thebird doctor');
console.log('==============');
for (const r of results) {
  console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.msg}`);
}
console.log('');
if (failed) {
  console.log('doctor: FAIL — see [FAIL] lines above');
  process.exit(1);
} else {
  console.log('doctor: OK — all checks passed');
  process.exit(0);
}
