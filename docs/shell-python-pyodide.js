const PYODIDE_VERSION = '0.27.2';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyPromise = null;
let pyInstance = null;

export function isLoaded() { return !!pyInstance; }

export async function loadPyodide(onStdout) {
  if (pyInstance) return pyInstance;
  if (pyPromise) return pyPromise;
  pyPromise = (async () => {
    onStdout?.(`fetching pyodide v${PYODIDE_VERSION}...\n`);
    const mod = await import(PYODIDE_URL);
    const inst = await mod.loadPyodide({
      indexURL: PYODIDE_INDEX,
      stdout: line => onStdout?.(line + '\n'),
      stderr: line => onStdout?.(line + '\n'),
    });
    pyInstance = inst;
    if (typeof window !== 'undefined') {
      window.__debug = window.__debug || {};
      window.__debug.py = { loaded: true, pyodide: inst, runPython: (code) => inst.runPythonAsync(code) };
    }
    onStdout?.('pyodide ready.\n');
    return inst;
  })();
  return pyPromise;
}

export async function runPython(code, argv, onStdout) {
  const inst = await loadPyodide(onStdout);
  if (argv) {
    inst.globals.set('__py_argv', argv);
    await inst.runPythonAsync('import sys; sys.argv = list(__py_argv)');
  }
  return inst.runPythonAsync(code);
}

export async function micropipInstall(pkgs, onStdout) {
  const inst = await loadPyodide(onStdout);
  await inst.loadPackage('micropip');
  inst.globals.set('__pip_pkgs', pkgs);
  await inst.runPythonAsync(`
import micropip, asyncio
async def _install():
    for p in list(__pip_pkgs):
        try:
            await micropip.install(p)
            print('  ok', p)
        except Exception as e:
            print('  FAIL', p, str(e)[:200])
await _install()
`);
}

const ASGI_CLASSES = new Set(['FastAPI', 'Starlette', 'Quart', 'Sanic', 'AsgiApp', 'Application']);
const mountedPyApps = new Map();

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
    try { cls = val.type ? String(val.type) : (val.constructor?.name || ''); } catch {}
    try { if (val.__class__ && val.__class__.__name__) cls = String(val.__class__.__name__); } catch {}
    const looksAsgi = ASGI_CLASSES.has(cls);
    if (!looksAsgi) { try { if (val && typeof val.toJs === 'function') val.destroy?.(); } catch {} continue; }
    if (mountedPyApps.get(name) === val) continue;
    const callable = async (scope, receive, send) => {
      const sJs = inst.toPy ? inst.toPy(scope) : scope;
      const rJs = inst.toPy ? inst.toPy(receive) : receive;
      const ndJs = inst.toPy ? inst.toPy(send) : send;
      const result = val(sJs, rJs, ndJs);
      if (result && typeof result.then === 'function') await result;
    };
    const prefix = mountAsgi(callable, '/' + name);
    mountedPyApps.set(name, val);
    detected.push({ name, prefix, cls });
  }
  if (typeof window !== 'undefined' && detected.length) {
    window.dispatchEvent(new CustomEvent('asgi-mount', { detail: { mounts: detected } }));
  }
  return detected;
}

export function getMountedPyApps() { return new Map(mountedPyApps); }

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
    def __exit__(self, *a):
        if 'w' in self._mode or 'a' in self._mode:
            _snap[self._key] = self._buf
            _idb_persist()
_builtin_open = open
def open(path, mode='r', *a, **kw):
    key = path.lstrip('/')
    if key in _snap or 'w' in mode or 'a' in mode:
        return _Open(key, mode)
    return _builtin_open(path, mode, *a, **kw)
del _idb_snap
`);
}
