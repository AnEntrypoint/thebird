import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const floosieRepo = process.env.FLOOSIE_REPO ?? join(root, '..', 'floosie');
const out = join(root, 'web', 'vendor', 'floosie');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

export async function vendorFloosie() {
  if (!existsSync(join(floosieRepo, 'src', 'browser.ts'))) {
    throw new Error(`floosie browser entry is missing at ${floosieRepo}: set FLOOSIE_REPO to a checkout of AnEntrypoint/floosie main`);
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', 'build:browser'], { cwd: floosieRepo, stdio: 'inherit' });
  const built = join(floosieRepo, 'dist', 'browser.js');
  if (!existsSync(built)) throw new Error(`floosie browser bundle is missing after the build: ${built}`);
  mkdirSync(out, { recursive: true });
  copyFileSync(built, join(out, 'browser.js'));
  const bundle = join(out, 'browser.js');
  const text = readFileSync(bundle, 'utf8');
  if (/from\s+["']node:/m.test(text) || /require\(["']node:/m.test(text)) throw new Error('the floosie browser bundle still imports a node: module');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: floosieRepo, encoding: 'utf8' }).trim();
  const manifest = {
    generator: 'scripts/vendor-floosie.mjs',
    source: 'AnEntrypoint/floosie',
    commit,
    browser: { name: 'browser.js', sha256: sha256(bundle) },
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await vendorFloosie();
  console.log(`floosie vendor written to ${result.out}: ${result.manifest.commit.slice(0, 12)} ${result.manifest.browser.sha256.slice(0, 12)}`);
}
