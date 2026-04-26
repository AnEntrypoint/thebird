async function probe(label, url, opts = {}) {
  const t = performance.now();
  const optional = opts.optional === true;
  try {
    const res = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, signal: AbortSignal.timeout?.(opts.timeoutMs || 4000) });
    const ms = Math.round(performance.now() - t);
    return { name: label, ok: res.ok, detail: res.status + (res.statusText ? ' ' + res.statusText : ''), ms };
  } catch (e) {
    const ms = Math.round(performance.now() - t);
    const detail = e.name + ': ' + (e.message || '');
    return { name: label, ok: optional ? null : false, detail: optional ? 'not running (' + detail + ')' : detail, ms };
  }
}

export async function runNetworkSmoke() {
  const out = [];
  const { PROVIDERS } = await import('./chat-providers.js');
  for (const [id, prov] of Object.entries(PROVIDERS)) {
    if (!prov.baseUrl) continue;
    const key = localStorage.getItem('apiKey_' + id) || localStorage.getItem(prov.keyPlaceholder);
    if (!key) { out.push({ name: 'provider:' + id, ok: null, detail: 'skipped (no key)', ms: 0 }); continue; }
    const headers = id === 'gemini' ? {} : { Authorization: 'Bearer ' + key };
    const url = id === 'gemini'
      ? prov.baseUrl + '/models?key=' + encodeURIComponent(key)
      : prov.baseUrl.replace(/\/$/, '') + '/models';
    out.push(await probe('provider:' + id, url, { headers }));
  }

  out.push(await probe('local:acptoapi', 'http://localhost:4800/v1/models', { optional: true }));
  out.push(await probe('local:hermes-vite', 'http://localhost:5173/', { optional: true }));
  out.push(await probe('local:kilo-serve', 'http://localhost:7000/', { optional: true }));
  out.push(await probe('local:opencode', 'http://localhost:4096/', { optional: true }));

  out.push(await probe('vendor:pyodide-mjs', './vendor/pyodide/pyodide.mjs'));
  out.push(await probe('vendor:pyodide-wasm', './vendor/pyodide/pyodide.asm.wasm'));
  out.push(await probe('vendor:micropython-mjs', './vendor/micropython/micropython.mjs'));

  const t = performance.now();
  try {
    const m = await import('./shell-python-pyodide.js');
    if (m.isLoaded()) {
      out.push({ name: 'pyodide:already-loaded', ok: true, detail: 'reusing existing instance', ms: 0 });
    } else {
      await m.loadPyodide(() => {});
      const ms = Math.round(performance.now() - t);
      out.push({ name: 'pyodide:cold-load', ok: true, detail: 'first init', ms });
    }
    const r = await (await import('./shell-python-pyodide.js')).runPython('1+1', null, () => {});
    out.push({ name: 'pyodide:1+1', ok: r === 2, detail: 'got ' + r, ms: 0 });
  } catch (e) {
    out.push({ name: 'pyodide:cold-load', ok: false, detail: e.message, ms: Math.round(performance.now() - t) });
  }

  return out;
}
