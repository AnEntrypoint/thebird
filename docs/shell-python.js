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

  async function getInterpreter() {
    return getMp(line => w(line.replace(/\n/g, '\r\n')));
  }

  async function bridgeFs(instance) {
    instance.globals.set('_idb_snap', snap());
    instance.globals.set('_idb_persist', persist);
    await instance.runPythonAsync(`
import sys, os
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
    const instance = await getInterpreter();
    instance.globals.set('__mp_argv', argv);
    await bridgeFs(instance);
    await instance.runPythonAsync('import sys; sys.argv = list(__mp_argv)');
    await instance.runPythonAsync(code);
  }

  async function pipInstall(pkgs) {
    const instance = await getInterpreter();
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
          const text = await r.text();
          const key = 'lib/' + path;
          snap()[key] = text;
        }
        if (meta.urls) {
          for (const [path, fileUrl] of meta.urls) {
            const r = await fetch(fileUrl);
            const text = await r.text();
            snap()[path] = text;
          }
        }
        persist();
        wl('  \x1b[32m✓ ' + pkg + '\x1b[0m');
      } catch (e) {
        wl('  \x1b[31m✗ ' + pkg + ': ' + e.message + '\x1b[0m');
      }
    }
  }

  async function pythonBuiltin(args, _actor, stdin) {
    const cFlag = args.indexOf('-c');
    if (cFlag >= 0) {
      await runCode(args[cFlag + 1] || '', ['python', ...args.slice(cFlag + 2)]);
      return;
    }
    if (!args.length) {
      if (stdin) { await runCode(stdin, ['python']); return; }
      wl('MicroPython — use: python script.py | python -c "code" | echo "code" | python');
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
      await pipInstall(pkgs);
      return;
    }
    if (sub === 'list') {
      const keys = Object.keys(snap()).filter(k => k.startsWith('lib/') && k.endsWith('.py'));
      if (!keys.length) { wl('(no micropython packages installed)'); return; }
      wl('Package                   Location');
      wl('-'.repeat(50));
      for (const k of keys) wl(k.replace('lib/', '').replace('.py', '').padEnd(26) + k);
      return;
    }
    wl('pip: subcommands: install, list');
  }

  return { python: pythonBuiltin, python3: pythonBuiltin, pip: pipBuiltin, pip3: pipBuiltin };
}
