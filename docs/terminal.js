import { WebContainer } from 'https://esm.sh/@webcontainer/api';
import { Terminal } from 'https://esm.sh/@xterm/xterm';
import { FitAddon } from 'https://esm.sh/@xterm/addon-fit';

const IDB_KEY = 'thebird_fs';
const DEFAULT_FILES = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { '@anthropic-ai/sdk': '^0.88.0' } }, null, 2),
  'index.js': 'const Anthropic = require("@anthropic-ai/sdk");\nconsole.log("sdk loaded:", typeof Anthropic);\n',
};

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

async function snapshotToIDB(container, files) {
  const snap = {};
  await Promise.all(Object.keys(files).map(async p => {
    try { snap[p] = await container.fs.readFile(p, 'utf-8'); } catch {}
  }));
  await idbSave(JSON.stringify(snap));
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
  const files = saved ? JSON.parse(saved) : DEFAULT_FILES;
  const mountTree = Object.fromEntries(
    Object.entries(files).map(([p, c]) => [p, { file: { contents: c } }])
  );

  term.write('Booting WebContainer...\r\n');
  let container;
  try {
    container = await WebContainer.boot();
  } catch (e) {
    term.write('\x1b[31mWebContainer boot failed: ' + e.message + '\x1b[0m\r\n');
    throw e;
  }
  await container.mount(mountTree);
  term.write('Installing dependencies...\r\n');

  const install = await container.spawn('npm', ['install']);
  install.output.pipeTo(new WritableStream({ write: d => term.write(d) }));
  const code = await install.exit;
  if (code !== 0) throw new Error('npm install failed with code ' + code);

  term.write('\x1b[32mReady.\x1b[0m Run commands below.\r\n$ ');

  const shell = await container.spawn('sh', ['-c', 'while true; do read -r line && sh -c "$line" && printf "$ "; done']);
  shell.output.pipeTo(new WritableStream({ write: d => term.write(d) }));

  let buf = '';
  term.onData(async data => {
    if (data === '\r') {
      term.write('\r\n');
      await shell.input.write(buf + '\n');
      await snapshotToIDB(container, files);
      buf = '';
    } else if (data === '\x7f') {
      if (buf.length > 0) { buf = buf.slice(0, -1); term.write('\b \b'); }
    } else {
      buf += data;
      term.write(data);
    }
  });

  window.__debug = window.__debug || {};
  window.__debug.container = container;
  window.__debug.term = term;
}

boot().catch(e => console.error('[terminal] boot error:', e));
