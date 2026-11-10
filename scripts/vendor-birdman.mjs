import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.BIRDMAN_REPO ? join(process.env.BIRDMAN_REPO, 'client', 'birdman.js') : join(root, '..', 'birdman', 'client', 'birdman.js');
const out = join(root, 'web', 'vendor', 'birdman');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function vendorBirdman() {
  if (!existsSync(source)) throw new Error(`Birdman client is missing at ${source}: set BIRDMAN_REPO to a Birdman checkout`);
  mkdirSync(out, { recursive: true });
  const upstream = readFileSync(source, 'utf8');
  const workerClient = upstream
    .replace("const CHANNEL = 'birdman';", "const pageWindow = globalThis.window ?? { location: globalThis.location, addEventListener: globalThis.addEventListener.bind(globalThis), removeEventListener: globalThis.removeEventListener.bind(globalThis), postMessage: (message) => globalThis.postMessage(message) };\nconst CHANNEL = 'birdman';")
    .replace(/#targetOrigin = window\.location\.origin === 'null' \? '\*' : window\.location\.origin;/, "#targetOrigin = pageWindow.location.origin === 'null' ? '*' : pageWindow.location.origin;")
    .replace(/window\.addEventListener\(/g, 'pageWindow.addEventListener(')
    .replace(/window\.postMessage\(/g, 'pageWindow.postMessage(')
    .replace(/if \(event\.source !== window\) return;/, 'if (event.source !== pageWindow && event.source !== globalThis) return;')
    .replace(/window\.removeEventListener\(/g, 'pageWindow.removeEventListener(');
  if (workerClient.includes('window.')) throw new Error('the Birdman client still references window directly');
  writeFileSync(join(out, 'client.js'), workerClient);
  const manifest = {
    generator: 'scripts/vendor-birdman.mjs',
    source: 'AnEntrypoint/birdman client/birdman.js',
    client: { name: 'client.js', sha256: sha256(join(out, 'client.js')) },
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = vendorBirdman();
  console.log(`birdman vendor written to ${result.out}: ${result.manifest.client.sha256.slice(0, 12)}`);
}
