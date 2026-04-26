import { mountAsgi, findAsgiApp } from './asgi-bridge.js';
import * as pyodideRt from './shell-python-pyodide.js';

let mounting = null;

async function unpackHermes(inst, onLog) {
  const manifestUrl = new URL('./vendor/hermes/manifest.json', import.meta.url).href + '?_=' + Date.now();
  const manifest = await (await fetch(manifestUrl, { cache: 'no-cache' })).json();
  try { inst.FS.mkdirTree('/vendor-apps/hermes'); } catch {}
  const baseUrl = new URL('./vendor/hermes/', import.meta.url).href;
  let copied = 0;
  for (const src of manifest.sources) {
    const r = await fetch(baseUrl + src);
    if (!r.ok) continue;
    const text = await r.text();
    const dst = '/vendor-apps/hermes/' + src;
    const dir = dst.substring(0, dst.lastIndexOf('/'));
    try { inst.FS.mkdirTree(dir); } catch {}
    try { inst.FS.writeFile(dst, text); copied++; } catch {}
  }
  for (const rel of (manifest.distFiles || [])) {
    const r = await fetch(baseUrl + rel);
    if (!r.ok) continue;
    const buf = new Uint8Array(await r.arrayBuffer());
    const dst = '/vendor-apps/hermes/' + rel;
    const dir = dst.substring(0, dst.lastIndexOf('/'));
    try { inst.FS.mkdirTree(dir); } catch {}
    try { inst.FS.writeFile(dst, buf); } catch {}
  }
  inst.runPython(`import sys; sys.path.insert(0, '/vendor-apps/hermes') if '/vendor-apps/hermes' not in sys.path else None`);
  onLog?.(`hermes: ${copied} src + ${manifest.distFiles?.length || 0} dist files unpacked\n`);
}

export async function mountHermes(onLog = () => {}) {
  if (findAsgiApp('/hermes')) return '/hermes';
  if (mounting) return mounting;
  mounting = (async () => {
    onLog('hermes: loading pyodide…\n');
    const inst = await pyodideRt.loadPyodide(onLog);
    onLog('hermes: preloading ssl + sqlite3…\n');
    await inst.loadPackage('ssl');
    await inst.loadPackage('sqlite3');
    await inst.loadPackage('micropip');
    onLog('hermes: installing wheels (typing-extensions, fastapi, pydantic, pyyaml)…\n');
    await inst.runPythonAsync(`
import micropip
try: micropip.uninstall('typing-extensions')
except Exception: pass
await micropip.install('typing-extensions>=4.12')
for pkg in ('pyyaml', 'pydantic', 'fastapi', 'httpx', 'jinja2', 'requests', 'pyjwt', 'tenacity', 'rich', 'prompt_toolkit'):
    try: await micropip.install(pkg)
    except Exception: pass
`);
    onLog('hermes: unpacking 245-file bundle…\n');
    await unpackHermes(inst, onLog);
    onLog('hermes: importing web_server.app…\n');
    await inst.runPythonAsync(`from hermes_cli.web_server import app as _hermes_app`);
    const pyApp = inst.globals.get('_hermes_app');
    if (!pyApp) throw new Error('hermes_cli.web_server.app not in globals');
    inst.globals.set('__hermes_app', pyApp);
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
    onLog('hermes: mounted at /preview/hermes/\n');
    return '/hermes';
  })();
  return mounting;
}

export function isHermesMounted() {
  return !!findAsgiApp('/hermes');
}
