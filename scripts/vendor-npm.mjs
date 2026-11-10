import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESBUILD_VERSION, loadEsbuild } from './esbuild-pin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'vendor', 'npm');
const REGISTRY = 'https://registry.npmjs.org';
const PACKAGES = [
  { name: 'fflate', version: '0.8.3', license: 'MIT', integrity: 'sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==' },
  { name: '@noble/hashes', version: '2.4.0', license: 'MIT', integrity: 'sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==' },
  { name: 'semver', version: '7.8.6', license: 'ISC', integrity: 'sha512-9lpSSU4Mly3mrtruwLs1eLK6+gzbzqeBFwRNjIjE+9LuDpWdYctrQlQ3ej1Ilgi7gknpsTRnPoLP8DpCHqHIJw==' },
  { name: 'acorn', version: '8.18.0', license: 'MIT', integrity: 'sha512-lGq+9yr1/GuAWaVYIHRjvvySG5/4VfKIvC8EWxStPdcDh/Ka7FG3twP6v4d5BkravUilhIAsG4Qj83t02LWUPQ==' },
];
const ENTRY = "import { gunzipSync } from 'fflate';\nimport { sha512 } from '@noble/hashes/sha2.js';\nimport semver from 'semver';\nimport * as acorn from 'acorn';\nexport { gunzipSync, sha512, semver, acorn };\n";

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha512 = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const tarballOf = ({ name, version }) => `${REGISTRY}/${name}/-/${name.split('/').pop()}-${version}.tgz`;
const noticeOf = ({ name }) => `licenses/${name.replace('/', '-').replace('@', '')}.md`;

async function fetchPackage(pkg, dir) {
  const url = tarballOf(pkg);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const integrity = sha512(bytes);
  if (integrity !== pkg.integrity) throw new Error(`${pkg.name}@${pkg.version}: integrity ${integrity} does not match the pin ${pkg.integrity}`);
  const archive = join(dir, `${pkg.name.replace('/', '-').replace('@', '')}-${pkg.version}.tgz`);
  writeFileSync(archive, bytes);
  const target = join(dir, 'node_modules', pkg.name);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', target, '--strip-components=1']);
  const licensePath = join(target, 'LICENSE');
  if (!existsSync(licensePath)) throw new Error(`${pkg.name}@${pkg.version} has no LICENSE file`);
  return readFileSync(licensePath, 'utf8');
}

const noticeText = (pkg, license) => `# ${pkg.name} ${pkg.version}

Vendored by scripts/vendor-npm.mjs into web/vendor/npm/npm-libs.js from ${tarballOf(pkg)}, integrity ${pkg.integrity}. Licence: ${pkg.license}. The text below is the LICENSE file of that tarball, unchanged.

${license.trimEnd()}
`;

export async function vendorNpm() {
  const esbuild = await loadEsbuild();
  const work = mkdtempSync(join(tmpdir(), 'thebird-npm-vendor-'));
  try {
    const licenses = [];
    for (const pkg of PACKAGES) licenses.push([pkg, await fetchPackage(pkg, work)]);
    writeFileSync(join(work, 'entry.js'), ENTRY);
    mkdirSync(join(out, 'licenses'), { recursive: true });
    const bundle = join(out, 'npm-libs.js');
    await esbuild.build({
      absWorkingDir: work,
      entryPoints: ['entry.js'],
      bundle: true,
      format: 'iife',
      globalName: 'thebirdNpmLibs',
      platform: 'browser',
      target: 'es2022',
      outfile: bundle,
      minify: true,
      legalComments: 'none',
      sourcemap: false,
    });
    const text = readFileSync(bundle, 'utf8');
    if (/["'`]node:/.test(text) || /require\(["']fs["']\)/.test(text)) throw new Error('the npm bundle imports a Node built-in');
    for (const [pkg, license] of licenses) writeFileSync(join(out, noticeOf(pkg)), noticeText(pkg, license));
    const manifest = {
      generator: 'scripts/vendor-npm.mjs',
      builder: { esbuild: ESBUILD_VERSION },
      bundle: { name: 'npm-libs.js', sha256: sha256(readFileSync(bundle)) },
      packages: PACKAGES.map((pkg) => ({ name: pkg.name, version: pkg.version, license: pkg.license, integrity: pkg.integrity, tarball: tarballOf(pkg), notice: noticeOf(pkg) })),
    };
    writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { out, manifest };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await vendorNpm();
  console.log(`npm vendor written to ${result.out}: bundle ${result.manifest.bundle.sha256.slice(0, 12)}`);
}
