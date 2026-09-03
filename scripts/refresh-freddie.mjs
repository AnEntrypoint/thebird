#!/usr/bin/env node
// Refresh vendored freddie browser bundle.
//
// Default: pulls the published tarball from npm @latest, extracts, copies
// dist/browser/freddie.js + freddie.js.map + skills/ into docs/vendor/freddie/
// and stamps a .version file. Use this for reproducible CI / release builds.
//
// --local [path]: copy directly from a working tree (default the
// vendor-src/freddie git submodule, override with --local /custom/path or
// FREDDIE_LOCAL env var). Use this during local development so freddie edits
// in the submodule working tree propagate into thebird's vendored copy
// without an npm publish.

import { writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, parseSourceFlags, resolvePkgSource, copyIfExists, resolveSiblingDefault, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = join(ROOT, 'docs', 'vendor');
const VENDOR = join(VENDOR_ROOT, 'freddie');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = 'freddie';
const TAG = 'latest';

// Default behaviour on dev box: when the vendor-src/freddie submodule is
// checked out (or, failing that, a ../freddie sibling, or the historical
// C:/dev/freddie fallback) and no --npm flag is passed, prefer local working
// tree. CI sets --npm explicitly.
const defaultLocal = await resolveSiblingDefault(ROOT, ['freddie'], 'C:/dev/freddie');
const { wantsNpm, explicitLocal, localPath } = parseSourceFlags('FREDDIE_LOCAL', defaultLocal);

// sh() + exists() + parseSourceFlags() + resolvePkgSource() + copyIfExists()
// live in scripts/refresh-common.mjs.

async function main() {
  // Local-by-default when working tree exists and --npm not forced.
  const useLocal = !wantsNpm && (explicitLocal || await exists(localPath));
  const { pkgDir, version, tmp, source } = await resolvePkgSource({ pkg: PKG, tag: TAG, useLocal, localPath, tmpPrefix: 'freddie' });
  console.log(`refreshing ${PKG}@${version} (${source}) into ${VENDOR}`);

  // Browser bundle — the load-bearing artifact freddie-loader.js imports.
  // freddie's published npm tarball does NOT ship dist/ (package.json
  // "files" lists only bin/src/plugins/skills/*.md — the browser bundle is
  // a local-build-only artifact), so --npm mode can never populate this
  // file; only a --local sibling checkout with dist/browser/ already built
  // can. copyIfExists silently no-ops on a missing source, which would
  // otherwise let this run "succeed" (stamp .version, exit 0) while quietly
  // leaving freddie.js stale forever — exactly the failure the scheduled
  // sync-upstream.yml CI job (which always runs --npm, no sibling checkout
  // available) would hit on every run. Fail loud instead: a --npm run that
  // can't find the bundle stops here rather than reporting false success.
  const gotFreddieJs = await copyIfExists(join(pkgDir, 'dist', 'browser', 'freddie.js'), join(VENDOR, 'freddie.js'), 'dist/browser/freddie.js');
  await copyIfExists(join(pkgDir, 'dist', 'browser', 'freddie.js.map'), join(VENDOR, 'freddie.js.map'), 'dist/browser/freddie.js.map');
  // exit 3 is a distinct, documented signal from a genuine crash (exit 1):
  // sync-upstream.mjs's orchestrator treats it as "known structural gap,
  // warn and continue" rather than aborting the whole vendor-refresh run —
  // see its handling for why this needs its own code instead of just not
  // throwing (silently reporting success here would let a stale bundle look
  // refreshed forever, exactly the bug this whole block exists to prevent).
  const npmModeCannotShipBundle = !gotFreddieJs && !useLocal;
  if (npmModeCannotShipBundle) {
    console.error(
      'FREDDIE_BUNDLE_UNAVAILABLE: freddie npm tarball has no dist/browser/freddie.js ' +
      '(freddie\'s package.json "files" field excludes dist/ — a local-build-only artifact). ' +
      '--npm mode cannot refresh this load-bearing file; only --local against a sibling checkout ' +
      'with its own dist/browser/ build can. The vendored bundle stays exactly as committed.'
    );
  }

  // Skills tree — categories under skills/ (creative/data/ops/planning/software-development).
  // Local layout has these at /skills; published tarball mirrors the same path.
  const skillsSrc = join(pkgDir, 'skills');
  if (await exists(skillsSrc)) {
    await copyIfExists(skillsSrc, join(VENDOR, 'skills'), 'skills');
  }

  // Version stamp — parallel to refresh-design. Deliberately SKIPPED when
  // npm mode couldn't ship the bundle: stamping `version` here would claim
  // freddie.js is current at the new version when its bytes are still
  // whatever was last committed — the exact false-success this whole block
  // exists to prevent. skills/ (which DID come from npm successfully) still
  // gets its lock entry updated below; only the version stamp and the
  // freddie.js/.js.map lock entries are held back.
  if (!npmModeCannotShipBundle) {
    const stamp = {
      package: PKG,
      version,
      refreshedAt: new Date().toISOString(),
      source,
    };
    await writeFile(join(VENDOR, '.version'), JSON.stringify(stamp, null, 2) + '\n');
    console.log('  stamped .version =', version, source.startsWith('local:') ? '(local working tree)' : '');
  } else {
    console.log('  .version stamp NOT updated — freddie.js bundle unchanged, stamping would misreport freshness');
  }

  // docs/vendor.lock.json — record what this script wrote (relative to
  // docs/vendor/) so scripts/doctor.mjs can catch hand-edited vendored code.
  // freddie.js/.js.map are excluded from this pass when the bundle copy was
  // skipped (npmModeCannotShipBundle) so their lock entries keep pointing at
  // whatever version last actually wrote those bytes, not this run's version.
  const freddiePaths = (npmModeCannotShipBundle ? ['skills'] : ['freddie.js', 'freddie.js.map', 'skills']).map(f => join('freddie', f));
  const items = [];
  for (const relPath of freddiePaths) {
    if (await exists(join(VENDOR_ROOT, relPath))) items.push({ relPath, package: PKG, version, source });
  }
  await updateVendorLock(VENDOR_ROOT, VENDOR_LOCK, items);

  if (tmp) await rm(tmp, { recursive: true, force: true });
  if (npmModeCannotShipBundle) {
    console.log(`partial: vendored ${PKG} skills@${version} from ${source}; freddie.js bundle left at its last-committed version (see FREDDIE_BUNDLE_UNAVAILABLE above).`);
    process.exitCode = 3;
  } else {
    console.log(`done. vendored ${PKG}@${version} from ${source}.`);
  }
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
