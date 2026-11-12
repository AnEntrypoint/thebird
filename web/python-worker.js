const WORKSPACE = '/workspace';
const PYODIDE_HOSTS = ['https://cdn.jsdelivr.net/pyodide/v314.0.7/full/', 'https://fastly.jsdelivr.net/pyodide/v314.0.7/full/'];
const INDEX_URL = 'https://pyodide.invalid/v314.0.7/';
const MICROPIP_WHEEL = 'micropip-0.11.1-py3-none-any.whl';
const SKIPPED = /^\/workspace\/\.(thebird|git)(\/|$)/;
const JOURNAL = `import os, sys
_thebird_touched = set()
_thebird_write = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
def _thebird_journal(event, args):
    if event == 'open' and isinstance(args[0], str):
        writes = (isinstance(args[1], str) and any(c in args[1] for c in 'wax+')) or (isinstance(args[2], int) and args[2] & _thebird_write)
        if writes:
            _thebird_touched.add(os.path.abspath(args[0]))
    elif event in ('os.remove', 'os.rmdir', 'os.rename', 'os.replace', 'sqlite3.connect') and isinstance(args[0], str):
        _thebird_touched.add(os.path.abspath(args[0]))
        if len(args) > 1 and isinstance(args[1], str):
            _thebird_touched.add(os.path.abspath(args[1]))
sys.addaudithook(_thebird_journal)
def _thebird_drain():
    paths = sorted(_thebird_touched)
    _thebird_touched.clear()
    return paths
`;

let runtime = null;
let captured = null;
let mirror = new Map();
let micropipLoaded = null;
let bundle = null;
let bundledNames = new Set();

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const normalizeName = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const requestUrl = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
const contentType = (name) => (name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');

function serveBundle() {
  const network = self.fetch.bind(self);
  self.fetch = (input, init) => {
    const url = requestUrl(input);
    if (!url.startsWith(INDEX_URL)) return network(input, init);
    const name = url.slice(INDEX_URL.length);
    const bytes = bundle.files.get(name);
    if (!bytes) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(bytes, { headers: { 'content-type': contentType(name) } }));
  };
}

async function importBytes(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const pythonRuntime = () => {
  if (!bundle) throw new Error('the Python bundle has not been sent to the worker');
  runtime ??= (async () => {
    serveBundle();
    const { loadPyodide } = await importBytes(bundle.files.get('pyodide.mjs'));
    const { default: createPyodideModule } = await importBytes(bundle.files.get('pyodide.asm.mjs'));
    const py = await loadPyodide({
      indexURL: INDEX_URL,
      packageBaseUrl: INDEX_URL,
      lockFileContents: bundle.lock,
      createPyodideModule,
      stdout: (text) => captured?.push(text),
      stderr: (text) => captured?.push(text),
    });
    py.runPython(JOURNAL);
    return py;
  })().catch((err) => {
    runtime = null;
    throw err;
  });
  return runtime;
};

const isFile = (py, path) => {
  try {
    return py.FS.isFile(py.FS.stat(path).mode);
  } catch {
    return false;
  }
};

function drainJournal(py) {
  const drained = py.globals.get('_thebird_drain')();
  const paths = drained.toJs();
  drained.destroy();
  return paths;
}

function reconcile(py, put, drops, keep) {
  for (const [path, bytes] of put) {
    py.FS.mkdirTree(parentOf(path));
    py.FS.writeFile(path, bytes);
    mirror.set(path, { bytes });
  }
  for (const path of drops) {
    if (isFile(py, path)) py.FS.unlink(path);
    mirror.delete(path);
  }
  if (!keep) return;
  const wanted = new Set(keep);
  for (const path of [...mirror.keys()]) {
    if (wanted.has(path)) continue;
    if (isFile(py, path)) py.FS.unlink(path);
    mirror.delete(path);
  }
}

function collect(py, touched) {
  const writes = [];
  const drops = [];
  for (const path of touched) {
    if (!path.startsWith(`${WORKSPACE}/`) || SKIPPED.test(path)) continue;
    const known = mirror.get(path);
    if (!isFile(py, path)) {
      if (known) drops.push(path);
      mirror.delete(path);
      continue;
    }
    const bytes = py.FS.readFile(path);
    if (!known || !sameBytes(known.bytes, bytes)) writes.push([path, bytes]);
    mirror.set(path, { bytes });
  }
  return { writes, drops };
}

async function capture(body) {
  const buffer = [];
  captured = buffer;
  let failure = null;
  try {
    await body();
  } catch (err) {
    failure = err;
  } finally {
    captured = null;
  }
  return {
    output: buffer.join('\n'),
    error: failure === null ? null : failure.message.trim().split('\n').pop(),
  };
}

async function fetchPyodideFile(name) {
  let failure = null;
  for (const base of PYODIDE_HOSTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetch(base + name);
      } catch (error) {
        failure = error;
      }
    }
  }
  throw failure;
}

async function installMicropip(py) {
  const response = await fetchPyodideFile(MICROPIP_WHEEL);
  if (!response.ok) throw new Error(`micropip wheel: HTTP ${response.status}`);
  py.unpackArchive(await response.arrayBuffer(), 'wheel');
}

function ensureMicropip(py) {
  micropipLoaded ??= installMicropip(py).catch((err) => {
    micropipLoaded = null;
    throw err;
  });
  return micropipLoaded;
}

const handlers = {
  async version() {
    const py = await pythonRuntime();
    await ensureMicropip(py);
    return capture(() => py.runPython("import importlib.metadata\nprint(importlib.metadata.version('micropip'))"));
  },
  load({ files, lock }) {
    bundle = { files, lock };
    bundledNames = new Set(Object.keys(JSON.parse(lock).packages));
    return null;
  },
  async run({ put, drops, keep, source, filename }) {
    const py = await pythonRuntime();
    py.FS.mkdirTree(WORKSPACE);
    py.FS.chdir(WORKSPACE);
    reconcile(py, put, drops, keep);
    drainJournal(py);
    const result = await capture(async () => {
      await py.loadPackagesFromImports(source, { messageCallback: () => {}, errorCallback: (text) => captured?.push(text) });
      py.runPython(source, { filename });
    });
    return { ...result, ...collect(py, drainJournal(py)) };
  },
  async install({ names }) {
    const py = await pythonRuntime();
    const pinned = names.find((name) => bundledNames.has(normalizeName(name)));
    if (pinned) throw new Error(`pip install: ${pinned} is part of the Pyodide package set, so it cannot be installed in-page`);
    await ensureMicropip(py);
    const list = JSON.stringify(names);
    return capture(() => py.runPythonAsync(`import micropip, importlib.metadata\nawait micropip.install(${list})\nfor name in ${list}:\n    print('installed', name, importlib.metadata.version(name))`));
  },
};

self.onmessage = async ({ data: { id, op, ...payload } }) => {
  let reply;
  try {
    reply = { id, ok: true, result: await handlers[op](payload) };
  } catch (err) {
    reply = { id, ok: false, error: err.message };
  }
  postMessage(reply);
};
