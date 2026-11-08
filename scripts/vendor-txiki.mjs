import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
export const BROWSER_SOURCES = ['scripts/txiki/browser/uv-browser.c'];

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

function flagsFor({ tree, build }) {
  return ['-target', 'wasm32-wasi', '-O2', '-D_GNU_SOURCE', '-D_WASI_EMULATED_SIGNAL', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-D_WASI_EMULATED_GETPID', '-DTJS__PLATFORM="wasi"', '-include', join(build, 'txiki-browser.h'), '-w', `-I${build}`, `-I${join(tree, 'src')}`, `-I${join(tree, 'deps', 'quickjs')}`, `-I${join(tree, 'deps', 'libuv', 'include')}`, `-I${join(tree, 'deps', 'ada')}`];
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
  const flags = flagsFor({ tree, build });
  const objects = [];
  const results = [];
  compile(zig, flags, tree, 'deps/ada/ada.cpp', 'c++', ['-std=c++20', '-fno-exceptions', '-fno-rtti'], objects, results);
  for (const file of CORE_SOURCES) compile(zig, flags, tree, file, 'cc', [], objects, results);
  for (const file of CORE_BUNDLES) compile(zig, flags, tree, file, 'cc', [], objects, results);
  for (const file of QUICKJS_SOURCES) compile(zig, flags, tree, join('deps', 'quickjs', file), 'cc', [], objects, results);
  for (const file of BROWSER_SOURCES) compile(zig, flags, tree, join(root, file), 'cc', [], objects, results);
  return { objects, results };
}

export function linkCheck({ tree }, objects, zig = process.env.ZIG || 'zig') {
  const output = join(work, 'tjs.wasm');
  const args = ['cc', '-target', 'wasm32-wasi', '-mexec-model=reactor', '-Wl,--no-entry', '-Wl,--export-dynamic', '-Wl,--no-gc-sections', '-lc++', '-lc++abi', '-lwasi-emulated-signal', '-lwasi-emulated-process-clocks', '-lwasi-emulated-getpid', '-lm', '-o', output, ...objects];
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
    if (!link.linked) process.exitCode = 1;
  }
}
