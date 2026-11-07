import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QUICKJS_VERSION = 'v0.18.0';
export const QUICKJS_SOURCE_SHA256 = '28bcd89aa3683fd2a946537e5ce3f11cc46b5cbf3383c7561aaef3df5ff9f1dd';
export const ZIG_VERSION = '0.17.1';
export const QUICKJS_WASM_SHA256 = 'b279cdae2373a333366c1596083a48bb8955b919e6ee6e56394eba1cf1a5a62d';

const SOURCES = ['dtoa.c', 'libregexp.c', 'libunicode.c', 'quickjs.c', 'quickjs-libc.c', 'qjs-wasi-reactor.c'];
const EXPORTS = ['malloc', 'free', 'realloc', 'calloc'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = join(root, 'scripts', 'quickjs', 'thebird-eval.c');
const target = join(root, 'web', 'vendor', 'quickjs');
const work = join(tmpdir(), 'thebird-quickjs');
const src = join(work, 'src');
const cache = join(work, 'zig-cache');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const zigLibDir = (zig) => {
  const exe = realpathSync(execFileSync('which', [zig], { encoding: 'utf8' }).trim());
  return resolve(dirname(exe), 'lib');
};

const flags = (zigLib) => [
  '-target', 'wasm32-wasi',
  '-mexec-model=reactor',
  '-O2',
  '-D_GNU_SOURCE',
  '-DBUILDING_QJS_SHARED',
  `-ffile-prefix-map=${root}=thebird`,
  `-ffile-prefix-map=${zigLib}=zig-lib`,
  '-D_WASI_EMULATED_SIGNAL',
  '-D_WASI_EMULATED_PROCESS_CLOCKS',
  '-D_WASI_EMULATED_GETPID',
  '-Wl,--export-dynamic',
  ...EXPORTS.map((name) => `-Wl,--export=${name}`),
  '-Wl,--export-table',
  '-Wl,--growable-table',
  '-lwasi-emulated-signal',
  '-lwasi-emulated-process-clocks',
  '-lwasi-emulated-getpid',
  '-lm',
];

export async function vendorQuickJs({ zig = process.env.ZIG || 'zig' } = {}) {
  const zigVersion = execFileSync(zig, ['version'], { encoding: 'utf8' }).trim();
  if (zigVersion !== ZIG_VERSION) throw new Error(`zig ${zigVersion} is not the pinned ${ZIG_VERSION}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  try {
    const archive = join(work, 'quickjs.tar.gz');
    const response = await fetch(`https://github.com/quickjs-ng/quickjs/archive/refs/tags/${QUICKJS_VERSION}.tar.gz`);
    if (!response.ok) throw new Error(`fetch quickjs-ng ${QUICKJS_VERSION}: HTTP ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const sourceDigest = sha256(archive);
    if (sourceDigest !== QUICKJS_SOURCE_SHA256) throw new Error(`quickjs-ng source sha256 ${sourceDigest} does not match the pinned ${QUICKJS_SOURCE_SHA256}`);
    execFileSync('tar', ['-xzf', archive, '-C', src, '--strip-components=1']);
    const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: cache, ZIG_LOCAL_CACHE_DIR: join(cache, 'local') };
    execFileSync(zig, ['cc', ...flags(zigLibDir(zig)), '-I.', ...SOURCES, wrapper, '-o', 'qjs.wasm'], { cwd: src, env, stdio: ['ignore', 'ignore', 'pipe'] });
    const built = join(src, 'qjs.wasm');
    const wasmDigest = sha256(built);
    if (QUICKJS_WASM_SHA256 && wasmDigest !== QUICKJS_WASM_SHA256) throw new Error(`quickjs wasm sha256 ${wasmDigest} does not match the pinned ${QUICKJS_WASM_SHA256}`);
    mkdirSync(target, { recursive: true });
    copyFileSync(built, join(target, 'qjs.wasm'));
    writeFileSync(join(target, '.gitignore'), '*\n!.gitignore\n');
    return { version: QUICKJS_VERSION, zig: zigVersion, sourceSha256: sourceDigest, wasmSha256: wasmDigest, dir: target };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const done = await vendorQuickJs();
  console.log(`vendored quickjs-ng ${done.version} (zig ${done.zig}) into ${done.dir}: source sha256 ${done.sourceSha256}, wasm sha256 ${done.wasmSha256}`);
}
