import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESBUILD_VERSION, loadEsbuild } from './esbuild-pin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const floosieRepo = process.env.FLOOSIE_REPO ?? join(root, '..', 'floosie');
const out = join(root, 'web', 'vendor', 'floosie');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

export async function vendorFloosie() {
  if (!existsSync(join(floosieRepo, 'src', 'browser.ts'))) {
    throw new Error(`floosie browser entry is missing at ${floosieRepo}: set FLOOSIE_REPO to a checkout of AnEntrypoint/floosie main`);
  }
  if (!existsSync(join(floosieRepo, 'node_modules'))) {
    throw new Error(`floosie has no node_modules at ${floosieRepo}: run npm ci in that checkout first`);
  }
  const esbuild = await loadEsbuild();
  mkdirSync(out, { recursive: true });
  const bundle = join(out, 'browser.js');
  await esbuild.build({
    absWorkingDir: floosieRepo,
    entryPoints: ['src/browser.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: bundle,
    sourcemap: false,
    minify: false,
  });
  if (!existsSync(bundle)) throw new Error(`floosie browser bundle is missing after the build: ${bundle}`);
  const text = readFileSync(bundle, 'utf8');
  if (/from\s+["']node:/m.test(text) || /require\(["']node:/m.test(text)) throw new Error('the floosie browser bundle still imports a node: module');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: floosieRepo, encoding: 'utf8' }).trim();
  const manifest = {
    generator: 'scripts/vendor-floosie.mjs',
    source: 'AnEntrypoint/floosie',
    commit,
    builder: { esbuild: ESBUILD_VERSION },
    browser: { name: 'browser.js', sha256: sha256(bundle) },
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await vendorFloosie();
  console.log(`floosie vendor written to ${result.out}: ${result.manifest.commit.slice(0, 12)} ${result.manifest.browser.sha256.slice(0, 12)}`);
}
