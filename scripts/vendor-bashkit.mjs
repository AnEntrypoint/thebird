import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASHKIT_VERSION = '0.20.3';
const FILES = ['index.js', 'bashkit_wasm.js', 'bashkit_wasm_bg.wasm', 'runtime-functions.js', 'package.json', 'README.md'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'web', 'vendor', 'bashkit');

export async function vendorBashkit() {
  const work = mkdtempSync(join(tmpdir(), 'vendor-bashkit-'));
  try {
    const tarball = execFileSync('npm', ['pack', `@everruns/bashkit-wasm@${BASHKIT_VERSION}`, '--silent'], { cwd: work, encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
    const pkg = join(work, 'package');
    const info = JSON.parse(readFileSync(join(pkg, 'build-info.json'), 'utf8'));
    const digest = createHash('sha256').update(readFileSync(join(pkg, 'bashkit_wasm_bg.wasm'))).digest('hex');
    if (digest !== info.wasmSha256) throw new Error(`bashkit wasm sha256 ${digest} does not match build-info ${info.wasmSha256}`);
    mkdirSync(target, { recursive: true });
    for (const file of FILES) copyFileSync(join(pkg, file), join(target, file));
    return { version: info.version, sha256: digest, dir: target };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const done = await vendorBashkit();
  console.log(`vendored @everruns/bashkit-wasm ${done.version} into ${done.dir} (wasm sha256 ${done.sha256})`);
}
