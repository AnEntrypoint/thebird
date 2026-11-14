import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { vendorBashkit } from './vendor-bashkit.mjs';
import { vendorFx } from './vendor-fx.mjs';
import { vendorFloosie } from './vendor-floosie.mjs';
import { packSiteBrotli, verifySiteBrotli } from './pack-site-brotli.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildPages(out = join(root, '_site')) {
  if (!existsSync(join(root, 'web', 'vendor', 'bashkit', 'bashkit_wasm_bg.wasm'))) await vendorBashkit();
  if (!existsSync(join(root, 'web', 'vendor', 'fx', 'fx-core.wasm'))) await vendorFx();
  if (!existsSync(join(root, 'web', 'vendor', 'floosie', 'browser.js'))) await vendorFloosie();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'web'), join(out, 'web'), { recursive: true, filter: (source) => !source.startsWith(join(root, 'web', 'vendor', 'floosie')) });
  cpSync(join(root, 'sdk'), join(out, 'sdk'), { recursive: true });
  copyFileSync(join(root, 'web', 'terminal.html'), join(out, 'index.html'));
  await build({
    entryPoints: [join(out, 'web', 'terminal.js')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: join(out, 'web', 'terminal.bundle.js'),
  });
  writeFileSync(join(out, 'index.html'), readFileSync(join(out, 'index.html'), 'utf8').replace('src="web/terminal.js"', 'src="web/terminal.bundle.js"'));
  writeFileSync(join(out, '.nojekyll'), '');
  writeFileSync(join(out, 'sw.js'), "import './web/package-sw.js';\n");
  writeFileSync(join(out, 'web', 'features.json'), readFileSync(join(root, 'web', 'features.json')));
  await packSiteBrotli(out, join(out, 'thebird-package.tar.br'));
  verifySiteBrotli(out, join(out, 'thebird-package.json'));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`site written to ${await buildPages()}`);
}
