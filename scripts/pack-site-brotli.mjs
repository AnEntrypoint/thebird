import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function walk(dir, base, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (basename(abs).startsWith('.')) continue;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, base, out);
    else out.push({ rel: relative(base, abs).split(sep).join('/'), abs, size: st.size });
  }
  return out;
}

function tarHeader(name, size) {
  const h = Buffer.alloc(512, 0);
  const prefix = name.length > 100 ? name.slice(0, name.lastIndexOf('/', 100)) : '';
  const base = prefix ? name.slice(prefix.length + 1) : name;
  if (base.length > 100 || prefix.length > 155) throw new Error(`tar path too long: ${name}`);
  h.write(base, 0, 100);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '\0'), 124);
  h.write('        ', 136);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  if (prefix) h.write(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

export async function packSiteBrotli(site = join(root, '_site'), out = join(root, '_site', 'thebird-package.tar.br')) {
  const siteAbs = resolve(site);
  const outAbs = resolve(out);
  if (!existsSync(siteAbs)) throw new Error(`site directory missing: ${siteAbs}`);
  const entries = walk(siteAbs, siteAbs).filter((e) => e.rel !== 'thebird-package.tar.br' && e.rel !== 'thebird-package.json');
  const chunks = [];
  for (const e of entries) {
    const bytes = readFileSync(e.abs);
    chunks.push(tarHeader(e.rel, bytes.length), bytes);
    const pad = (512 - (bytes.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(chunks);
  const br = brotliCompressSync(tar, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: tar.length } });
  writeFileSync(outAbs, br);
  const manifest = {
    schema: 'thebird.brotli-site-package/v1',
    ok: true,
    site: relative(root, siteAbs).split(sep).join('/'),
    package: relative(root, outAbs).split(sep).join('/'),
    fileCount: entries.length,
    uncompressedBytes: tar.length,
    compressedBytes: br.length,
    tarSha256: digest(tar),
    packageSha256: digest(br),
    compression: 'brotli-quality-11',
    generatedAt: 'deterministic',
    files: entries.map((e) => ({ path: e.rel, bytes: e.size })),
  };
  writeFileSync(join(siteAbs, 'thebird-package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function verifySiteBrotli(site = join(root, '_site'), manifestPath = join(root, '_site', 'thebird-package.json')) {
  const siteAbs = resolve(site);
  const info = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pkg = join(siteAbs, basename(info.package));
  const bytes = readFileSync(pkg);
  if (digest(bytes) !== info.packageSha256) throw new Error('brotli package sha256 mismatch');
  const tar = brotliDecompressSync(bytes);
  if (digest(tar) !== info.tarSha256) throw new Error('brotli package tar sha256 mismatch');
  if (tar.length !== info.uncompressedBytes) throw new Error('brotli package uncompressed size mismatch');
  if (info.fileCount !== walk(siteAbs, siteAbs).filter((e) => !['thebird-package.tar.br', 'thebird-package.json'].includes(e.rel)).length) throw new Error('brotli package file count mismatch');
  console.log(`brotli package ok: files=${info.fileCount} tar=${info.uncompressedBytes} br=${info.compressedBytes} sha256=${info.packageSha256}`);
  return info;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--verify')) verifySiteBrotli();
  else {
    const info = await packSiteBrotli();
    verifySiteBrotli();
    console.log(`brotli package written: ${info.package}`);
  }
}
