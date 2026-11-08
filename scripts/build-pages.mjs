import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorBashkit } from './vendor-bashkit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildPages(out = join(root, '_site')) {
  if (!existsSync(join(root, 'web', 'vendor', 'bashkit', 'bashkit_wasm_bg.wasm'))) await vendorBashkit();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'web'), join(out, 'web'), { recursive: true });
  copyFileSync(join(root, 'web', 'terminal.html'), join(out, 'index.html'));
  writeFileSync(join(out, '.nojekyll'), '');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`site written to ${await buildPages()}`);
}
