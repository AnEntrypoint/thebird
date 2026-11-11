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
  'wasm-terminal.js',
  'xterm.js',
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
  const termWasm = join(fxRepo, 'zig-out', 'bin', 'fx-term.wasm');
  if (!existsSync(termWasm) || process.env.FX_REBUILD === '1') run(zig(), ['build', 'fx-term-wasm', '-Dwasm-surface=term']);
  if (!existsSync(termWasm)) throw new Error(`fx-term.wasm is missing after the build: ${termWasm}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(wasm, join(out, 'fx-core.wasm'));
  copyFileSync(termWasm, join(out, 'fx-term.wasm'));
  for (const name of modules) copyFileSync(join(fxRepo, 'sdk', name), join(out, name));
  const manifest = {
    generator: 'scripts/vendor-fx.mjs',
    source: process.env.FX_COMMIT ? `fx ${process.env.FX_COMMIT}` : 'local fx checkout',
    sdkApiVersion: 2,
    wasm: { name: 'fx-core.wasm', sha256: sha256(join(out, 'fx-core.wasm')) },
    term: { name: 'fx-term.wasm', surface: 'term', sha256: sha256(join(out, 'fx-term.wasm')) },
    modules: modules.map((name) => ({ name, sha256: sha256(join(out, name)) })),
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

export function verifyVendorFx() {
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const files = [manifest.wasm, manifest.term, ...manifest.modules];
  const bad = files.filter((file) => sha256(join(out, file.name)) !== file.sha256);
  if (bad.length) throw new Error(`fx vendor does not match its manifest: ${bad.map((file) => file.name).join(', ')}`);
  return { out, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes('--verify') ? verifyVendorFx() : await vendorFx();
  console.log(`fx vendor ${process.argv.includes('--verify') ? 'verified' : 'written'} at ${result.out}: ${result.manifest.wasm.sha256.slice(0, 12)}`);
}
