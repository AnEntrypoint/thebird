// Classic (non-module) script mirroring vendor/esm/node/process.mjs's default
// export. This installs window.process synchronously, BEFORE the document's
// <script type="module"> block even begins evaluating its import graph --
// classic scripts execute in document order and complete before the browser
// moves on, while a module script (and everything it statically imports, e.g.
// os-shell.js -> freddie-loader.js -> the vendored freddie bundle) only starts
// running after all prior classic scripts have finished. Importing
// process.mjs itself from inside the module script is too late for bundles
// that touch process.env at their own top-level module-eval time.
//
// Keep this shape in sync with vendor/esm/node/process.mjs by hand -- it is
// intentionally a plain script (not type="module") so it can't statically
// import that file; ES modules cannot be synchronously pulled into a classic
// script. See process.mjs for the `browser: true` / `versions.node` rationale
// (pyodide.mjs runtime-sniffing, shell-runtime.js detectRuntime()).
(function () {
  if (typeof globalThis.process !== 'undefined') return;
  var env = (typeof globalThis !== 'undefined' && globalThis.__node_env) || {};
  globalThis.process = {
    env: env,
    browser: true,
    platform: 'browser',
    arch: 'wasm',
    version: 'v20.0.0',
    versions: { node: '20.0.0' },
    pid: 0,
    argv: ['/usr/bin/node'],
    cwd: function () { return (globalThis.__debug && globalThis.__debug.shell && globalThis.__debug.shell.cwd) || '/home'; },
    nextTick: function (cb) { var a = Array.prototype.slice.call(arguments, 1); queueMicrotask(function () { cb.apply(null, a); }); },
    hrtime: (function () {
      var fn = function () {
        var ms = performance.now();
        var s = Math.floor(ms / 1000);
        var ns = Math.floor((ms - s * 1000) * 1e6);
        return [s, ns];
      };
      fn.bigint = function () { return BigInt(Math.floor(performance.now() * 1e6)); };
      return fn;
    })(),
    on: function () {}, off: function () {}, emit: function () { return false; },
    stdout: { write: function (s) { try { globalThis.__debug && globalThis.__debug.shell && globalThis.__debug.shell.term && globalThis.__debug.shell.term.write && globalThis.__debug.shell.term.write(String(s)); } catch (e) {} return true; } },
    stderr: { write: function (s) { try { globalThis.__debug && globalThis.__debug.shell && globalThis.__debug.shell.term && globalThis.__debug.shell.term.write && globalThis.__debug.shell.term.write(String(s)); } catch (e) {} return true; } },
  };
})();
