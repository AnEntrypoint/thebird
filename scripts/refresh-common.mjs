// Shared helpers for the vendor-refresh scripts (refresh-design / refresh-freddie
// / refresh-gm). Extracted to a single spine so the shell-quoting and file-check
// logic has one home instead of three identical copies.
import { execFileSync } from 'node:child_process';
import { stat, mkdir, readFile, readdir, cp, writeFile, rm } from 'node:fs/promises';
import { resolve as resolvePath, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// Parse the source-selection flags shared by all three refresh scripts:
// --local [path] (path may also come from the named env var, else defaultPath),
// --npm (force npm tarball; used by freddie/gm local-by-default logic).
// Returns { wantsNpm, explicitLocal, localPath }.
export function parseSourceFlags(envVarName, defaultPath, argv = process.argv.slice(2)) {
  const localFlagIdx = argv.indexOf('--local');
  const wantsNpm = argv.includes('--npm');
  const explicitLocal = localFlagIdx !== -1 || !!process.env[envVarName];
  const fromArg = (localFlagIdx !== -1 && argv[localFlagIdx + 1] && !argv[localFlagIdx + 1].startsWith('-'))
    ? argv[localFlagIdx + 1] : null;
  const picked = fromArg || process.env[envVarName] || defaultPath;
  const localPath = picked ? resolvePath(picked) : null;
  return { wantsNpm, explicitLocal, localPath };
}

// Run a command with args. shell:true so Windows resolves npm.cmd / tar.exe via
// PATH the same way macOS/Linux resolve npm/tar.
export function sh(cmd, args, opts = {}) {
  const quoted = args.map(a => /[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ');
  return execFileSync(`${cmd} ${quoted}`, { stdio: ['ignore', 'pipe', 'inherit'], shell: true, timeout: 120000, ...opts }).toString().trim();
}

// Resolve a package's published version directly against the npm registry
// HTTP API instead of shelling out to `npm view` — removes the shell:true
// execFileSync dependency on a locally-installed npm binary being on PATH
// (a real gap on some Windows setups) for the one thing all four
// refresh/sync scripts need: "what version does npm currently point <tag>
// at". Only `latest` is supported (registry.npmjs.org/<pkg>/latest is the
// dist-tag shortcut) — every current call site passes tag='latest'.
// Returns the semver string, or throws with the same class of message
// `npm view` failures produced (callers already handle thrown errors).
export async function npmViewVersion(pkg, tag = 'latest') {
  if (tag !== 'latest') throw new Error(`npmViewVersion: unsupported tag ${JSON.stringify(tag)} (only 'latest' is implemented)`);
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg).replace(/^%40/, '@')}/latest`;
  const res = await fetch(url);
  if (res.status === 404) { const e = new Error(`${pkg} not found in npm registry (404)`); e.notFound = true; throw e; }
  if (!res.ok) throw new Error(`npm registry lookup failed for ${pkg}: HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  const version = json && json.version;
  if (!version) throw new Error(`npm registry response for ${pkg} missing .version field`);
  return version;
}

export async function exists(p) { try { await stat(p); return true; } catch { return false; } }

// Local-checkout discovery for the --local default. gm/design/freddie/acptoapi
// are vendored as real git submodules at vendor-src/<name> (see .gitmodules) —
// that's checked first so `git submodule update --init` alone gives every dev
// box a working --local default with zero extra configuration. A plain sibling
// checkout (../anentrypoint-design, ../freddie, ../gm — the layout some
// standalone multi-repo dev setups still use) is checked second for anyone
// who prefers a separate clone over the submodule. Env var / --local flag
// (handled by parseSourceFlags) always wins over both; this only supplies the
// *fallback* default passed in as parseSourceFlags(..., defaultPath). Falls
// back to `fallback` (the historical hardcoded path) if neither location has
// a real package checkout (package.json present).
export async function resolveSiblingDefault(root, names, fallback) {
  for (const name of names) {
    const vendored = resolvePath(join(root, 'vendor-src', name));
    if (await exists(join(vendored, 'package.json'))) return vendored;
  }
  for (const name of names) {
    const candidate = resolvePath(join(root, '..', name));
    if (await exists(join(candidate, 'package.json'))) return candidate;
  }
  return fallback;
}

// Copy src -> dst (recursive: handles both a single file and a whole subtree),
// returning the number of entries copied (0 if src is missing, 1 for a file).
// Shared by refresh-design / refresh-freddie so the mkdir + cp + count + log
// dance lives in one place. refresh-gm keeps its own file-only copyFile() — it
// returns a boolean gate (wroteWasm) and copies single load-bearing artifacts.
export async function copyIfExists(src, dst, label) {
  if (!(await exists(src))) { console.log('  skip (missing)', label); return 0; }
  await mkdir(dirname(dst), { recursive: true });
  // Directory copies must clear the destination first: cp({recursive,force})
  // overlays onto whatever is already there but never deletes a file that
  // existed in a PRIOR vendored snapshot and was since removed upstream --
  // stale files (e.g. a deprecated/removed CSS module) silently lingered
  // forever, no matter how many times this ran. A file-to-file copy has no
  // such problem (force:true already overwrites the single target).
  if ((await stat(src)).isDirectory()) await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true, force: true });
  let n = 1;
  try { const st = await stat(src); if (st.isDirectory()) n = (await readdir(src, { recursive: true })).length; } catch { /* swallow: entry-count is cosmetic for the log line only; stat/readdir failure leaves n at its default of 1 */ }
  console.log('  copied', label, `(${n} entries)`);
  return n;
}

// Shared local-tree-vs-npm-tarball source resolution for the two flat-layout
// refresh scripts (refresh-design / refresh-freddie). Both return the same
// { pkgDir, version, tmp, source } shape: pkgDir is the package root to copy
// from, tmp (if non-null) is a temp dir the caller must rm after copying.
// refresh-gm.mjs does NOT use this — its multi-file layout detection + GitHub
// release download are an architectural mismatch and stay bespoke.
export async function resolvePkgSource({ pkg, tag, useLocal, localPath, tmpPrefix }) {
  if (useLocal) {
    if (!(await exists(localPath))) throw new Error(`--local path does not exist: ${localPath}`);
    const localPkgJson = join(localPath, 'package.json');
    if (!(await exists(localPkgJson))) throw new Error(`--local path missing package.json: ${localPath}`);
    const pkgMeta = JSON.parse(await readFile(localPkgJson, 'utf8'));
    if (pkgMeta.name !== pkg) throw new Error(`--local path is not ${pkg} (found ${pkgMeta.name})`);
    return { pkgDir: localPath, version: pkgMeta.version, tmp: null, source: `local:${localPath}` };
  }
  const version = await npmViewVersion(pkg, tag);
  if (!/^\d+\.\d+\.\d+(-[a-z0-9.]+)?(\+[a-z0-9.]+)?$/i.test(version))
    throw new Error(`npm registry lookup for ${pkg}@${tag} returned unexpected version string: ${version}`);
  const tmp = join(tmpdir(), `${tmpPrefix}-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const tgzName = sh('npm', ['pack', `${pkg}@${tag}`, '--silent'], { cwd: tmp });
  if (!tgzName) throw new Error(`npm pack ${pkg}@${tag} returned empty filename`);
  console.log('  packed', join(tmp, tgzName));
  sh('tar', ['-xzf', tgzName], { cwd: tmp });
  return { pkgDir: join(tmp, 'package'), version, tmp, source: `npm:${pkg}@${tag}` };
}

// ---------------------------------------------------------------------
// docs/vendor.lock.json — a single manifest covering every file/directory
// the three refresh-*.mjs scripts write under docs/vendor/. Each entry
// records the source package/version/origin plus a content sha256 so
// scripts/doctor.mjs can detect hand-edits to vendored code (the "fourth
// copy" drift AGENTS.md's vendor pipelines exist to prevent).
// ---------------------------------------------------------------------

// Recursively hash a single file's contents.
//
// Normalizes CRLF -> LF before hashing (line-ending-insensitive), because
// docs/vendor.lock.json's hashes must be stable across the platforms that
// actually author/verify it: this repo's .gitattributes forces `eol=lf` in
// the git BLOB for every *.js/*.mjs/*.json/etc, but a Windows checkout with
// core.autocrlf=true still gets CRLF bytes on DISK -- so a raw byte-hash
// computed on Windows (where refresh-*.mjs is commonly run) can never match
// the same content hashed on Linux CI (LF on disk), even with byte-identical
// git history and zero real drift. Bug found + fixed live 2026-07-17: EVERY
// entry in a freshly-regenerated docs/vendor.lock.json (this same commit's
// authoring session, on Windows) failed doctor.mjs on the very next CI run
// because of exactly this -- confirmed by comparing `git show HEAD:<path>`
// (the true LF blob CI sees) against the Windows on-disk bytes directly.
// A raw binary file (the sha256 signature check below handles those, plus
// gm/plugkit.wasm which is gitignored entirely) has no meaningful concept of
// line endings, so this only ever changes bytes when '\r\n' is present, and
// silently no-ops otherwise -- byte-identical result on any input already
// free of CRLF (Linux/macOS checkouts, or a file with no line-ending content).
async function sha256OfFile(absPath) {
  const buf = await readFile(absPath);
  const isProbablyBinary = buf.subarray(0, 8000).includes(0);
  const normalized = isProbablyBinary ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'));
  return createHash('sha256').update(normalized).digest('hex');
}

// Deterministically hash a directory tree: walk all files (sorted by
// posix-style relative path), hash each, then hash the sorted
// "relpath\0filehash\n" listing. Stable across re-copies of identical
// content, changes on any file add/remove/edit anywhere in the subtree.
async function sha256OfDir(absPath) {
  const files = [];
  async function walk(rel) {
    const dirAbs = join(absPath, rel);
    const entries = await readdir(dirAbs, { withFileTypes: true });
    for (const ent of entries) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(childRel);
      else files.push(childRel.split('\\').join('/'));
    }
  }
  await walk('');
  files.sort();
  const lines = [];
  for (const rel of files) {
    const h = await sha256OfFile(join(absPath, rel));
    lines.push(`${rel}\0${h}`);
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

// Hash a vendored path (file or directory), returning { type, sha256 }.
// Missing paths return null (caller decides whether that's fatal).
export async function hashVendorEntry(absPath) {
  if (!(await exists(absPath))) return null;
  const st = await stat(absPath);
  if (st.isDirectory()) return { type: 'dir', sha256: await sha256OfDir(absPath) };
  return { type: 'file', sha256: await sha256OfFile(absPath) };
}

const LOCK_VERSION = 1;

export async function readVendorLock(vendorLockPath) {
  if (!(await exists(vendorLockPath))) return { lockVersion: LOCK_VERSION, entries: {} };
  try {
    const json = JSON.parse(await readFile(vendorLockPath, 'utf8'));
    if (!json.entries) json.entries = {};
    // Normalize entry keys to forward slashes. Windows refresh runs used to
    // write path.join-shaped keys ("gm\\plugkit.wasm") alongside the canonical
    // posix keys doctor.mjs checks, leaving the posix entries stale forever
    // (found live 2026-07-29: doctor FAILed every entry right after a fresh
    // refresh). On collision keep the newer updatedAt — that is the fresh one.
    const normalized = {};
    for (const [k, v] of Object.entries(json.entries)) {
      const key = k.split('\\').join('/');
      const prev = normalized[key];
      if (!prev || String(v.updatedAt || '') >= String(prev.updatedAt || '')) normalized[key] = v;
    }
    json.entries = normalized;
    return json;
  } catch {
    return { lockVersion: LOCK_VERSION, entries: {} };
  }
}

// Merge-update docs/vendor.lock.json: for each { relPath, package, version,
// source } in `items` (relPath relative to docs/vendor/), (re)compute the
// current on-disk hash and write/replace that entry. Entries for paths not
// touched by this run are left untouched (each refresh-*.mjs script only
// owns its own subset of paths). `vendorRoot` is the docs/vendor/ dir,
// `lockPath` is docs/vendor.lock.json.
export async function updateVendorLock(vendorRoot, lockPath, items) {
  const lock = await readVendorLock(lockPath);
  lock.lockVersion = LOCK_VERSION;
  const now = new Date().toISOString();
  for (const item of items) {
    const relKey = item.relPath.split('\\').join('/');
    const abs = join(vendorRoot, item.relPath);
    const hashed = await hashVendorEntry(abs);
    if (!hashed) {
      console.log(`  vendor.lock: skip (missing on disk) ${relKey}`);
      continue;
    }
    lock.entries[relKey] = {
      package: item.package,
      version: item.version,
      source: item.source,
      type: hashed.type,
      sha256: hashed.sha256,
      updatedAt: now,
    };
  }
  // Stable key order for clean diffs.
  const sortedEntries = {};
  for (const k of Object.keys(lock.entries).sort()) sortedEntries[k] = lock.entries[k];
  lock.entries = sortedEntries;
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`  vendor.lock: updated ${items.length} entrie(s) -> ${lockPath}`);
  return lock;
}
