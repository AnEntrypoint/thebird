import { Terminal, FitAddon } from './vendor/xterm-bundle.js';
import { createMachine, createActor } from './vendor/xstate.js';
import { createShell } from './shell.js';
import { registerPreviewSW } from './preview-sw-client.js';

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

const bootMachine = createMachine({ id: 'terminal', initial: 'loading-idb', states: {
  'loading-idb': { on: { IDB_READY: 'registering-sw' } },
  'registering-sw': { on: { SW_READY: 'ready', SW_ERROR: 'ready' } },
  'ready': {},
  'error': {},
}});

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (typeof window.refreshPreview === 'function') window.refreshPreview();
  }, 5000);
}

async function boot() {
  const el = document.getElementById('term-container');
  if (!el) return;

  const bootActor = createActor(bootMachine);
  bootActor.start();

  window.__debug = window.__debug || {};
  window.__debug.terminal = { get state() { return bootActor.getSnapshot().value; } };

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

  window.__debug.idbSnapshot = files;
  window.__debug.idbPersist = () => idbSave(JSON.stringify(window.__debug.idbSnapshot));
  window.__debug.term = term;
  bootActor.send({ type: 'IDB_READY' });

  try {
    await registerPreviewSW();
    bootActor.send({ type: 'SW_READY' });
  } catch (e) {
    term.write('\x1b[33mSW: ' + e.message + '\x1b[0m\r\n');
    bootActor.send({ type: 'SW_ERROR' });
  }

  const shell = createShell({ term, onPreviewWrite: scheduleReload });
  window.__debug.shellWriter = { write: line => shell.run(line.replace(/\n$/, '')) };
}

boot().catch(e => {
  console.error('[terminal] boot error:', e);
  throw e;
});
