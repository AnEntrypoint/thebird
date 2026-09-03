#!/usr/bin/env node
// Refresh vendored gm plugkit wasm.
//
// Default: pulls the published tarball from npm gm-plugkit@latest, extracts
// the platform-agnostic plugkit.wasm + .sha256 + .version, copies into
// docs/vendor/gm/ and stamps the plugkit-wasm-wrapper.js alongside.
//
// --local [path]: copy directly from a working tree (default the
// vendor-src/gm git submodule, override with --local /custom/path or
// GM_LOCAL env var). The dev source of truth ships
// plugkit.{wasm,wasm.sha256,version} under bin/ and the loader wrapper
// under gm-plugkit/plugkit-wasm-wrapper.js.

import { mkdir, writeFile, readFile, rm, cp, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sh, exists, parseSourceFlags, npmViewVersion, resolveSiblingDefault, updateVendorLock } from './refresh-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = join(ROOT, 'docs', 'vendor');
const VENDOR = join(VENDOR_ROOT, 'gm');
const VENDOR_LOCK = join(ROOT, 'docs', 'vendor.lock.json');
const PKG = 'gm-plugkit';
const TAG = 'latest';

// Env var / --local flag always wins; otherwise prefer the vendor-src/gm
// git submodule, then a ../gm or ../gm-plugkit sibling checkout, falling
// back to the historical Windows dev-box default if none exist.
const defaultLocal = await resolveSiblingDefault(ROOT, ['gm', 'gm-plugkit'], 'C:/dev/gm');
const { wantsNpm, explicitLocal, localPath: pickedLocal } = parseSourceFlags('GM_LOCAL', defaultLocal);
function pickLocal() { return pickedLocal; }

// sh() + exists() + parseSourceFlags() live in scripts/refresh-common.mjs (imported above).

async function copyFile(src, dst, label) {
  if (!(await exists(src))) { console.log('  skip (missing)', label, '<-', src); return false; }
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: true });
  console.log('  copied', label);
  return true;
}

async function resolveSource() {
  const localPath = pickLocal();
  const localExists = await exists(localPath);
  const useLocal = !wantsNpm && (explicitLocal || localExists);
  if (useLocal) {
    if (!(await exists(localPath))) throw new Error(`--local path does not exist: ${localPath}`);
    // Local working tree may be the gm monorepo (c:/dev/gm) which carries
    // bin/plugkit.wasm + gm-plugkit/plugkit-wasm-wrapper.js. Or a path that
    // is directly the gm-plugkit package. Detect by file presence.
    const monoBin = join(localPath, 'bin', 'plugkit.wasm');
    const monoWrap = join(localPath, 'gm-plugkit', 'plugkit-wasm-wrapper.js');
    const monoVer = join(localPath, 'bin', 'plugkit.version');
    const flatWasm = join(localPath, 'plugkit.wasm');
    const flatWrap = join(localPath, 'plugkit-wasm-wrapper.js');
    let wasmSrc, wrapSrc, shaSrc, verSrc, pkgVersion;
    if (await exists(monoBin)) {
      wasmSrc = monoBin;
      shaSrc = join(localPath, 'bin', 'plugkit.wasm.sha256');
      verSrc = monoVer;
      wrapSrc = monoWrap;
      // gm-skill umbrella package.json carries the meta version; plugkit
      // .version file carries the wasm content version.
      const skillPkg = join(localPath, 'package.json');
      if (await exists(skillPkg)) pkgVersion = JSON.parse(await readFile(skillPkg, 'utf8')).version;
    } else if (await exists(flatWasm)) {
      wasmSrc = flatWasm;
      shaSrc = join(localPath, 'plugkit.wasm.sha256');
      verSrc = join(localPath, 'plugkit.version');
      wrapSrc = flatWrap;
      const pj = join(localPath, 'package.json');
      if (await exists(pj)) pkgVersion = JSON.parse(await readFile(pj, 'utf8')).version;
    } else {
      throw new Error(`--local path missing plugkit.wasm: ${localPath} (checked bin/ and root)`);
    }
    // Verify the wrapper exists before reading version — wrapSrc is the
    // load-bearing ABI partner to the wasm; a partial/corrupted local checkout
    // missing the wrapper must not silently return a valid version and then let
    // copyFile() skip the wrapper, leaving the vendored ABI pair broken.
    if (!(await exists(wrapSrc))) throw new Error(`--local path missing ${wrapSrc}`);
    // Read the wasm .version file as canonical content version.
    let wasmVersion = 'unknown';
    if (await exists(verSrc)) wasmVersion = (await readFile(verSrc, 'utf8')).trim();
    // Same strict semver guard the npm path applies (see below): an empty or
    // whitespace-only plugkit.version must not get stamped into .version, where
    // it would poison future syncs that key on `version`.
    if (!/^\d+\.\d+\.\d+$/.test(wasmVersion)) throw new Error(`invalid plugkit version in local path: ${JSON.stringify(wasmVersion)}`);
    console.log(`refreshing ${PKG} wasm@${wasmVersion} (local: ${localPath}) into ${VENDOR}`);
    return { wasmSrc, wrapSrc, shaSrc, verSrc, version: wasmVersion, pkgVersion, tmp: null, source: `local:${localPath}` };
  }
  const version = await npmViewVersion(PKG, TAG);
  console.log(`refreshing ${PKG}@${version} (npm:${TAG}) into ${VENDOR}`);
  const tmp = join(tmpdir(), `gm-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const tgzName = sh('npm', ['pack', `${PKG}@${TAG}`, '--silent'], { cwd: tmp });
  console.log('  packed', join(tmp, tgzName));
  sh('tar', ['-xzf', tgzName], { cwd: tmp });
  const pkgDir = join(tmp, 'package');
  // gm-plugkit npm tarball ships plugkit.wasm at package root (per its files[]
  // entry; falls back to bin/ if found there instead).
  // The @latest tarball ships ONLY the wrapper + plugkit.version + a sha file
  // (named plugkit.sha256 as JSON {"plugkit.wasm":"<hex>",...}, or the older
  // plain plugkit.wasm.sha256). It does NOT ship the wasm itself — that lives
  // only as a plugkit-bin GitHub Release asset. So in --npm mode we read the
  // version + sha from the tarball, then download the matching release wasm.
  //
  // SLIM ARTIFACT: gm-plugkit publishes two wasm variants per release —
  // plugkit.wasm (~150MB, bundles the bge-small-en-v1.5 safetensors embedder
  // fallback) and plugkit-slim.wasm (~3.6MB, same ABI, no bundled embedder —
  // requires the host to implement host_vec_embed, which thebird now does via
  // the separately-vendored agentplug-bert bert.wasm, see refresh-bert.mjs and
  // docs/lib/freddie-host-bert.js). thebird fetches SLIM: it fits GitHub's
  // 100MB single-file cap (so it CAN be committed, unlike the old fat wasm,
  // though this script still fetches it at refresh-time for the always-latest
  // contract) and eliminates the Cloudflare Worker CORS-proxy dependency the
  // fat wasm needed.
  const verCands = [join(pkgDir, 'plugkit.version'), join(pkgDir, 'bin', 'plugkit.version')];
  let verSrc = null;
  for (const v of verCands) { if (await exists(v)) { verSrc = v; break; } }
  if (!verSrc) throw new Error(`plugkit.version not found in ${PKG}@${version} tarball`);
  const wasmVersion = (await readFile(verSrc, 'utf8')).trim();
  // Guard: wasmVersion is interpolated into a download URL below. A malformed
  // value from a compromised/garbled tarball (e.g. '../../x', 'v999') must not
  // reach URL construction. Match the strict semver shape freddie-host.js uses.
  if (!/^\d+\.\d+\.\d+$/.test(wasmVersion)) throw new Error(`invalid plugkit version in tarball: ${JSON.stringify(wasmVersion)}`);
  const base = dirname(verSrc);
  const wrapSrc = join(base, 'plugkit-wasm-wrapper.js');
  // Resolve expected sha from whichever sha file the tarball ships. The slim
  // artifact's sha lives in the same JSON manifest under its own key, or a
  // dedicated plugkit-slim.wasm.sha256 sidecar.
  let expectedSha = null;
  const jsonSha = join(base, 'plugkit.sha256');
  const slimSha = join(base, 'plugkit-slim.wasm.sha256');
  if (await exists(jsonSha)) {
    const manifest = JSON.parse(await readFile(jsonSha, 'utf8'));
    expectedSha = manifest['plugkit-slim.wasm'] || null;
  } else if (await exists(slimSha)) {
    expectedSha = (await readFile(slimSha, 'utf8')).trim().split(/\s+/)[0];
  }
  // Download the matching release wasm. The plugkit-bin RELEASE wasm is the
  // ABI ground truth, paired with the wrapper@version from the same install.
  // The tarball's own sha file has been observed to lag its version field
  // (publish-side skew), so we do NOT reject on it — we record the actual
  // downloaded-wasm sha. If the tarball sha disagrees we warn (diagnostic only).
  const dlWasm = join(tmp, 'plugkit-slim.wasm');
  const url = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${wasmVersion}/plugkit-slim.wasm`;
  console.log(`  downloading release wasm ${url}`);
  sh('curl', ['-fsSL', '--retry', '3', '--retry-delay', '5', '-o', dlWasm, url]);
  const dlStats = await stat(dlWasm);
  if (dlStats.size < 1_000_000) throw new Error(`plugkit-slim.wasm download incomplete: ${dlStats.size} bytes (expected ~3-4MB)`);
  const { createHash } = await import('node:crypto');
  const actualSha = createHash('sha256').update(await readFile(dlWasm)).digest('hex');
  if (expectedSha && expectedSha !== actualSha) {
    console.log(`  WARN: tarball plugkit.sha256 (${expectedSha.slice(0, 12)}) != release wasm sha (${actualSha.slice(0, 12)}) for v${wasmVersion} — using release wasm (canonical).`);
  }
  console.log(`  wasm sha256 = ${actualSha} (${wasmVersion})`);
  // Write a normalized plain-text sha file the loader + CI expect. Vendored
  // destination filename stays plugkit.wasm (not plugkit-slim.wasm) — the
  // browser loader (docs/lib/freddie-host-plugkit.js) fetches by that fixed
  // name, and keeping it unchanged is the smaller diff; docs/vendor/gm/.version
  // (below) is the source of truth for WHICH artifact is actually inside.
  const normShaSrc = join(tmp, 'plugkit.wasm.sha256');
  await writeFile(normShaSrc, `${actualSha}  plugkit.wasm\n`);
  return { wasmSrc: dlWasm, wrapSrc, shaSrc: normShaSrc, verSrc, version: wasmVersion, pkgVersion: version, tmp, source: `npm:${PKG}@${TAG}` };
}

async function main() {
  const { wasmSrc, wrapSrc, shaSrc, verSrc, version, pkgVersion, tmp, source } = await resolveSource();

  const wroteWasm = await copyFile(wasmSrc, join(VENDOR, 'plugkit.wasm'), 'plugkit.wasm (slim variant)');
  await copyFile(verSrc,  join(VENDOR, 'plugkit.version'), 'plugkit.version');
  await copyFile(wrapSrc, join(VENDOR, 'plugkit-wasm-wrapper.js'), 'plugkit-wasm-wrapper.js');

  // Vendor the agent-facing prose bundle so thebird's in-page wasm resolver can
  // serve editable prose from the instance fs; absent it the wasm falls back to
  // its compiled const. The bundle ships inside gm-plugkit (files: instructions/)
  // and sits beside the wrapper in both local and npm-tarball layouts. Emit an
  // index.json the in-page loader fetches (the browser cannot readdir a static
  // dir over HTTP) so it knows which keys to provision.
  const instructionsSrc = join(dirname(wrapSrc), 'instructions');
  if (await exists(instructionsSrc)) {
    const instructionsDst = join(VENDOR, 'instructions');
    await rm(instructionsDst, { recursive: true, force: true });
    await cp(instructionsSrc, instructionsDst, { recursive: true, force: true });
    const keys = [];
    const walk = async (rel) => {
      const dir = join(instructionsSrc, rel);
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) { await walk(childRel); continue; }
        if (childRel.endsWith('.md')) keys.push(childRel.slice(0, -3));
      }
    };
    await walk('');
    keys.sort();
    await writeFile(join(instructionsDst, 'index.json'), JSON.stringify({ keys }, null, 2) + '\n');
    console.log(`  vendored instructions bundle (${keys.length} keys)`);
  } else {
    console.log('  skip (missing) instructions bundle <-', instructionsSrc);
  }

  // Coordinated sha: the sha file MUST describe the wasm we actually vendored,
  // not whatever the source tree shipped (which can lag — see --npm WARN above).
  // Recompute from the copied wasm, warn if the source sha disagrees, and write
  // the normalized plain-text sha the loader + CI expect.
  // Always validate and recompute sha from the actual vendored wasm, regardless
  // of whether we just wrote it.  When wroteWasm=false the wasm already on disk
  // must still be healthy — a stale/corrupt artifact failing here is far better
  // than silently propagating a bad sha that freddie-host.js will later trust.
  const vendoredWasmPath = join(VENDOR, 'plugkit.wasm');
  if (!(await exists(vendoredWasmPath))) {
    throw new Error('vendored plugkit.wasm missing after copy step — cannot compute sha');
  }
  const { createHash } = await import('node:crypto');
  const wasmBuf = await readFile(vendoredWasmPath);
  // Sanity: must be real wasm (magic 0x00 61 73 6d) and non-trivial size —
  // mirrors the gh-pages.yml CI guard so a corrupted/truncated/wrong file
  // (failed --local copy or bad download) fails loud here, not silently at
  // browser cold-load of the load-bearing artifact.
  const magic = wasmBuf.subarray(0, 4).toString('hex');
  if (magic !== '0061736d' || wasmBuf.length < 1000000) {
    throw new Error(`vendored plugkit.wasm not valid wasm (magic=${magic} size=${wasmBuf.length})`);
  }
  const vendoredSha = createHash('sha256').update(wasmBuf).digest('hex');
  if (wroteWasm) {
    let srcSha = null;
    if (shaSrc && await exists(shaSrc)) {
      const raw = (await readFile(shaSrc, 'utf8')).trim();
      srcSha = raw.startsWith('{') ? JSON.parse(raw)['plugkit.wasm'] : raw.split(/\s+/)[0];
    }
    if (srcSha && srcSha !== vendoredSha) {
      console.log(`  WARN: source sha (${srcSha.slice(0, 12)}) != vendored wasm sha (${vendoredSha.slice(0, 12)}) — recording vendored sha (canonical).`);
    }
  }
  await writeFile(join(VENDOR, 'plugkit.wasm.sha256'), `${vendoredSha}  plugkit.wasm\n`);
  console.log('  validated plugkit.wasm.sha256 =', vendoredSha);

  // Version stamp — canonical {package,version,refreshedAt,source} shared with
  // refresh-design + refresh-freddie, plus gm-only pkgVersion: `version` is the
  // wasm CONTENT version while pkgVersion is the npm package version (they can
  // skew). Readers (sync-upstream.mjs) key on `version` and ignore extras.
  const stamp = {
    package: PKG,
    version,
    pkgVersion: pkgVersion || version,
    refreshedAt: new Date().toISOString(),
    source,
  };
  await writeFile(join(VENDOR, '.version'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('  stamped .version =', version, source.startsWith('local:') ? '(local working tree)' : '');

  // docs/vendor.lock.json — record what this script wrote (relative to
  // docs/vendor/) so scripts/doctor.mjs can catch hand-edited vendored code.
  const gmPaths = ['plugkit.wasm', 'plugkit.version', 'plugkit-wasm-wrapper.js', 'plugkit.wasm.sha256', 'instructions']
    .map(f => join('gm', f));
  const items = [];
  for (const relPath of gmPaths) {
    if (await exists(join(VENDOR_ROOT, relPath))) items.push({ relPath, package: PKG, version, source });
  }
  await updateVendorLock(VENDOR_ROOT, VENDOR_LOCK, items);

  if (tmp) await rm(tmp, { recursive: true, force: true });
  console.log(`done. vendored ${PKG} wasm@${version} from ${source}.`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
