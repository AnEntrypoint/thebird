import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TXIKI_VERSION = 'v26.11.0';
export const TXIKI_SHA256 = '763025ac98e4d6629f9ebe8396c027ff22966a6322b0dc43e442d45c6d7f8059';
export const LIBUV_COMMIT = 'dd9f081cc55a4d83e2a976848d074f28ee5f34eb';
export const LIBUV_SHA256 = 'f5185440ee939936d6375755498b7f07915f747bd9bbfe6ea058a9ee173f88d0';
export const QUICKJS_NG_COMMIT = '7b5f588e0f9b643e2996f291bfc861abeaceddc2';
export const QUICKJS_NG_SHA256 = 'f27b2e93647e73f91201e12c4f2ee0c0d07e2f6dc06b539422bf03269d601366';
export const ZIG_VERSION = '0.17.1';

export const CORE_SOURCES = [
  'src/vm.c', 'src/timers.c', 'src/utils.c', 'src/modules.c', 'src/error.c', 'src/mem.c',
  'src/text-coding.c', 'src/tbuf.c', 'src/builtins.c', 'src/signals.c', 'src/mod_os.c',
  'src/mod_sys.c', 'src/mod_fs.c', 'src/mod_streams.c', 'src/worker.c', 'src/eval.c',
  'src/cli.c', 'src/url.c', 'src/mod_engine.c', 'src/version.c',
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overlay = join(root, 'scripts', 'txiki', 'include');
const work = join(tmpdir(), 'thebird-txiki');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function fetchArchive(url, expected, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: HTTP ${response.status}`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  const digest = sha256(dest);
  if (digest !== expected) throw new Error(`${url} sha256 ${digest} does not match the pin ${expected}`);
}

function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', into, '--strip-components=1']);
}

function zigLibDir(zig) {
  const exe = execFileSync('readlink', ['-f', execFileSync('which', [zig], { encoding: 'utf8' }).trim()], { encoding: 'utf8' }).trim();
  return resolve(dirname(exe), 'lib');
}

export async function stageTxiki({ zig = process.env.ZIG || 'zig' } = {}) {
  const zigVersion = execFileSync(zig, ['version'], { encoding: 'utf8' }).trim();
  if (zigVersion !== ZIG_VERSION) throw new Error(`zig ${zigVersion} is not the pinned ${ZIG_VERSION}`);
  rmSync(work, { recursive: true, force: true });
  const tree = join(work, 'txiki');
  mkdirSync(work, { recursive: true });
  await fetchArchive(`https://api.github.com/repos/saghul/txiki.js/tarball/${TXIKI_VERSION}`, TXIKI_SHA256, join(work, 'txiki.tar.gz'));
  extract(join(work, 'txiki.tar.gz'), tree);
  await fetchArchive(`https://api.github.com/repos/libuv/libuv/tarball/${LIBUV_COMMIT}`, LIBUV_SHA256, join(work, 'libuv.tar.gz'));
  extract(join(work, 'libuv.tar.gz'), join(tree, 'deps', 'libuv'));
  await fetchArchive(`https://api.github.com/repos/quickjs-ng/quickjs/tarball/${QUICKJS_NG_COMMIT}`, QUICKJS_NG_SHA256, join(work, 'quickjs.tar.gz'));
  extract(join(work, 'quickjs.tar.gz'), join(tree, 'deps', 'quickjs'));
  const libuvInclude = join(tree, 'deps', 'libuv', 'include');
  const build = join(work, 'include');
  mkdirSync(join(build, 'uv'), { recursive: true });
  cpSync(join(libuvInclude, 'uv.h'), join(build, 'uv.h'));
  cpSync(join(libuvInclude, 'uv', 'errno.h'), join(build, 'uv', 'errno.h'));
  cpSync(join(libuvInclude, 'uv', 'version.h'), join(build, 'uv', 'version.h'));
  cpSync(join(overlay, 'uv', 'browser.h'), join(build, 'uv', 'browser.h'));
  cpSync(join(overlay, "libwebsockets.h"), join(build, "libwebsockets.h"));
  mkdirSync(join(build, "mbedtls"), { recursive: true });
  for (const header of ['x509_crt.h', 'entropy.h']) cpSync(join(overlay, 'mbedtls', header), join(build, 'mbedtls', header));
  cpSync(join(overlay, 'txiki-browser.h'), join(build, 'txiki-browser.h'));
  const uvPath = join(build, 'uv.h');
  writeFileSync(uvPath, readFileSync(uvPath, 'utf8').replace('#if defined(UV_FREERTOS)\n# include "uv/freertos.h"', '#if 1\n# include "uv/browser.h"'));
  writeFileSync(join(tree, 'src', 'version.h'), readFileSync(join(tree, 'src', 'version.h.in'), 'utf8')
    .replace('@TJS__VERSION_MAJOR@', '26').replace('@TJS__VERSION_MINOR@', '11').replace('@TJS__VERSION_PATCH@', '0').replace('@TJS__VERSION_SUFFIX@', ''));
  return { tree, build, zig, zigVersion };
}

export function compileCheck({ tree, build, zig }) {
  const quickjs = join(tree, 'deps', 'quickjs');
  const base = ['-target', 'wasm32-wasi', '-O2', '-D_GNU_SOURCE', '-D_WASI_EMULATED_SIGNAL', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-D_WASI_EMULATED_GETPID', '-DTJS__PLATFORM="wasi"', '-include', join(build, 'txiki-browser.h'), '-w', `-I${build}`, `-I${join(tree, 'src')}`, `-I${quickjs}`, `-I${join(tree, 'deps', 'libuv', 'include')}`, `-I${join(tree, 'deps', 'ada')}`];
  const units = [{ file: 'deps/ada/ada.cpp', command: 'c++', flags: ['-std=c++20', '-fno-exceptions', '-fno-rtti'] }, ...CORE_SOURCES.map((file) => ({ file, command: 'cc', flags: [] }))];
  const results = units.filter((unit) => existsSync(join(tree, unit.file))).map(({ file, command, flags }) => {
    try {
      execFileSync(zig, [command, ...base, ...flags, '-c', file, '-o', join(work, `${file.replace(/\W/g, '_')}.o`)], { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      return { file, ok: true };
    } catch (err) {
      const firstError = String(err.stderr || '').split('\n').find((line) => line.includes('error:')) ?? 'failed';
      return { file, ok: false, firstError };
    }
  });
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const staged = await stageTxiki();
  const results = compileCheck(staged);
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.file}${result.ok ? '' : ` :: ${result.firstError}`}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(`txiki core compile gate: ${results.length - failed} of ${results.length} files compile for wasm32-wasi`);
  if (failed) process.exitCode = 1;
}
