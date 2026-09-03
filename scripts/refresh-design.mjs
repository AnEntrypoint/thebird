#!/usr/bin/env node
// Refresh anentrypoint-design vendored assets into
// docs/vendor/{kits/os,components,web-components}, stamping a .version file.
//
// Source selection: the vendor-src/design git submodule is used when checked
// out, then a ../anentrypoint-design or ../design sibling working tree, so
// local design edits propagate without an npm publish round-trip; otherwise
// the published npm @latest tarball is used. There is no hardcoded dev-box
// path, so a fresh clone and CI both resolve to npm @latest with no flag.
//
// --npm forces the published tarball even when a sibling exists (reproducible
// release builds). --local [path] / ANENTRYPOINT_DESIGN_LOCAL forces a working
// tree. The stamped .version records which of the two actually supplied the bytes.

import { mkdir, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, parseSourceFlags, resolvePkgSource, copyIfExists, resolveSiblingDefault, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'docs', 'vendor');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = 'anentrypoint-design';
const TAG = 'latest';

const defaultLocal = await resolveSiblingDefault(ROOT, ['anentrypoint-design', 'design'], null);
const { wantsNpm, explicitLocal, localPath: pickedLocal } = parseSourceFlags('ANENTRYPOINT_DESIGN_LOCAL', defaultLocal);
const localExists = pickedLocal ? await exists(pickedLocal) : false;
const useLocal = !wantsNpm && (explicitLocal || localExists);
const localPath = useLocal ? pickedLocal : null;
if (!explicitLocal && useLocal) {
  console.error(`refresh-${PKG}: auto-selected --local ${pickedLocal} (use --npm to force npm @latest)`);
}

// sh() + exists() + parseSourceFlags() + resolvePkgSource() + copyIfExists()
// live in scripts/refresh-common.mjs.

async function main() {
  const resolved = await resolvePkgSource({ pkg: PKG, tag: TAG, useLocal, localPath, tmpPrefix: 'aedesign' });
  const { pkgDir, version, tmp, source } = resolved;
  console.log(`refreshing ${PKG}@${version} (${source}) into docs/vendor/`);

  // Visual surfaces — copy whole subtrees. Layout mirrors SDK depth so internal
  // relative imports (../../components.js, ../../../vendor/webjsx/) resolve correctly.
  await copyIfExists(join(pkgDir, 'src', 'kits', 'os'),     join(VENDOR, 'kits', 'os'),      'src/kits/os');
  await copyIfExists(join(pkgDir, 'src', 'components'),     join(VENDOR, 'components'),      'src/components');
  await copyIfExists(join(pkgDir, 'src', 'web-components'), join(VENDOR, 'web-components'),  'src/web-components');
  await copyIfExists(join(pkgDir, 'vendor', 'webjsx'),      join(VENDOR, 'webjsx'),          'vendor/webjsx');

  // Sibling helper modules referenced by upstream src files via relative imports.
  // theme.js is consumed via ../theme.js from components/theme-toggle.js; without it
  // the theme-toggle import chain 404s and the OS never initializes.
  // A module that outgrew the SDK's per-file cap becomes a thin barrel over a
  // sibling directory of the same name, so copying only the barrel leaves its
  // relative imports resolving to nothing and the flatspace build dies with
  // ERR_MODULE_NOT_FOUND. Copy the companion directory whenever one exists.
  // The copy set is EVERY src-root *.js file, not a hand-maintained list: 0.0.407
  // added src/{mermaid,math,locale,file-mention,idb-outbox}.js which the components
  // subtree imports via ../../<name>.js, and the old 9-file hardcoded list silently
  // 404'd every one of them, killing the whole shell mount with a content-free
  // "Failed to fetch dynamically imported module" (found live 2026-07-29).
  // Extra unimported files cost nothing — a module only loads when imported.
  const srcRootFiles = (await readdir(join(pkgDir, 'src'), { withFileTypes: true }))
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => e.name);
  for (const f of srcRootFiles) {
    const src = join(pkgDir, 'src', f);
    const dst = join(VENDOR, f);
    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst, { force: true });
    console.log('  copied', 'src/' + f);
    const companion = join(pkgDir, 'src', f.replace(/\.js$/, ''));
    if (await exists(companion)) {
      await copyIfExists(companion, join(VENDOR, f.replace(/\.js$/, '')), 'src/' + f.replace(/\.js$/, ''));
    }
  }

  // app-shell.css is an @import barrel over src/css/app-shell/*.css, and those
  // imports resolve relative to the barrel's vendored location. Without the
  // split sheets every one 404s and the components they style render unstyled
  // while the page still looks like it loaded a stylesheet.
  await copyIfExists(join(pkgDir, 'src', 'css', 'app-shell'),
                     join(VENDOR, 'kits', 'os', 'src', 'css', 'app-shell'),
                     'src/css/app-shell');

  // Bible / shell CSS sit at package root in upstream layout — mirror into kits/os/.
  for (const f of ['colors_and_type.css', 'app-shell.css']) {
    const src = join(pkgDir, f);
    const dst = join(VENDOR, 'kits', 'os', f);
    if (await exists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await cp(src, dst, { force: true });
      console.log('  copied', f);
    }
  }

  // Version stamp — read by validate harness / debug surface to witness which build is live.
  const stamp = {
    package: PKG,
    version,
    refreshedAt: new Date().toISOString(),
    source,
  };
  await writeFile(join(VENDOR, 'kits', 'os', '.version'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('  stamped .version =', version, source.startsWith('local:') ? '(local working tree)' : '');

  // docs/vendor.lock.json — record every path this script writes into
  // docs/vendor/ so scripts/doctor.mjs can catch hand-edits (the "fourth
  // copy" drift). Only list paths that actually exist post-copy so a
  // --local run against a partial upstream checkout doesn't lock in a hash
  // of nothing.
  const designPaths = [
    join('kits', 'os'),
    'components',
    'web-components',
    'webjsx',
    ...srcRootFiles,
  ];
  const items = [];
  for (const relPath of designPaths) {
    if (await exists(join(VENDOR, relPath))) items.push({ relPath, package: PKG, version, source });
  }
  await updateVendorLock(VENDOR, VENDOR_LOCK, items);

  if (tmp) await rm(tmp, { recursive: true, force: true });
  console.log(`done. vendored ${PKG}@${version} from ${source}.`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
