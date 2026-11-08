import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
export const CORE_BUNDLES = ['core', 'polyfills', 'run-main', 'run-repl', 'worker-bootstrap'].map((name) => `src/bundles/c/core/${name}.c`);
export const QUICKJS_SOURCES = ['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'];
export const BROWSER_SOURCES = ['scripts/txiki/browser/uv-browser.c', 'scripts/txiki/browser/entry.c'];
export const TXIKI_WASM_SHA256 = '';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overlay = join(root, 'scripts', 'txiki', 'include');
const work = join(tmpdir(), 'thebird-txiki');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function fetchArchive(url, expected, dest) {
  let response;
  for (let attempt = 1; ; attempt++) {
    response = await fetch(url);
    if (response.ok || attempt === 4 || response.status < 500) break;
    await new Promise((done) => setTimeout(done, attempt * 5000));
  }
  if (!response.ok) throw new Error(`fetch ${url}: HTTP ${response.status}`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  const digest = sha256(dest);
  if (digest !== expected) throw new Error(`${url} sha256 ${digest} does not match the pin ${expected}`);
}

function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', into, '--strip-components=1']);
}

export async function stageTxiki() {
  rmSync(work, { recursive: true, force: true });
  const tree = join(work, 'txiki');
  mkdirSync(work, { recursive: true });
  await fetchArchive(`https://codeload.github.com/saghul/txiki.js/legacy.tar.gz/refs/tags/${TXIKI_VERSION}`, TXIKI_SHA256, join(work, 'txiki.tar.gz'));
  extract(join(work, 'txiki.tar.gz'), tree);
  await fetchArchive(`https://codeload.github.com/libuv/libuv/legacy.tar.gz/${LIBUV_COMMIT}`, LIBUV_SHA256, join(work, 'libuv.tar.gz'));
  extract(join(work, 'libuv.tar.gz'), join(tree, 'deps', 'libuv'));
  await fetchArchive(`https://codeload.github.com/quickjs-ng/quickjs/legacy.tar.gz/${QUICKJS_NG_COMMIT}`, QUICKJS_NG_SHA256, join(work, 'quickjs.tar.gz'));
  extract(join(work, 'quickjs.tar.gz'), join(tree, 'deps', 'quickjs'));
  const libuvInclude = join(tree, 'deps', 'libuv', 'include');
  const build = join(work, 'include');
  mkdirSync(join(build, 'uv'), { recursive: true });
  mkdirSync(join(build, 'mbedtls'), { recursive: true });
  cpSync(join(libuvInclude, 'uv.h'), join(build, 'uv.h'));
  cpSync(join(libuvInclude, 'uv', 'errno.h'), join(build, 'uv', 'errno.h'));
  cpSync(join(libuvInclude, 'uv', 'version.h'), join(build, 'uv', 'version.h'));
  for (const header of ['uv/browser.h', 'libwebsockets.h', 'mbedtls/x509_crt.h', 'mbedtls/entropy.h', 'txiki-browser.h']) {
    cpSync(join(overlay, header), join(build, header));
  }
  const uvPath = join(build, 'uv.h');
  writeFileSync(uvPath, readFileSync(uvPath, 'utf8').replace('#if defined(UV_FREERTOS)\n# include "uv/freertos.h"', '#if 1\n# include "uv/browser.h"'));
  writeFileSync(join(tree, 'src', 'version.h'), readFileSync(join(tree, 'src', 'version.h.in'), 'utf8')
    .replace('@TJS__VERSION_MAJOR@', '26').replace('@TJS__VERSION_MINOR@', '11').replace('@TJS__VERSION_PATCH@', '0').replace('@TJS__VERSION_SUFFIX@', ''));
  return { tree, build };
}

export function writeStubs({ tree, build }) {
  const rows = readFileSync(join(root, 'scripts', 'txiki', 'stubs.tsv'), 'utf8').trim().split('\n').slice(1).map((line) => line.split('\t')[0]);
  const headers = [join(tree, 'src'), build].flatMap((dir) => readdirSync(dir, { recursive: true })
    .filter((name) => String(name).endsWith('.h')).map((name) => join(dir, String(name))));
  const texts = headers.map((path) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*#.*$/gm, ''));
  const stubs = rows.map((symbol) => {
    const pattern = new RegExp(`([A-Za-z_][\\w\\s*]*?)\\b${symbol}\\s*\\(([^;{}]*?)\\)\\s*;`);
    const hit = texts.map((text) => text.match(pattern)).find(Boolean);
    if (!hit) throw new Error(`no prototype found for ${symbol}`);
    const returns = hit[1].replace(/\b(UV_EXTERN|extern)\b/g, '').replace(/\s+/g, ' ').trim();
    const params = hit[2].trim() || 'void';
    return `${returns} ${symbol}(${params}) { ${bodyFor(symbol, returns)} }`;
  });
  const file = join(work, 'stubs.c');
  writeFileSync(file, ['#include <stddef.h>', '#include "private.h"', ...stubs, ''].join('\n'));
  return file;
}

function bodyFor(symbol, returns) {
  if (symbol === 'uv_available_parallelism') return 'return 1;';
  if (returns === 'void') return '';
  if (returns.includes('*')) return 'return NULL;';
  if (returns === 'JSValue') return 'return JS_UNDEFINED;';
  if (returns === 'bool') return 'return false;';
  if (returns === 'int') return symbol.startsWith('uv_') ? 'return UV_ENOSYS;' : 'return -1;';
  return 'return 0;';
}

const zigLibDir = (zig) => {
  const exe = realpathSync(execFileSync('which', [zig], { encoding: 'utf8' }).trim());
  return resolve(dirname(exe), 'lib');
};

const prefixMapsFor = (zig) => [`-ffile-prefix-map=${root}=thebird`, `-ffile-prefix-map=${work}=build`, `-ffile-prefix-map=${zigLibDir(zig)}=zig-lib`];

function flagsFor({ tree, build }, zig) {
  return ['-target', 'wasm32-wasi', '-O2', '-D_GNU_SOURCE', ...prefixMapsFor(zig), '-D_WASI_EMULATED_SIGNAL', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-D_WASI_EMULATED_GETPID', '-DTJS__PLATFORM="wasi"', '-include', join(build, 'txiki-browser.h'), '-w', `-I${build}`, `-I${join(tree, 'src')}`, `-I${join(tree, 'deps', 'quickjs')}`, `-I${join(tree, 'deps', 'libuv', 'include')}`, `-I${join(tree, 'deps', 'ada')}`];
}

function compile(zig, flags, tree, source, command, extra, objects, results) {
  const object = join(work, `${basename(source).replace(/\W/g, '_')}.o`);
  try {
    execFileSync(zig, [command, ...flags, ...extra, '-c', source, '-o', object], { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    objects.push(object);
    results.push({ file: source, ok: true });
  } catch (err) {
    const firstError = String(err.stderr || '').split('\n').find((line) => line.includes('error:')) ?? 'failed';
    results.push({ file: source, ok: false, firstError });
  }
}

export function compileAll({ tree, build }, zig = process.env.ZIG || 'zig') {
  const flags = flagsFor({ tree, build }, zig);
  const objects = [];
  const results = [];
  compile(zig, flags, tree, 'deps/ada/ada.cpp', 'c++', ['-std=c++20', '-fno-exceptions', '-fno-rtti'], objects, results);
  for (const file of CORE_SOURCES) compile(zig, flags, tree, file, 'cc', [], objects, results);
  for (const file of CORE_BUNDLES) compile(zig, flags, tree, file, 'cc', [], objects, results);
  for (const file of QUICKJS_SOURCES) compile(zig, flags, tree, join('deps', 'quickjs', file), 'cc', [], objects, results);
  for (const file of BROWSER_SOURCES) compile(zig, flags, tree, join(root, file), 'cc', [], objects, results);
  compile(zig, flags, tree, writeStubs({ tree, build }), 'cc', [], objects, results);
  return { objects, results };
}

export function linkCheck({ tree }, objects, zig = process.env.ZIG || 'zig') {
  const output = join(work, 'tjs.wasm');
  const args = ['cc', '-target', 'wasm32-wasi', ...prefixMapsFor(zig), '-mexec-model=reactor', '-Wl,--no-entry', '-Wl,--export-dynamic', '-Wl,--no-gc-sections', '-Wl,--export=malloc', '-Wl,--export=free', '-Wl,--export=realloc', '-Wl,--export=calloc', '-lc++', '-lc++abi', '-lwasi-emulated-signal', '-lwasi-emulated-process-clocks', '-lwasi-emulated-getpid', '-lm', '-o', output, ...objects];
  let stderr = '';
  try {
    execFileSync(zig, args, { cwd: tree, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  } catch (err) {
    stderr = String(err.stderr || '');
  }
  const undefinedSymbols = [...new Set([...stderr.matchAll(/undefined symbol: (\S+)/g)].map((match) => match[1]))].sort();
  return { linked: existsSync(output) && undefinedSymbols.length === 0, undefinedSymbols };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.ZIG_GLOBAL_CACHE_DIR = join(tmpdir(), 'thebird-zig-global-cache');
  const zig = process.env.ZIG || 'zig';
  const version = execFileSync(zig, ['version'], { encoding: 'utf8' }).trim();
  if (version !== ZIG_VERSION) throw new Error(`zig ${version} is not the pinned ${ZIG_VERSION}`);
  const staged = await stageTxiki();
  const { objects, results } = compileAll(staged, zig);
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.file}${result.ok ? '' : ` :: ${result.firstError}`}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(`txiki compile gate: ${results.length - failed} of ${results.length} files compile for wasm32-wasi`);
  if (failed) {
    process.exitCode = 1;
  } else {
    const link = linkCheck(staged, objects, zig);
    const uvSymbols = link.undefinedSymbols.filter((name) => name.startsWith('uv_'));
    console.log(`txiki link gate: ${link.undefinedSymbols.length} undefined symbols (${uvSymbols.length} uv_*), linked ${link.linked}`);
    for (const name of link.undefinedSymbols) console.log(`UNDEFINED ${name}`);
    if (!link.linked) {
      process.exitCode = 1;
    } else {
      const target = join(root, 'web', 'vendor', 'txiki');
      const wasmDigest = sha256(join(work, 'tjs.wasm'));
      if (TXIKI_WASM_SHA256 && wasmDigest !== TXIKI_WASM_SHA256) throw new Error(`tjs wasm sha256 ${wasmDigest} does not match the pinned ${TXIKI_WASM_SHA256}`);
      mkdirSync(target, { recursive: true });
      cpSync(join(work, 'tjs.wasm'), join(target, 'tjs.wasm'));
      writeFileSync(join(target, '.gitignore'), '*\n!.gitignore\n');
      console.log(`tjs wasm sha256 ${wasmDigest}`);
    }
  }
}
