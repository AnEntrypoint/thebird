const PYODIDE_VERSION = '0.27.2';
const VENDOR_BASE = new URL('./vendor/pyodide/', import.meta.url).href;
const PYODIDE_URL = VENDOR_BASE + 'pyodide.mjs';
// indexURL must point at the SAME vendored directory as pyodide.mjs, not the
// jsdelivr CDN: loadPyodide() uses indexURL to fetch pyodide.asm.js itself
// (via locateFile), and the CDN's copy of that emscripten glue has its own
// ENVIRONMENT_IS_NODE sniff (`typeof process==='object' &&
// typeof process.versions.node==='string'`, with no `!process.browser`
// escape hatch) that misfires true against thebird's global `process`
// polyfill (docs/vendor/esm/node/process.mjs, installed for the vendored
// freddie bundle) and then calls a bare `require("fs")` -- undefined in a
// browser -- crashing pyodide load with "require is not defined" before any
// Python ever ran. docs/vendor/pyodide/ already carries a complete local copy
// (pyodide.asm.js/.wasm, pyodide-lock.json, python_stdlib.zip -- see
// manifest.json) from the original vendor pull, so there is no need to reach
// the CDN for the core runtime at all; only lazily-`pip install`ed packages
// not in the local pyodide-lock.json fall through to micropip's own CDN
// fetch, which is unrelated to this indexURL.
const PYODIDE_INDEX_URL = VENDOR_BASE;

let pyPromise = null;
let pyInstance = null;

// Single shared pyInstance is a module-level singleton with no lock, so two
// overlapping python invocations would stomp each other's sys.argv, stdout
// target, and the bridgeFs() open()/_snap monkeypatch. execQueue serializes
// every execution (loadPyodide/runPython/micropipInstall/bridgeFs/runCode)
// through one promise chain -- callers await their turn instead of racing.
// currentStdout is a mutable ref the stdout/stderr callbacks (bound once at
// loadPyodide time, since pyodide has no per-call stdout override) read on
// every line, so each queued call's own onStdout/term actually receives its
// own output instead of all output after the first call going to whichever
// onStdout closure loadPyodide() happened to capture first.
let execQueue = Promise.resolve();
let currentStdout = null;

function enqueue(fn) {
  const run = execQueue.then(fn, fn);
  // Swallow rejection in the chain itself so one failed call doesn't wedge
  // every subsequent queued call; the real error still propagates to this
  // call's own caller via `run`.
  execQueue = run.then(() => {}, () => {});
  return run;
}

export function isLoaded() { return !!pyInstance; }

export async function loadPyodide(onStdout) {
  if (pyInstance) return pyInstance;
  if (pyPromise) return pyPromise;
  pyPromise = (async () => {
    onStdout?.(`loading pyodide v${PYODIDE_VERSION} (entry: vendor, wheels: lazy)...\n`);
    currentStdout = onStdout;
    const mod = await import(PYODIDE_URL);
    const inst = await mod.loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
      stdout: line => currentStdout?.(line + '\n'),
      stderr: line => currentStdout?.(line + '\n'),
    });
    await setupRuntime(inst, onStdout);
    pyInstance = inst;
    if (typeof window !== 'undefined') {
      if (!window.__debug) window.__debug = {};
      window.__debug.py = { loaded: true, pyodide: inst, runPython: (code) => inst.runPythonAsync(code) };
    }
    onStdout?.('pyodide ready.\n');
    return inst;
  })();
  pyPromise.catch(() => { pyPromise = null; pyInstance = null; });
  return pyPromise;
}

async function setupRuntime(inst, onStdout) {
  const SHIM_NAMES = ['subprocess', 'psutil', 'fcntl', 'termios', 'pwd', 'grp', 'select', 'msvcrt', 'curses', 'winpty', 'ptyprocess', 'sounddevice', 'soundfile', 'wave'];
  const shimBase = new URL('./vendor/python-shims/', import.meta.url).href;
  inst.FS.mkdir('/vendor-shims');
  inst.FS.mkdir('/vendor-apps');
  const failedShims = new Set();
  for (const name of SHIM_NAMES) {
    try {
      const r = await fetch(shimBase + name + '.py');
      if (!r.ok) { onStdout?.(`shim:${name} fetch ${r.status}\n`); failedShims.add(name); continue; }
      const src = await r.text();
      inst.FS.writeFile('/vendor-shims/' + name + '.py', src);
    } catch (e) { onStdout?.(`shim:${name} ${e.message}\n`); failedShims.add(name); }
  }
  // Expose failed shims to Python so import errors can show helpful diagnostics
  const failedShimList = Array.from(failedShims);
  inst.globals.set('__thebird_failed_shims', inst.toPy ? inst.toPy(failedShimList) : failedShimList);
  const bootUrl = new URL('./python-runtime.py', import.meta.url).href;
  const bootSrc = await (await fetch(bootUrl)).text();
  await inst.runPythonAsync(bootSrc);
  // Inject diagnostic ImportError stubs for any shim that failed to load,
  // making the failed state unrepresentable as success in the import system.
  if (failedShimList.length) {
    const names = JSON.stringify(failedShimList);
    await inst.runPythonAsync(`
import sys
from types import ModuleType
_failed = ${names}
for _n in _failed:
    class _FailedShim(ModuleType):
        def __getattr__(self, item):
            raise ImportError(f"thebird shim '{_n}' failed to load (network error). This module is not available in the browser sandbox.")
        def __call__(self, *a, **kw):
            raise ImportError(f"thebird shim '{_n}' failed to load (network error). This module is not available in the browser sandbox.")
    _m = _FailedShim(_n)
    _m.__file__ = f'<thebird-failed-shim:{_n}>'
    sys.modules[_n] = _m
del _failed, _n, _m, _FailedShim
`);
  }
}

export function runPython(code, argv, onStdout) {
  return enqueue(async () => {
    const inst = await loadPyodide(onStdout);
    currentStdout = onStdout;
    if (argv) {
      inst.globals.set('__py_argv', argv);
      await inst.runPythonAsync('import sys; sys.argv = list(__py_argv)');
    }
    return inst.runPythonAsync(code);
  });
}

// Returns the count of packages that failed to install so callers (pipBuiltin
// below) can surface a real non-zero exit status -- `pip install`
// silently returning success on every package failure was the actual bug:
// _install()'s per-package try/except printed "FAIL" but the outer
// runPythonAsync promise always resolved, so no failure signal crossed the
// JS/Python boundary at all.
export function micropipInstall(pkgs, onStdout) {
  return enqueue(() => micropipInstallImpl(pkgs, onStdout));
}

async function micropipInstallImpl(pkgs, onStdout) {
  const inst = await loadPyodide(onStdout);
  currentStdout = onStdout;
  await inst.loadPackage('micropip');
  inst.globals.set('__pip_pkgs', pkgs);
  const failCount = await inst.runPythonAsync(`
import micropip, asyncio
async def _install():
    failed = 0
    for p in list(__pip_pkgs):
        try:
            await micropip.install(p)
            print('  ok', p)
        except Exception as e:
            print(f"ERROR: Could not find a version that satisfies the requirement {p} (from versions: none)")
            print(f"ERROR: No matching distribution found for {p}")
            print(f"  (underlying error: {e})")
            failed += 1
    return failed
await _install()
`);
  return { failCount: Number(failCount) || 0 };
}

const ASGI_CLASSES = new Set(['FastAPI', 'Starlette', 'Quart', 'Sanic', 'AsgiApp', 'Application']);
const mountedPyApps = new Map();

// Explicit per-instance registry lookup -- matches the pattern established by
// docs/sw-client.js (findAsgiApp(path, inst)) and docs/apps.js's
// resolveInstance(): resolve window.__debug.shell.active ourselves and pass
// it explicitly to the caller-supplied mountAsgi, rather than letting
// asgi-bridge.js's pickRegistry() fall back through getActiveRegistry() to
// the shared un-instanced __thebirdLegacyAsgiMap on an early-boot race. The
// callers (docs/shell-python.js) only pass the bare mountAsgi function with
// no instance, so this file is the layer that must supply one.
function activeAsgiInstance() {
  return (typeof window !== 'undefined' && window.__debug && window.__debug.shell && window.__debug.shell.active) || null;
}

export async function scanAndMount(inst, mountAsgi) {
  if (!inst || !inst.globals || typeof mountAsgi !== 'function') return [];
  const detected = [];
  const names = Array.from(inst.globals.keys ? inst.globals.keys() : []);
  for (const name of names) {
    if (name.startsWith('_') || name.startsWith('__py')) continue;
    let val;
    try { val = inst.globals.get(name); } catch { continue; }
    if (!val) continue;
    let cls = '';
    try { cls = val.type ? String(val.type) : (val.constructor?.name || ''); } catch { /* swallow: type introspection unsupported on this pyodide value, keep cls empty */ }
    try { if (val.__class__ && val.__class__.__name__) cls = String(val.__class__.__name__); } catch { /* swallow: not a python object with __class__, cls already resolved (or left empty) above */ }
    const looksAsgi = ASGI_CLASSES.has(cls);
    if (!looksAsgi) { try { if (val && typeof val.toJs === 'function') val.destroy?.(); } catch { /* swallow: best-effort proxy cleanup for a non-ASGI global, failure is non-fatal */ } continue; }
    if (mountedPyApps.get(name) === val) continue;
    const callable = async (scope, receive, send) => {
      const sJs = inst.toPy ? inst.toPy(scope) : scope;
      const rJs = inst.toPy ? inst.toPy(receive) : receive;
      const ndJs = inst.toPy ? inst.toPy(send) : send;
      const result = val(sJs, rJs, ndJs);
      if (result && typeof result.then === 'function') await result;
    };
    const prefix = mountAsgi(callable, '/' + name, activeAsgiInstance());
    mountedPyApps.set(name, val);
    detected.push({ name, prefix, cls });
  }
  if (typeof window !== 'undefined' && detected.length) {
    window.dispatchEvent(new CustomEvent('asgi-mount', { detail: { mounts: detected } }));
  }
  return detected;
}

export function getMountedPyApps() { return new Map(mountedPyApps); }

export function makePythonBuiltin(ctx) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  const snap = () => window.__debug?.idbSnapshot || {};
  const persist = () => window.__debug?.idbPersist?.();
  const toKey = p => p.replace(/^\//, '');

  function cwdKey(rel) {
    if (rel.startsWith('/')) return toKey(rel);
    return toKey(ctx.cwd.replace(/\/$/, '') + '/' + rel);
  }

  const stdoutSink = line => w(line.replace(/\n/g, '\r\n'));

  // Entire runCode body -- loadPyodide, bridgeFs's open()/_snap monkeypatch,
  // the actual script execution, and the ASGI scan -- runs as ONE atomic
  // step on the shared execQueue so a second concurrent `python ...`
  // invocation (e.g. from an ASGI-mounted app handling a request while a
  // first script is still running) cannot rebind bridgeFs's monkeypatch or
  // sys.argv mid-execution, and each call's own stdoutSink (bound to this
  // call's ctx.term) is what pyodide's stdout/stderr callbacks read for the
  // whole duration, not whichever call loaded pyodide first.
  function runCode(code, argv) {
    return enqueue(() => runCodeImpl(code, argv));
  }

  async function runCodeImpl(code, argv) {
    const inst = await loadPyodide(stdoutSink);
    currentStdout = stdoutSink;
    await bridgeFs(inst, snap(), persist);
    if (argv) {
      inst.globals.set('__py_argv', argv);
      await inst.runPythonAsync('import sys; sys.argv = list(__py_argv)');
    }
    try {
      await inst.runPythonAsync(code);
      ctx.lastExitCode = 0;
    } catch (e) {
      // pyodide's PythonError sets .type to the raised Python exception's
      // class name (e.g. "SystemExit") -- checking that structured field
      // (rather than regexing e.message) avoids misclassifying any other
      // exception whose stringified message happens to end in matching text.
      if (e && e.type === 'SystemExit') {
        const m = /SystemExit:?\s*(-?\d+)?\s*$/m.exec(e.message || '');
        ctx.lastExitCode = m && m[1] !== undefined ? (Number(m[1]) & 0xff) : 0;
      } else throw e;
    }
    try {
      const { mountAsgi } = await import('./asgi-bridge.js');
      const mounts = await scanAndMount(inst, mountAsgi);
      for (const m of mounts) wl('\x1b[32m[asgi]\x1b[0m mounted ' + m.cls + ' at /preview' + m.prefix + '/');
    } catch(e) { wl('\x1b[33m[asgi] mount failed: ' + e.message); }
  }

  async function pythonBuiltin(args, _actor, stdin, cmdName) {
    const name = cmdName || 'python';
    const cFlag = args[0] === '-c' ? 0 : -1;
    if (cFlag >= 0) {
      if (args[cFlag + 1] === undefined) {
        wl('Argument expected for the -c option');
        wl('usage: ' + name + ' [option] ... [-c cmd | -m mod | file | -] [arg] ...');
        wl('Try `' + name + " -h' for more information.");
        ctx.lastExitCode = 2; return;
      }
      await runCode(args[cFlag + 1], ['-c', ...args.slice(cFlag + 2)]); return;
    }
    if (!args.length) {
      if (stdin) { await runCode(stdin, ['']); return; }
      wl('Pyodide (lazy) — loads on first use');
      wl('use: python script.py | python -c "code" | echo "code" | python');
      return;
    }
    const scriptKey = cwdKey(args[0]);
    const scriptPath = '/' + scriptKey;
    const src = snap()[scriptKey];
    if (src == null) { wl(name + ": can't open file '" + scriptPath + "': [Errno 2] No such file or directory"); ctx.lastExitCode = 2; return; }
    await runCode(src, [scriptPath, ...args.slice(1)]);
  }

  async function pipBuiltin(args) {
    const sub = args[0];
    if (sub === 'install' || sub === 'i') {
      const pkgs = args.slice(1).filter(a => !a.startsWith('-'));
      if (!pkgs.length) throw new Error('pip install: no packages specified');
      wl('\x1b[33mInstalling via pyodide micropip...\x1b[0m');
      try {
        const { failCount } = await micropipInstall(pkgs, stdoutSink);
        if (failCount > 0) { wl('\x1b[31mpip: ' + failCount + ' of ' + pkgs.length + ' package(s) failed to install\x1b[0m'); ctx.lastExitCode = 1; }
        else ctx.lastExitCode = 0;
      } catch (e) { wl('\x1b[31mpip: ' + e.message + '\x1b[0m'); ctx.lastExitCode = 1; }
      return;
    }
    if (sub === 'list') {
      if (!isLoaded()) { wl('(pyodide not loaded yet — run python first)'); return; }
      await runPython(`
import sys
mods = sorted(set(m.split('.')[0] for m in sys.modules if not m.startswith('_')))
print('\\n'.join(mods))
`, null, stdoutSink);
      return;
    }
    wl('pip: subcommands: install, list');
  }

  return {
    python: (args, actor, stdin) => pythonBuiltin(args, actor, stdin, 'python'),
    python3: (args, actor, stdin) => pythonBuiltin(args, actor, stdin, 'python3'),
    pip: pipBuiltin,
    pip3: pipBuiltin
  };
}

export function createPyEnv({ ctx, term }) {
  const builtins = makePythonBuiltin(ctx);
  async function scanAndMountLoaded() {
    if (!isLoaded()) return [];
    const inst = await loadPyodide(s => term?.write?.(s));
    const { mountAsgi } = await import('./asgi-bridge.js');
    return scanAndMount(inst, mountAsgi);
  }
  return { ...builtins, scanAndMount: scanAndMountLoaded, isLoaded };
}

export function bridgeFs(inst, snap, persist) {
  inst.globals.set('_idb_snap', snap);
  inst.globals.set('_idb_persist', persist);
  return inst.runPythonAsync(`
import sys
_snap = _idb_snap
class _Open:
    def __init__(self, key, mode):
        self._key = key; self._buf = _snap.get(key, ''); self._pos = 0; self._mode = mode
        if 'w' in mode: self._buf = ''
    def read(self, n=-1):
        if n < 0:
            d = self._buf[self._pos:]; self._pos = len(self._buf)
        else:
            d = self._buf[self._pos:self._pos+n]; self._pos += len(d)
        return d
    def write(self, s): self._buf += s
    def readlines(self): return self._buf.splitlines(True)
    def __iter__(self): return iter(self._buf.splitlines(True))
    def __enter__(self): return self
    def _flush(self):
        if 'w' in self._mode or 'a' in self._mode:
            _snap[self._key] = self._buf
            _idb_persist()
    def close(self): self._flush()
    def __exit__(self, *a): self._flush()
if not hasattr(sys, '_thebird_orig_open'):
    sys._thebird_orig_open = open
_builtin_open = sys._thebird_orig_open
def open(path, mode='r', *a, **kw):
    key = path.lstrip('/')
    if key in _snap or 'w' in mode or 'a' in mode:
        return _Open(key, mode)
    return _builtin_open(path, mode, *a, **kw)
import builtins
builtins.open = open
del _idb_snap
`);
}
