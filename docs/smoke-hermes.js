const HERMES_PRELOAD_PACKAGES = ['ssl', 'sqlite3'];
const HERMES_PREFLIGHT_UPGRADES = ['typing-extensions>=4.12'];
const HERMES_CORE_WHEELS = ['pyyaml', 'pydantic', 'fastapi'];
const HERMES_OPTIONAL_WHEELS = ['httpx', 'jinja2', 'requests', 'pyjwt', 'tenacity', 'rich', 'prompt_toolkit'];
const HERMES_KNOWN_GAPS = {
  'fal-client': 'no Pyodide wheel; install fails — Hermes degrades but boots if image-gen tools unused',
  'firecrawl-py': 'no wheel; webcrawl tool unavailable',
  'parallel-web': 'no wheel; skip',
  'exa-py': 'no wheel; web-search tool unavailable',
  'edge-tts': 'no wheel; TTS unavailable',
  'cryptography': 'wheel exists but heavy; pyjwt[crypto] needs it for RS256',
};

const t0 = () => performance.now();
const dur = s => Math.round(performance.now() - s);

export async function runHermesPreflight({ onStep } = {}) {
  const steps = [];
  const step = (name, ok, detail, ms, hint) => {
    const r = { name, ok, detail: detail || '', ms: ms || 0, hint: hint || '' };
    steps.push(r); onStep?.(r); return r;
  };

  let inst;
  let s = t0();
  try {
    const py = await import('./shell-python-pyodide.js');
    if (py.isLoaded()) {
      inst = await py.loadPyodide(() => {});
      step('pyodide:load', true, 'reused existing instance', dur(s));
    } else {
      inst = await py.loadPyodide(line => onStep?.({ name: 'pyodide:log', ok: true, detail: line.trim().slice(0, 120), ms: 0 }));
      step('pyodide:load', true, 'cold-loaded', dur(s));
    }
  } catch (e) {
    step('pyodide:load', false, e.message, dur(s), 'Run scripts/vendor-fetch.mjs to localize Pyodide');
    return { steps, ok: false };
  }

  s = t0();
  try {
    await inst.loadPackage('micropip');
    step('micropip:loaded', true, '', dur(s));
  } catch (e) {
    step('micropip:loaded', false, e.message, dur(s));
    return { steps, ok: false };
  }

  for (const pkg of HERMES_PRELOAD_PACKAGES) {
    s = t0();
    try {
      await inst.loadPackage(pkg);
      step('preload:' + pkg, true, '', dur(s));
    } catch (e) {
      step('preload:' + pkg, false, e.message.slice(0, 200), dur(s),
        'pyodide-bundled package — should not fail');
    }
  }

  for (const pkg of HERMES_PREFLIGHT_UPGRADES) {
    s = t0();
    try {
      const base = pkg.split(/[<>=!~]/)[0].trim();
      inst.globals.set('__base', base);
      inst.globals.set('__pkg', pkg);
      await inst.runPythonAsync(`
import micropip
try: micropip.uninstall(__base)
except Exception: pass
await micropip.install(__pkg)
`);
      step('upgrade:' + pkg, true, 'uninstalled+reinstalled', dur(s));
    } catch (e) {
      step('upgrade:' + pkg, null, e.message.slice(0, 200), dur(s), 'pre-upgrade — pyodide ships older pin');
    }
  }
  for (const pkg of HERMES_CORE_WHEELS) {
    s = t0();
    try {
      inst.globals.set('__pkg', pkg);
      await inst.runPythonAsync(`import micropip; await micropip.install(__pkg)`);
      step('wheel:' + pkg, true, '', dur(s));
    } catch (e) {
      step('wheel:' + pkg, false, e.message.slice(0, 400), dur(s),
        HERMES_KNOWN_GAPS[pkg] || 'check pyodide wheel availability for ' + pkg);
    }
  }
  for (const pkg of HERMES_OPTIONAL_WHEELS) {
    s = t0();
    try {
      inst.globals.set('__pkg', pkg);
      await inst.runPythonAsync(`import micropip; await micropip.install(__pkg)`);
      step('wheel-opt:' + pkg, true, '', dur(s));
    } catch (e) {
      step('wheel-opt:' + pkg, null, e.message.slice(0, 160), dur(s),
        HERMES_KNOWN_GAPS[pkg] || 'optional — Hermes may degrade');
    }
  }

  s = t0();
  try {
    await inst.runPythonAsync('import fastapi; import pydantic; import yaml');
    step('imports:core', true, 'fastapi+pydantic+yaml', dur(s));
  } catch (e) {
    step('imports:core', false, e.message, dur(s));
    return { steps, ok: false };
  }

  s = t0();
  try {
    await inst.runPythonAsync(`
from fastapi import FastAPI
_app = FastAPI(title="hermes-smoke-stub")
@_app.get("/")
async def _r(): return {"ok": True, "preflight": "stub"}
`);
    const pyApp = inst.globals.get('_app');
    if (!pyApp) throw new Error('FastAPI app not in globals');
    inst.globals.set('__pyapp', pyApp);
    await inst.runPythonAsync(`
def _b(v):
    if isinstance(v, (bytes, bytearray)): return bytes(v)
    if isinstance(v, memoryview): return bytes(v)
    if hasattr(v, 'to_py'): v = v.to_py()
    if isinstance(v, (list, tuple)): return bytes(v)
    if isinstance(v, str): return v.encode('latin-1')
    try: return bytes(v)
    except Exception: return b''
async def _drive(scope, recv, send):
    if hasattr(scope, 'to_py'): scope = scope.to_py()
    s = dict(scope)
    if 'headers' in s: s['headers'] = [(_b(k), _b(v)) for (k,v) in s['headers']]
    if 'raw_path' in s: s['raw_path'] = _b(s['raw_path'])
    if 'query_string' in s: s['query_string'] = _b(s['query_string'])
    async def _recv():
        msg = await recv()
        if hasattr(msg, 'to_py'): msg = msg.to_py()
        if isinstance(msg, dict) and 'body' in msg: msg['body'] = _b(msg['body'])
        return msg
    async def _send(msg): return await send(msg)
    await __pyapp(s, _recv, _send)
`);
    const driver = inst.globals.get('_drive');
    const callable = async (scope, receive, send) => {
      const r = driver(scope, receive, send);
      if (r?.then) await r;
    };
    const { mountAsgi, dispatchAsgi, unmountAsgi } = await import('./asgi-bridge.js');
    mountAsgi(callable, '/__hermes_stub');
    const resp = await dispatchAsgi('GET', '/__hermes_stub/', { 'host': 'thebird' }, null);
    unmountAsgi('/__hermes_stub');
    if (resp.status !== 200) throw new Error('status=' + resp.status + ' body=' + String(resp.body).slice(0, 200));
    step('asgi:fastapi-stub', true, 'GET / → ' + resp.status, dur(s));
  } catch (e) {
    step('asgi:fastapi-stub', false, e.message, dur(s),
      'fastapi+asgi-bridge integration broken — fix before attempting full hermes');
    return { steps, ok: false };
  }

  s = t0();
  try {
    const manifestUrl = new URL('./vendor/hermes/manifest.json', import.meta.url).href + '?_=' + Date.now();
    const manifest = await (await fetch(manifestUrl, { cache: 'no-cache' })).json();
    try { inst.FS.mkdir('/vendor-apps/hermes'); } catch {}
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
    let distCopied = 0;
    for (const rel of (manifest.distFiles || [])) {
      const r = await fetch(baseUrl + rel);
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      const dst = '/vendor-apps/hermes/' + rel;
      const dir = dst.substring(0, dst.lastIndexOf('/'));
      try { inst.FS.mkdirTree(dir); } catch {}
      try { inst.FS.writeFile(dst, buf); distCopied++; } catch {}
    }
    inst.runPython(`import sys; sys.path.insert(0, '/vendor-apps/hermes')`);
    step('hermes:bundle-unpack', true, copied + ' src + ' + distCopied + ' dist files', dur(s));
  } catch (e) {
    step('hermes:bundle-unpack', false, e.message.slice(0, 200), dur(s));
    return { steps, ok: false };
  }

  s = t0();
  try {
    await inst.runPythonAsync(`import hermes_cli; ver = getattr(hermes_cli, '__version__', '?')`);
    const ver = inst.globals.get('ver');
    step('hermes:import-pkg', true, 'v' + ver, dur(s));
  } catch (e) {
    step('hermes:import-pkg', false, String(e.message).split('\\n').slice(-3).join(' | ').slice(0, 280), dur(s),
      'Some Hermes module failed at import. Add the missing native shim to docs/vendor/python-shims/ or extend the stub finder safe-prefix list in python-runtime.py.');
    return { steps, ok: false };
  }

  s = t0();
  try {
    await inst.runPythonAsync(`from hermes_cli.web_server import app as _hermes_app`);
    const pyApp = inst.globals.get('_hermes_app');
    if (!pyApp) throw new Error('hermes_cli.web_server.app not in globals');
    inst.globals.set('__hermes_app', pyApp);
    await inst.runPythonAsync(`
def _to_bytes(v):
    if isinstance(v, (bytes, bytearray)): return bytes(v)
    if isinstance(v, memoryview): return bytes(v)
    if hasattr(v, 'to_py'): v = v.to_py()
    if isinstance(v, (list, tuple)): return bytes(v)
    if isinstance(v, str): return v.encode('latin-1')
    try: return bytes(v)
    except Exception: return b''
def _normalize_scope(scope):
    if hasattr(scope, 'to_py'): scope = scope.to_py()
    s = dict(scope)
    if 'headers' in s:
        s['headers'] = [(_to_bytes(k), _to_bytes(v)) for (k, v) in s['headers']]
    if 'raw_path' in s: s['raw_path'] = _to_bytes(s['raw_path'])
    if 'query_string' in s: s['query_string'] = _to_bytes(s['query_string'])
    return s
async def _drive_hermes(scope, recv, send):
    pyscope = _normalize_scope(scope)
    async def _r():
        msg = await recv()
        if hasattr(msg, 'to_py'): msg = msg.to_py()
        if isinstance(msg, dict) and 'body' in msg:
            msg['body'] = _to_bytes(msg['body'])
        return msg
    async def _s(msg): return await send(msg)
    await __hermes_app(pyscope, _r, _s)
`);
    const driver2 = inst.globals.get('_drive_hermes');
    const { mountAsgi, dispatchAsgi } = await import('./asgi-bridge.js');
    mountAsgi(async (sc, rcv, snd) => { await driver2(sc, rcv, snd); }, '/hermes');
    const r = await dispatchAsgi('GET', '/hermes/', { 'host': 'thebird' }, null);
    const bodyLen = String(r.body || '').length;
    step('hermes:mount', true, 'GET / → ' + r.status + ' (' + bodyLen + ' bytes)', dur(s));
  } catch (e) {
    step('hermes:mount', false, String(e.message).split('\\n').slice(-3).join(' | ').slice(0, 280), dur(s),
      'web_server.app failed to load or respond. Check hermes:import-pkg detail and add shims as needed.');
    return { steps, ok: false };
  }

  const ROUTES = [
    { method: 'GET', path: '/', name: 'spa-root', expectStatus: 200 },
    { method: 'GET', path: '/api/status', name: 'api-status', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/config', name: 'api-config', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/config/defaults', name: 'api-config-defaults', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/config/schema', name: 'api-config-schema', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/env', name: 'api-env', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/sessions', name: 'api-sessions', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/cron/jobs', name: 'api-cron-jobs', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/providers/oauth', name: 'api-oauth-providers', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/skills', name: 'api-skills', expectStatus: 200, expectJson: true },
    { method: 'GET', path: '/api/dashboard/themes', name: 'api-themes', expectStatus: 200, expectJson: true },
  ];
  const { dispatchAsgi: dispatch2 } = await import('./asgi-bridge.js');
  for (const r of ROUTES) {
    s = t0();
    try {
      const resp = await dispatch2(r.method, '/hermes' + r.path, { 'host': 'thebird', 'accept': r.expectJson ? 'application/json' : 'text/html' }, null);
      const body = String(resp.body || '');
      const okStatus = resp.status === r.expectStatus;
      const bodyLen = body.length;
      let detail = r.method + ' ' + r.path + ' → ' + resp.status + ' (' + bodyLen + 'B)';
      if (!okStatus) {
        const err = body.slice(0, 280).replace(/\s+/g, ' ');
        step('route:' + r.name, false, detail + ' — ' + err, dur(s));
        continue;
      }
      if (r.expectJson) {
        try { JSON.parse(body); detail += ' json✓'; }
        catch { step('route:' + r.name, false, detail + ' — body is not JSON: ' + body.slice(0, 100), dur(s)); continue; }
      }
      step('route:' + r.name, true, detail, dur(s));
    } catch (e) {
      step('route:' + r.name, false, String(e.message).split('\\n').slice(-2).join(' | ').slice(0, 280), dur(s));
    }
  }

  s = t0();
  try {
    const { openWebSocket } = await import('./asgi-bridge.js');
    const got = await new Promise((resolve, reject) => {
      let opened = false;
      const ws = openWebSocket('/hermes/api/events', {
        onOpen: () => { opened = true; setTimeout(() => ws?.close?.(1000, 'smoke'), 1500); },
        onMessage: () => {},
        onClose: (code, reason) => resolve({ opened, code, reason }),
        onError: e => reject(e),
      });
      if (!ws) return reject(new Error('openWebSocket returned null'));
      setTimeout(() => { try { ws.close?.(1000, 'timeout'); } catch {}; resolve({ opened, code: 1006, reason: 'timeout' }); }, 4000);
    });
    if (!got.opened) throw new Error('websocket.accept never sent (close ' + got.code + ' ' + got.reason + ')');
    step('hermes:websocket', true, 'accepted; closed ' + got.code, dur(s));
  } catch (e) {
    step('hermes:websocket', null, String(e.message).slice(0, 240), dur(s),
      'WebSocket route may auth-gate or have prerequisites; non-blocking.');
  }

  return { steps, ok: steps.every(r => r.ok !== false) };
}

export function renderHermesPanel(report) {
  const old = document.getElementById('hermes-panel'); if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'hermes-panel';
  panel.style.cssText = 'position:fixed;top:8px;right:8px;width:640px;max-height:92vh;overflow:auto;background:var(--panel-1,#fff);color:var(--panel-text,#111);box-shadow:0 8px 32px rgba(0,0,0,0.3);font:12px/1.5 ui-monospace,monospace;padding:14px;z-index:99999;border-radius:8px';
  const total = report.steps.length;
  const ok = report.steps.filter(r => r.ok === true).length;
  const fail = report.steps.filter(r => r.ok === false).length;
  const skip = report.steps.filter(r => r.ok === null).length;
  panel.innerHTML = `<strong>hermes preflight</strong> — ${ok} ok, ${fail} fail, ${skip} skip <button onclick="document.getElementById('hermes-panel').remove()" style="float:right;background:none;border:0;cursor:pointer;font-size:14px">×</button>` +
    '<div style="margin-top:8px">' +
    report.steps.map(r => {
      const icon = r.ok === true ? '<span style="color:#3a3">✓</span>' : r.ok === false ? '<span style="color:#c33">✗</span>' : '<span style="color:#c80">~</span>';
      const detail = r.detail ? ' <span style="color:#888">— ' + r.detail.replace(/[<>]/g, '') + '</span>' : '';
      const hint = r.hint ? '<div style="color:#888;font-size:11px;padding-left:22px;margin-top:2px">→ ' + r.hint.replace(/[<>]/g, '') + '</div>' : '';
      return `<div style="padding:3px 0"><span style="display:inline-block;width:18px">${icon}</span><span>${r.name}${detail}</span><span style="float:right;color:#888">${r.ms}ms</span>${hint}</div>`;
    }).join('') +
    '</div>';
  document.body.appendChild(panel);
}

export async function autoRunIfRequested() {
  const params = new URLSearchParams(location.search);
  if (params.get('smoke') !== 'hermes') return null;
  const report = await runHermesPreflight({ onStep: () => {} });
  renderHermesPanel(report);
  window.__hermesPreflight = report;
  return report;
}
