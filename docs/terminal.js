import { Terminal, FitAddon } from './vendor/xterm-bundle.js';
import { init, runWasix } from './vendor/wasmer-sdk.js';

const IDB_KEY = 'thebird_fs_v2';

async function idbLoad() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('thebird', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('fs');
    req.onsuccess = e => {
      const tx = e.target.result.transaction('fs', 'readonly');
      const get = tx.objectStore('fs').get(IDB_KEY);
      get.onsuccess = () => res(get.result || null);
      get.onerror = rej;
    };
    req.onerror = rej;
  });
}

async function idbSave(data) {
  return new Promise((res, rej) => {
    const req = indexedDB.open('thebird', 1);
    req.onsuccess = e => {
      const tx = e.target.result.transaction('fs', 'readwrite');
      tx.objectStore('fs').put(data, IDB_KEY);
      tx.oncomplete = res;
      tx.onerror = rej;
    };
    req.onerror = rej;
  });
}

function absUrl(path) {
  return new URL(path, location.href).toString();
}

async function boot() {
  const el = document.getElementById('term-container');
  if (!el) return;

  const term = new Terminal({ theme: { background: '#000000' }, convertEol: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  fit.fit();
  window.addEventListener('resize', () => fit.fit());

  const saved = await idbLoad();
  let files;
  if (saved) {
    files = JSON.parse(saved);
  } else {
    const r = await fetch('./defaults.json');
    files = await r.json();
  }

  window.__debug = window.__debug || {};
  window.__debug.idbSnapshot = files;
  window.__debug.idbPersist = () => idbSave(JSON.stringify(window.__debug.idbSnapshot));
  window.__debug.term = term;

  term.write('Initialising Wasmer...\r\n');

  try {
    const [wasmResp] = await Promise.all([
      fetch('./vendor/winterjs.wasm'),
      init({
        module: fetch('./vendor/wasmer_js_bg.wasm'),
        workerUrl: absUrl('./vendor/wasmer-worker.js'),
        sdkUrl: absUrl('./vendor/wasmer-sdk.js'),
      }),
    ]);

    const winterModule = await WebAssembly.compileStreaming(wasmResp);

    term.write('Starting WinterJS...\r\n');

    const instance = await runWasix(winterModule, {
      program: 'winterjs',
      args: ['--repl'],
      env: { TERM: 'xterm-256color' },
      stdin: new ReadableStream({
        start(ctrl) { window.__debug.stdinCtrl = ctrl; }
      }),
    });

    instance.stdout.pipeTo(new WritableStream({ write: d => term.write(d) }));
    instance.stderr.pipeTo(new WritableStream({ write: d => term.write(d) }));

    term.onData(data => window.__debug.stdinCtrl?.enqueue(new TextEncoder().encode(data)));
    term.onResize(({ cols, rows }) => instance.setTtySize?.({ cols, rows }));

    window.__debug.wasmerInstance = instance;
    window.__debug.validation = null;

    instance.wait().then(exit => term.write(`\r\n[process exited: ${exit.code}]\r\n`));

  } catch (e) {
    term.write(`\x1b[31mError: ${e.message}\x1b[0m\r\n`);
    console.error('[terminal] wasmer error:', e);
  }
}

boot().catch(e => console.error('[terminal] boot error:', e));
