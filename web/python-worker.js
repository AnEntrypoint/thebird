const WORKSPACE = '/workspace';
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const INDEX_URL = 'https://pyodide.invalid/v314.0.7/';
const MICROPIP_WHEEL = 'micropip-0.11.1-py3-none-any.whl';
const SKIPPED = /^\/workspace\/\.(thebird|git)(\/|$)/;

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
    return loadPyodide({
      indexURL: INDEX_URL,
      packageBaseUrl: INDEX_URL,
      lockFileContents: bundle.lock,
      createPyodideModule,
      stdout: (text) => captured?.push(text),
      stderr: (text) => captured?.push(text),
    });
  })().catch((err) => {
    runtime = null;
    throw err;
  });
  return runtime;
};

function workspaceTree(py, dir = WORKSPACE, out = new Map()) {
  for (const name of py.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const path = `${dir}/${name}`;
    if (SKIPPED.test(path)) continue;
    const { mode } = py.FS.stat(path);
    if (py.FS.isDir(mode)) workspaceTree(py, path, out);
    else if (py.FS.isFile(mode)) out.set(path, py.FS.readFile(path));
  }
  return out;
}

function reconcile(py, paths, put) {
  for (const [path, bytes] of put) {
    py.FS.mkdirTree(parentOf(path));
    py.FS.writeFile(path, bytes);
    mirror.set(path, bytes);
  }
  const wanted = new Set(paths);
  for (const path of [...mirror.keys()]) {
    if (wanted.has(path)) continue;
    py.FS.unlink(path);
    mirror.delete(path);
  }
}

function collect(py) {
  const after = workspaceTree(py);
  const writes = [...after].filter(([path, bytes]) => !(mirror.has(path) && sameBytes(mirror.get(path), bytes)));
  const drops = [...mirror.keys()].filter((path) => !after.has(path));
  mirror = after;
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

async function installMicropip(py) {
  const response = await fetch(PYODIDE_CDN + MICROPIP_WHEEL);
  if (!response.ok) throw new Error(`micropip wheel: HTTP ${response.status}`);
  py.unpackArchive(await response.arrayBuffer(), 'wheel');
}

const handlers = {
  load({ files, lock }) {
    bundle = { files, lock };
    bundledNames = new Set(Object.keys(JSON.parse(lock).packages));
    return null;
  },
  async run({ paths, put, source, filename }) {
    const py = await pythonRuntime();
    py.FS.mkdirTree(WORKSPACE);
    py.FS.chdir(WORKSPACE);
    reconcile(py, paths, put);
    const result = await capture(async () => {
      await py.loadPackagesFromImports(source, { messageCallback: () => {}, errorCallback: (text) => captured?.push(text) });
      py.runPython(source, { filename });
    });
    return { ...result, ...collect(py) };
  },
  async install({ names }) {
    const py = await pythonRuntime();
    const pinned = names.find((name) => bundledNames.has(normalizeName(name)));
    if (pinned) throw new Error(`pip install: ${pinned} is part of the Pyodide package set, so it cannot be installed in-page`);
    micropipLoaded ??= installMicropip(py).catch((err) => {
      micropipLoaded = null;
      throw err;
    });
    await micropipLoaded;
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
