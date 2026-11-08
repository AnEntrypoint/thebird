const WORKSPACE = '/workspace';
const PYODIDE_DIR = new URL('./vendor/pyodide/', import.meta.url).href;
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const MICROPIP_WHEEL = 'micropip-0.11.1-py3-none-any.whl';
const SKIPPED = /^\/workspace\/\.(thebird|git)(\/|$)/;

let runtime;
let captured = null;
let mirror = new Map();
let micropipLoaded = null;
let bundledLock = null;

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const normalizeName = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

const pythonRuntime = () => {
  runtime ??= (async () => {
    const { loadPyodide } = await import(`${PYODIDE_DIR}pyodide.mjs`);
    return loadPyodide({
      indexURL: PYODIDE_DIR,
      stdout: (text) => captured?.push(text),
      stderr: (text) => captured?.push(text),
    });
  })();
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

async function bundledNames() {
  bundledLock ??= fetch(`${PYODIDE_DIR}pyodide-lock.json`).then((response) => response.json()).then((lock) => new Set(Object.keys(lock.packages))).catch((err) => {
    bundledLock = null;
    throw err;
  });
  return bundledLock;
}

const handlers = {
  async run({ paths, put, source, filename }) {
    const py = await pythonRuntime();
    py.FS.mkdirTree(WORKSPACE);
    py.FS.chdir(WORKSPACE);
    reconcile(py, paths, put);
    const result = await capture(() => py.runPython(source, { filename }));
    return { ...result, ...collect(py) };
  },
  async install({ names }) {
    const py = await pythonRuntime();
    const bundled = await bundledNames();
    const pinned = names.find((name) => bundled.has(normalizeName(name)));
    if (pinned) throw new Error(`pip install: ${pinned} is part of the Pyodide package set, which is not vendored, so it cannot be installed in-page`);
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
