#!/usr/bin/env node
// Refresh the vendored @spoint/ecs package (docs/vendor/spoint-ecs/), consumed
// by docs/lib/ecs.js and (through it) the level-editor/boids/snake-ecs apps.
//
// UNLIKE refresh-design/refresh-freddie/refresh-gm, this has no npm-tarball
// fallback: @spoint/ecs is not published to npm (confirmed via `npm view
// @spoint/ecs version` -> 404, packages/ecs is a git-only subpackage of the
// AnEntrypoint/spoint monorepo) so the ONLY source of truth is a sibling
// working-tree checkout. There is no --npm mode here; a missing sibling is a
// hard failure, not a silent no-op, because there is no fallback source that
// could ever paper over it.
//
// --local [path]: point at a custom spoint checkout (default C:/dev/spoint,
// override with --local /custom/path or SPOINT_LOCAL env var). The ECS
// package lives at packages/ecs under the monorepo root, not at the root
// itself — this script joins that subpath internally.

import { writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { exists, parseSourceFlags, resolveSiblingDefault, copyIfExists, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = join(ROOT, 'docs', 'vendor');
const VENDOR = join(VENDOR_ROOT, 'spoint-ecs');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = '@spoint/ecs';

// Sibling discovery: the monorepo root is named `spoint`, but the actual
// package lives at packages/ecs under it — resolveSiblingDefault checks for
// a package.json directly at the candidate path, so it must be pointed at
// the subpackage dir, not the monorepo root, for its existence check to work.
const defaultLocal = await resolveSiblingDefault(ROOT, ['spoint/packages/ecs'], 'C:/dev/spoint/packages/ecs');
const { explicitLocal, localPath } = parseSourceFlags('SPOINT_ECS_LOCAL', defaultLocal);

async function main() {
  if (!(await exists(localPath))) {
    throw new Error(
      `spoint-ecs sibling checkout not found at ${localPath}. @spoint/ecs is not published to npm ` +
      `(git-only subpackage of AnEntrypoint/spoint) so there is no fallback source — pass --local <path> ` +
      `or set SPOINT_ECS_LOCAL to a real packages/ecs checkout.`
    );
  }
  const pkgJsonPath = join(localPath, 'package.json');
  if (!(await exists(pkgJsonPath))) throw new Error(`--local path missing package.json: ${localPath}`);
  const pkgMeta = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
  if (pkgMeta.name !== PKG) throw new Error(`--local path is not ${PKG} (found ${pkgMeta.name})`);
  const version = pkgMeta.version;
  const source = `local:${localPath}`;
  console.log(`refreshing ${PKG}@${version} (${source}) into ${VENDOR}`);

  // Copy only .js source files, never the whole src/ tree wholesale — the
  // sibling checkout's own build tooling leaves brotli-precompressed CDN
  // artifacts (*.js.br, *.js.br.meta) alongside the real sources in the same
  // directory, and a directory-level copyIfExists would vendor those too.
  const srcDir = join(localPath, 'src');
  const jsFiles = (await readdir(srcDir)).filter(f => f.endsWith('.js'));
  let copiedAny = false;
  for (const f of jsFiles) {
    const n = await copyIfExists(join(srcDir, f), join(VENDOR, 'src', f), join('src', f));
    if (n) copiedAny = true;
  }
  if (!copiedAny) throw new Error(`no .js files found in ${srcDir} — sibling checkout looks wrong`);
  await copyIfExists(pkgJsonPath, join(VENDOR, 'package.json'), 'package.json');

  const stamp = { package: PKG, version, refreshedAt: new Date().toISOString(), source };
  await writeFile(join(VENDOR, '.version'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('  stamped .version =', version, '(local working tree)');

  const items = [];
  for (const relPath of ['src', 'package.json'].map(f => join('spoint-ecs', f))) {
    if (await exists(join(VENDOR_ROOT, relPath))) items.push({ relPath, package: PKG, version, source });
  }
  await updateVendorLock(VENDOR_ROOT, VENDOR_LOCK, items);

  console.log(`done. vendored ${PKG}@${version} from ${source}.`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
