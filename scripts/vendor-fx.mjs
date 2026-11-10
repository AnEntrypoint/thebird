import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fxRepo = process.env.FX_REPO ?? join(root, '..', 'fx', 'fx');
const out = join(root, 'web', 'vendor', 'fx');
const modules = [
  'core-output.js',
  'chatgpt.js',
  'custom-provider.js',
  'engine.js',
  'fetch-cleanup.js',
  'grok.js',
  'subscription.js',
  'tool-observation.js',
  'wasm-module.js',
  'wasm-runtime.js',
];

const zig = () => {
  const candidates = [process.env.ZIG, '/usr/local/bin/zig', '/usr/bin/zig'];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('fx WASM needs Zig 0.17.1: set ZIG to the zig executable');
  return found;
};

const run = (command, args) => execFileSync(command, args, { cwd: fxRepo, stdio: 'inherit' });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

export async function vendorFx() {
  const wasm = join(fxRepo, 'zig-out', 'bin', 'fx-core.wasm');
  if (!existsSync(wasm) || process.env.FX_REBUILD === '1') run(zig(), ['build', '-Dwasm-surface=core']);
  if (!existsSync(wasm)) throw new Error(`fx-core.wasm is missing after the build: ${wasm}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const names = ['fx-core.wasm', ...modules];
  for (const name of names) copyFileSync(name === 'fx-core.wasm' ? wasm : join(fxRepo, 'sdk', name), join(out, name));
  const manifest = {
    generator: 'scripts/vendor-fx.mjs',
    source: 'local fx checkout',
    sdkApiVersion: 2,
    wasm: { name: 'fx-core.wasm', sha256: sha256(join(out, 'fx-core.wasm')) },
    modules: modules.map((name) => ({ name, sha256: sha256(join(out, name)) })),
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await vendorFx();
  console.log(`fx vendor written to ${result.out}: ${result.manifest.wasm.sha256.slice(0, 12)}`);
}
