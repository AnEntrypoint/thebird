import * as pyodideRt from './shell-python-pyodide.js';

const MICROPYTHON_URL = 'https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.25.0/micropython.mjs';

let mpPromise = null;
let mpInstance = null;

async function getMp(onStdout) {
  if (mpInstance) return mpInstance;
  if (mpPromise) return mpPromise;
  mpPromise = (async () => {
    const mod = await import(MICROPYTHON_URL);
    mpInstance = await mod.loadMicroPython({ stdout: line => onStdout(line + '\n') });
    return mpInstance;
  })();
  return mpPromise;
}

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

  const useMicro = () => ctx.env?.THEBIRD_PYTHON === 'micro';
  const stdoutSink = line => w(line.replace(/\n/g, '\r\n'));

  async function bridgeMpFs(instance) {
    instance.globals.set('_idb_snap', snap());
    instance.globals.set('_idb_persist', persist);
    await instance.runPythonAsync(`
import sys
_snap = _idb_snap
class _Open:
    def __init__(self, key, mode):
        self._key = key; self._buf = _snap.get(key, ''); self._pos = 0; self._mode = mode
        if 'w' in mode: self._buf = ''
    def read(self, n=-1):
        if n < 0: d = self._buf[self._pos:]; self._pos = len(self._buf)
        else: d = self._buf[self._pos:self._pos+n]; self._pos += len(d)
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
    if key in _snap or 'w' in mode or 'a' in mode: return _Open(key, mode)
    return _builtin_open(path, mode, *a, **kw)
del _idb_snap
`);
  }

  async function runCode(code, argv) {
    if (useMicro()) {
      const instance = await getMp(stdoutSink);
      instance.globals.set('__py_argv', argv);
      await bridgeMpFs(instance);
      await instance.runPythonAsync('import sys; sys.argv = list(__py_argv)');
      await instance.runPythonAsync(code);
      return;
    }
    const inst = await pyodideRt.loadPyodide(stdoutSink);
    await pyodideRt.bridgeFs(inst, snap(), persist);
    await pyodideRt.runPython(code, argv, stdoutSink);
    try {
      const { mountAsgi } = await import('./asgi-bridge.js');
      const mounts = await pyodideRt.scanAndMount(inst, mountAsgi);
      for (const m of mounts) wl('\x1b[32m[asgi]\x1b[0m mounted ' + m.cls + ' at /preview' + m.prefix + '/');
    } catch {}
  }

  async function pipInstallMicro(pkgs) {
    const instance = await getMp(stdoutSink);
    wl('\x1b[33mInstalling via micropython-lib (mip)...\x1b[0m');
    for (const pkg of pkgs) {
      wl('  → ' + pkg);
      const url = 'https://micropython.org/pi/v2/package/6/micropython-' + pkg + '/latest.json';
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('not found in micropython-lib');
        const meta = await res.json();
        for (const [path, fileUrl] of Object.entries(meta.hashes || {})) {
          const r = await fetch('https://micropython.org/pi/v2/' + fileUrl);
          snap()[('lib/' + path)] = await r.text();
        }
        if (meta.urls) for (const [path, fileUrl] of meta.urls) snap()[path] = await (await fetch(fileUrl)).text();
        persist();
        wl('  \x1b[32m✓ ' + pkg + '\x1b[0m');
      } catch (e) {
        wl('  \x1b[31m✗ ' + pkg + ': ' + e.message + '\x1b[0m');
      }
    }
  }

  async function pythonBuiltin(args, _actor, stdin) {
    const cFlag = args.indexOf('-c');
    if (cFlag >= 0) { await runCode(args[cFlag + 1] || '', ['python', ...args.slice(cFlag + 2)]); return; }
    if (!args.length) {
      if (stdin) { await runCode(stdin, ['python']); return; }
      wl(useMicro() ? 'MicroPython (THEBIRD_PYTHON=micro)' : 'Pyodide (lazy) — set THEBIRD_PYTHON=micro for micropython');
      wl('use: python script.py | python -c "code" | echo "code" | python');
      return;
    }
    const scriptKey = cwdKey(args[0]);
    const src = snap()[scriptKey];
    if (src == null) throw new Error('python: ' + args[0] + ': No such file');
    await runCode(src, args);
  }

  async function pipBuiltin(args) {
    const sub = args[0];
    if (sub === 'install' || sub === 'i') {
      const pkgs = args.slice(1).filter(a => !a.startsWith('-'));
      if (!pkgs.length) throw new Error('pip install: no packages specified');
      if (useMicro()) { await pipInstallMicro(pkgs); return; }
      wl('\x1b[33mInstalling via pyodide micropip...\x1b[0m');
      try { await pyodideRt.micropipInstall(pkgs, stdoutSink); }
      catch (e) { wl('\x1b[31mpip: ' + e.message + '\x1b[0m'); }
      return;
    }
    if (sub === 'list') {
      if (useMicro()) {
        const keys = Object.keys(snap()).filter(k => k.startsWith('lib/') && k.endsWith('.py'));
        if (!keys.length) { wl('(no micropython packages installed)'); return; }
        wl('Package                   Location');
        wl('-'.repeat(50));
        for (const k of keys) wl(k.replace('lib/', '').replace('.py', '').padEnd(26) + k);
        return;
      }
      if (!pyodideRt.isLoaded()) { wl('(pyodide not loaded yet — run python first)'); return; }
      await pyodideRt.runPython(`
import sys
mods = sorted(set(m.split('.')[0] for m in sys.modules if not m.startswith('_')))
print('\\n'.join(mods))
`, null, stdoutSink);
      return;
    }
    wl('pip: subcommands: install, list');
  }

  return { python: pythonBuiltin, python3: pythonBuiltin, pip: pipBuiltin, pip3: pipBuiltin };
}

export function createPyEnv({ ctx, term }) {
  const builtins = makePythonBuiltin(ctx);
  async function scanAndMount() {
    if (!pyodideRt.isLoaded()) return [];
    const inst = await pyodideRt.loadPyodide(s => term?.write?.(s));
    const { mountAsgi } = await import('./asgi-bridge.js');
    return pyodideRt.scanAndMount(inst, mountAsgi);
  }
  return { ...builtins, scanAndMount, isLoaded: pyodideRt.isLoaded };
}
