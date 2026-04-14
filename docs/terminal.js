import { WebContainer } from 'https://esm.sh/@webcontainer/api';
import { Terminal } from 'https://esm.sh/@xterm/xterm';
import { FitAddon } from 'https://esm.sh/@xterm/addon-fit';

const IDB_KEY = 'thebird_fs';

const SERVER_JS = [
  'const http = require("http");',
  'const state = { requests: 0, start: Date.now() };',
  'http.createServer((req, res) => {',
  '  state.requests++;',
  '  res.setHeader("Content-Type", "application/json");',
  '  res.setHeader("Access-Control-Allow-Origin", "*");',
  '  res.end(JSON.stringify({ ok: true, path: req.url, requests: state.requests, uptime: Date.now() - state.start }));',
  '}).listen(3000, () => console.log("server ready on :3000"));',
].join('\n') + '\n';

const INDEX_JS = [
  'const { default: Anthropic } = require("@anthropic-ai/sdk");',
  'const http = require("http");',
  'const client = new Anthropic({ apiKey: "x", baseURL: "http://localhost:3000" });',
  'console.log("sdk:", client.constructor.name);',
  'http.get("http://localhost:3000/status", r => {',
  '  let d = "";',
  '  r.on("data", c => d += c);',
  '  r.on("end", () => console.log("server:", d));',
  '});',
].join('\n') + '\n';

const DEFAULT_FILES = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { '@anthropic-ai/sdk': '^0.88.0' } }, null, 2),
  'server.js': SERVER_JS,
  'index.js': INDEX_JS,
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
    term.write('\x1b[31mBoot failed: ' + e.message + '\x1b[0m\r\n');
    throw e;
  }
  await container.mount(mountTree);

  container.on('server-ready', (port, url) => {
    const frame = document.getElementById('preview-frame');
    if (frame) frame.src = url;
    window.__debug.previewUrl = url;
    const btn = document.getElementById('tab-preview');
    if (btn) btn.textContent = 'Preview :' + port;
  });

  term.write('Installing dependencies...\r\n');
  const install = await container.spawn('npm', ['install']);
  install.output.pipeTo(new WritableStream({ write: d => term.write(d) }));
  const exitCode = await install.exit;
  if (exitCode !== 0) throw new Error('npm install failed: ' + exitCode);

  const srv = await container.spawn('node', ['server.js']);
  srv.output.pipeTo(new WritableStream({ write: d => term.write(d) }));

  term.write('\x1b[32mReady.\x1b[0m\r\n');

  const shell = await container.spawn('jsh', [], {
    terminal: { cols: term.cols, rows: term.rows },
  });
  shell.output.pipeTo(new WritableStream({ write: d => term.write(d) }));
  term.onResize(({ cols, rows }) => shell.resize({ cols, rows }));
  const writer = shell.input.getWriter();
  term.onData(data => writer.write(data));

  await snapshotToIDB(container, files);

  window.__debug = window.__debug || {};
  window.__debug.container = container;
  window.__debug.term = term;
  window.__debug.previewUrl = null;
  window.__debug.shell = shell;
  window.__debug.srv = srv;
}

boot().catch(e => console.error('[terminal] boot error:', e));
