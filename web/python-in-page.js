import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';

const WORKSPACE = '/workspace';
const PYODIDE_DIR = '/web/vendor/pyodide/';
const SKIPPED = /^\/workspace\/\.(thebird|git)(\/|$)/;

let runtime;
let captured = null;

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

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));

function shimTree(dir = WORKSPACE, out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (SKIPPED.test(path)) continue;
    if (entry.isDirectory()) shimTree(path, out);
    else if (entry.isFile()) out.set(path, fs.readFileSync(path));
  }
  return out;
}

function pyodideTree(py, dir = WORKSPACE, out = new Map()) {
  for (const name of py.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const path = `${dir}/${name}`;
    if (SKIPPED.test(path)) continue;
    const { mode } = py.FS.stat(path);
    if (py.FS.isDir(mode)) pyodideTree(py, path, out);
    else if (py.FS.isFile(mode)) out.set(path, py.FS.readFile(path));
  }
  return out;
}

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

function copyIn(py, files) {
  py.FS.mkdirTree(WORKSPACE);
  for (const [path, bytes] of files) {
    py.FS.mkdirTree(parentOf(path));
    py.FS.writeFile(path, bytes);
  }
}

function copyBack(before, after) {
  for (const [path, bytes] of after) {
    if (before.has(path) && sameBytes(before.get(path), bytes)) continue;
    fs.mkdirSync(parentOf(path), { recursive: true });
    fs.writeFileSync(path, bytes);
  }
  for (const path of before.keys()) if (!after.has(path)) fs.rmSync(path, { force: true });
}

export async function pythonBuiltin(argv) {
  const [first, ...rest] = argv;
  let source;
  let filename;
  if (first === '-c') {
    if (rest.length === 0) throw new Error('python3 -c <code>');
    source = rest.join(' ');
    filename = '<string>';
  } else if (first) {
    filename = posix.resolve(WORKSPACE, first);
    source = fs.readFileSync(filename, 'utf8');
  } else {
    throw new Error('python3 -c <code> or python3 <file>');
  }
  const py = await pythonRuntime();
  const before = shimTree();
  copyIn(py, before);
  py.FS.chdir(WORKSPACE);
  captured = [];
  let failure = null;
  try {
    py.runPython(source, { filename });
  } catch (err) {
    failure = err;
  }
  copyBack(before, pyodideTree(py));
  const output = captured.join('\n');
  captured = null;
  if (failure) {
    const summary = failure.message.trim().split('\n').pop();
    throw new Error([output, summary].filter(Boolean).join('\n'));
  }
  return output;
}
