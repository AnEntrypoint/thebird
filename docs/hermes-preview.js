import { mountAsgi, findAsgiApp } from './asgi-bridge.js';
import * as pyodideRt from './shell-python-pyodide.js';

let mounting = null;

async function unpackHermes(inst, onLog) {
  const manifestUrl = new URL('./vendor/hermes/manifest.json', import.meta.url).href + '?_=' + Date.now();
  const manifest = await (await fetch(manifestUrl, { cache: 'no-cache' })).json();
  try { inst.FS.mkdirTree('/vendor-apps/hermes'); } catch {}
  const baseUrl = new URL('./vendor/hermes/', import.meta.url).href;
  if (typeof window !== 'undefined') {
    window.__debug = window.__debug || {};
    window.__debug.appDistFiles = window.__debug.appDistFiles || {};
    window.__debug.appDistBase = window.__debug.appDistBase || {};
    const distSet = new Set();
    const DIST_PREFIX = 'hermes_cli/web_dist/';
    for (const f of (manifest.distFiles || [])) {
      if (f.startsWith(DIST_PREFIX)) distSet.add(f.slice(DIST_PREFIX.length));
    }
    window.__debug.appDistFiles['/hermes'] = distSet;
    window.__debug.appDistBase['/hermes'] = baseUrl + DIST_PREFIX;
  }
  async function fetchChunked(items, kind) {
    const CHUNK = 32;
    const fetched = [];
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      const results = await Promise.all(slice.map(async f => {
        try {
          const r = await fetch(baseUrl + f);
          if (!r.ok) return null;
          return { rel: f, payload: kind === 'text' ? await r.text() : new Uint8Array(await r.arrayBuffer()) };
        } catch { return null; }
      }));
      for (const it of results) if (it) fetched.push(it);
    }
    return fetched;
  }
  const [srcResults, distResults] = await Promise.all([
    fetchChunked(manifest.sources, 'text'),
    fetchChunked(manifest.distFiles || [], 'binary'),
  ]);
  let copied = 0;
  for (const it of srcResults) {
    const dst = '/vendor-apps/hermes/' + it.rel;
    const dir = dst.substring(0, dst.lastIndexOf('/'));
    try { inst.FS.mkdirTree(dir); } catch {}
    try { inst.FS.writeFile(dst, it.payload); copied++; } catch {}
  }
  let distCopied = 0;
  for (const it of distResults) {
    const dst = '/vendor-apps/hermes/' + it.rel;
    const dir = dst.substring(0, dst.lastIndexOf('/'));
    try { inst.FS.mkdirTree(dir); } catch {}
    try { inst.FS.writeFile(dst, it.payload); distCopied++; } catch {}
  }
  inst.runPython(`import sys; sys.path.insert(0, '/vendor-apps/hermes') if '/vendor-apps/hermes' not in sys.path else None`);
  return { srcCount: copied, distCount: distCopied };
}

async function applyHermesTheme(inst) {
  const themeBase = new URL('./vendor/hermes-theme/', import.meta.url).href;
  let manifest = null;
  try { manifest = await (await fetch(themeBase + 'manifest.json', { cache: 'no-cache' })).json(); }
  catch { return { applied: false, reason: 'no theme manifest' }; }
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const themeFile = dark ? (manifest.dark || 'theme/clean-dark.yaml') : (manifest.light || 'theme/clean.yaml');
  let yaml;
  try { yaml = await (await fetch(themeBase + themeFile)).text(); }
  catch { return { applied: false, reason: 'fetch ' + themeFile }; }
  inst.FS.mkdirTree('/home/pyodide/.hermes');
  // Hermes reads dashboard.yaml for theme name; theme file goes alongside
  inst.FS.writeFile('/home/pyodide/.hermes/dashboard-theme.yaml', yaml);
  const themeName = dark ? 'clean-dark' : 'clean';
  inst.FS.writeFile('/home/pyodide/.hermes/dashboard.yaml', `theme: ${themeName}\n`);
  return { applied: true, theme: themeName };
}

export async function mountHermes(onLog = () => {}) {
  if (findAsgiApp('/hermes')) return '/hermes';
  if (mounting) return mounting;
  const t0 = performance.now();
  const phase = (name, t) => { const ms = Math.round(performance.now() - t); onLog(`hermes: [${name}] ${ms}ms\n`); return ms; };
  const phases = {};
  mounting = (async () => {
    onLog('hermes: loading pyodide…\n');
    let t = performance.now();
    const inst = await pyodideRt.loadPyodide(onLog);
    phases.pyodide = phase('pyodide-load', t);

    onLog('hermes: preloading ssl + sqlite3…\n');
    t = performance.now();
    await Promise.all([inst.loadPackage('ssl'), inst.loadPackage('sqlite3'), inst.loadPackage('micropip')]);
    phases.preload = phase('preload', t);

    onLog('hermes: installing wheels + unpacking bundle in parallel…\n');
    t = performance.now();
    const wheelStart = performance.now();
    const wheelTask = inst.runPythonAsync(`
import micropip, asyncio
try: micropip.uninstall('typing-extensions')
except Exception: pass
async def _go():
    await micropip.install('typing-extensions>=4.12')
    pkgs = ('pyyaml', 'pydantic', 'fastapi', 'httpx', 'jinja2', 'requests', 'pyjwt', 'tenacity', 'rich', 'prompt_toolkit')
    await asyncio.gather(*[micropip.install(p, deps=True) for p in pkgs], return_exceptions=True)
await _go()
`).then(() => phases.wheels = Math.round(performance.now() - wheelStart));
    const unpackStart = performance.now();
    const unpackTask = unpackHermes(inst, onLog).then(info => { phases.unpack = Math.round(performance.now() - unpackStart); return info; });
    const [, unpackInfo] = await Promise.all([wheelTask, unpackTask]);
    phases.wheels_and_unpack = phase('wheels-and-unpack-parallel', t);
    onLog(`hermes: wheels ${phases.wheels}ms · unpack ${phases.unpack}ms (${unpackInfo.srcCount} src + ${unpackInfo.distCount} dist)\n`);

    t = performance.now();
    const themeInfo = await applyHermesTheme(inst);
    phases.theme = phase('theme-apply', t);
    if (themeInfo.applied) onLog(`hermes: theme = ${themeInfo.theme}\n`);

    onLog('hermes: importing web_server.app…\n');
    t = performance.now();
    await inst.runPythonAsync(`from hermes_cli.web_server import app as _hermes_app`);
    phases.import = phase('import', t);

    const pyApp = inst.globals.get('_hermes_app');
    if (!pyApp) throw new Error('hermes_cli.web_server.app not in globals');
    inst.globals.set('__hermes_app', pyApp);
    t = performance.now();
    await inst.runPythonAsync(`
def _b(v):
    if isinstance(v, (bytes, bytearray)): return bytes(v)
    if isinstance(v, memoryview): return bytes(v)
    if hasattr(v, 'to_py'): v = v.to_py()
    if isinstance(v, (list, tuple)): return bytes(v)
    if isinstance(v, str): return v.encode('latin-1')
    try: return bytes(v)
    except Exception: return b''
async def _drive_hermes(scope, recv, send):
    if hasattr(scope, 'to_py'): scope = scope.to_py()
    s = dict(scope)
    if 'headers' in s: s['headers'] = [(_b(k), _b(v)) for (k,v) in s['headers']]
    if 'raw_path' in s: s['raw_path'] = _b(s['raw_path'])
    if 'query_string' in s: s['query_string'] = _b(s['query_string'])
    async def _r():
        msg = await recv()
        if hasattr(msg, 'to_py'): msg = msg.to_py()
        if isinstance(msg, dict) and 'body' in msg: msg['body'] = _b(msg['body'])
        return msg
    async def _s(msg): return await send(msg)
    await __hermes_app(s, _r, _s)
`);
    const driver = inst.globals.get('_drive_hermes');
    mountAsgi(async (sc, rcv, snd) => { await driver(sc, rcv, snd); }, '/hermes');
    phases.mount = phase('mount', t);

    const total = Math.round(performance.now() - t0);
    onLog(`hermes: ✓ mounted at /preview/hermes/ — total ${total}ms\n`);
    if (typeof window !== 'undefined') window.__debug.hermesPhases = { ...phases, total };
    return '/hermes';
  })();
  return mounting;
}

export function isHermesMounted() {
  return !!findAsgiApp('/hermes');
}
