const results = [];
const t0 = () => performance.now();
const dur = s => Math.round(performance.now() - s);

function record(name, ok, detail, ms) { results.push({ name, ok, detail: detail || '', ms: ms ?? 0 }); }
function pass(name, detail, ms) { record(name, true, detail, ms); }
function fail(name, err, ms) { record(name, false, err?.message || String(err), ms); }

async function check(name, fn) {
  const s = t0();
  try { const d = await fn(); pass(name, typeof d === 'string' ? d : '', dur(s)); }
  catch (e) { fail(name, e, dur(s)); }
}

async function ensureLiveApp() {
  if (typeof window.switchPage === 'function') {
    try { window.switchPage('app'); } catch {}
  }
  for (let i = 0; i < 60; i++) {
    if (window.__debug?.shell?.run && window.__debug?.idbSnapshot) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

export async function runSmoke({ skipNet = true } = {}) {
  results.length = 0;

  await check('live app boot', async () => { const ok = await ensureLiveApp(); if (!ok) throw new Error('shell never booted within 12s'); });
  await check('window.__debug exists', () => { if (!window.__debug) throw new Error('missing'); });
  await check('window.__debug.shell present', () => { if (!window.__debug.shell) throw new Error('shell not booted'); });
  await check('shell.run is a function', () => { if (typeof window.__debug.shell.run !== 'function') throw new Error('no run()'); });
  await check('terminal element rendered', () => { if (!document.querySelector('#term-container .xterm-viewport')) throw new Error('xterm-viewport missing'); });
  await check('IDB snapshot ready', () => { if (!window.__debug.idbSnapshot) throw new Error('no snapshot'); return Object.keys(window.__debug.idbSnapshot).length + ' keys'; });

  await check('shell ctx.cwd defaults to /home', () => { if (window.__debug.shell.cwd !== '/home') throw new Error(window.__debug.shell.cwd); });

  await check('ls /home runs without error', async () => { await window.__debug.shell.run('ls /home'); });
  await check('echo + cat pipe', async () => { await window.__debug.shell.run('echo smoketest > /home/.smoke && cat /home/.smoke'); });
  await check('IDB write persisted', () => { if (window.__debug.idbSnapshot['home/.smoke'] !== 'smoketest\n' && window.__debug.idbSnapshot['home/.smoke'] !== 'smoketest') throw new Error('expected "smoketest", got ' + JSON.stringify(window.__debug.idbSnapshot['home/.smoke'])); });
  await check('cd nonexistent throws', async () => { try { await window.__debug.shell.run('cd /nope'); } catch { return 'caught'; } if (window.__debug.shell.cwd === '/nope') throw new Error('cd accepted nonexistent'); });
  await check('cd ~ resolves to /home', async () => { await window.__debug.shell.run('cd ~'); if (window.__debug.shell.cwd !== '/home') throw new Error(window.__debug.shell.cwd); });

  await check('preview iframe present', () => { if (!document.getElementById('preview-frame')) throw new Error('preview-frame missing'); });
  await check('preview URL bar present', () => { if (!document.getElementById('preview-url')) throw new Error('preview-url missing'); });
  await check('asgi launcher span present', () => { if (!document.getElementById('asgi-launchers')) throw new Error('missing'); });

  await check('chat-providers PROVIDERS has 20+ entries', async () => {
    const { PROVIDERS } = await import('./chat-providers.js');
    const n = Object.keys(PROVIDERS).length;
    if (n < 20) throw new Error('only ' + n);
    return n + ' providers';
  });
  await check('chat-providers acptoapi entry sane', async () => {
    const { PROVIDERS } = await import('./chat-providers.js');
    if (PROVIDERS.acptoapi.baseUrl !== 'http://localhost:4800/v1') throw new Error(PROVIDERS.acptoapi.baseUrl);
  });

  await check('shell-defaults exports DEFAULT_CWD', async () => {
    const m = await import('./shell-defaults.js');
    if (m.DEFAULT_CWD !== '/home') throw new Error(m.DEFAULT_CWD);
  });

  await check('asgi-bridge mountAsgi+dispatch round-trip', async () => {
    const m = await import('./asgi-bridge.js');
    const stub = async (scope, recv, send) => {
      if (scope.type === 'lifespan') return;
      await recv();
      await send({ type: 'http.response.start', status: 200, headers: [[new TextEncoder().encode('content-type'), new TextEncoder().encode('text/plain')]] });
      await send({ type: 'http.response.body', body: 'sm-ok' });
    };
    m.mountAsgi(stub, '/__smoke');
    const r = await m.dispatchAsgi('GET', '/__smoke/x', {}, null);
    m.unmountAsgi('/__smoke');
    if (r.status !== 200 || r.body !== 'sm-ok') throw new Error('status=' + r.status + ' body=' + r.body);
  });

  await check('lazy pyodide loader present and NOT loaded', async () => {
    const m = await import('./shell-python-pyodide.js');
    if (typeof m.loadPyodide !== 'function') throw new Error('no loadPyodide');
    if (m.isLoaded()) throw new Error('pyodide already loaded — should be lazy');
  });
  await check('python builtin available in shell', async () => {
    const out = await window.__debug.shell.run('which python').catch(() => null);
    if (!Object.keys(window.__debug.idbSnapshot).length) throw new Error('idb empty');
  });

  await check('GitHub login button present', () => { if (!document.getElementById('gh-login-btn')) throw new Error('gh-login-btn missing'); });
  await check('Theme toggle works', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    window.toggleTheme();
    const after = document.documentElement.getAttribute('data-theme');
    if (cur === after) throw new Error('did not toggle');
    window.toggleTheme();
  });

  await check('Tabs: chat / term / preview present', () => {
    for (const id of ['tab-chat', 'tab-term', 'tab-preview']) if (!document.getElementById(id)) throw new Error('missing ' + id);
  });
  await check('Switch to terminal tab does not throw', () => { window.switchTab?.('term'); window.switchTab?.('chat'); });

  if (!skipNet) {
    const net = await import('./smoke-network.js');
    const netResults = await net.runNetworkSmoke();
    for (const r of netResults) results.push(r);
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, total: results.length, results };
}

export function renderSmokePanel(report) {
  const old = document.getElementById('smoke-panel'); if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'smoke-panel';
  panel.style.cssText = 'position:fixed;top:8px;right:8px;width:520px;max-height:90vh;overflow:auto;background:var(--panel-1,#fff);color:var(--panel-text,#111);box-shadow:0 8px 32px rgba(0,0,0,0.25);font:12px/1.5 ui-monospace,monospace;padding:12px;z-index:99999;border-radius:8px';
  const head = document.createElement('div');
  head.innerHTML = `<strong>smoke</strong> — ${report.passed}/${report.total} ok` + (report.failed ? `, <span style="color:#c33">${report.failed} fail</span>` : '') + ` <button onclick="document.getElementById('smoke-panel').remove()" style="float:right;background:none;border:0;cursor:pointer;font-size:14px">×</button>`;
  panel.appendChild(head);
  const list = document.createElement('div');
  list.style.cssText = 'margin-top:8px';
  for (const r of report.results) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:2px 0;display:flex;gap:8px';
    row.innerHTML = `<span style="color:${r.ok ? '#3a3' : '#c33'};width:14px">${r.ok ? '✓' : '✗'}</span><span style="flex:1">${r.name}${r.detail ? ' <span style="color:#888">— ' + r.detail.replace(/[<>]/g, '') + '</span>' : ''}</span><span style="color:#888">${r.ms}ms</span>`;
    list.appendChild(row);
  }
  panel.appendChild(list);
  document.body.appendChild(panel);
}

export async function autoRunIfRequested() {
  const params = new URLSearchParams(location.search);
  if (!params.has('smoke')) return null;
  const skipNet = !params.has('net');
  const report = await runSmoke({ skipNet });
  renderSmokePanel(report);
  window.__smokeReport = report;
  return report;
}
