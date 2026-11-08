import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';
import { pythonBundle } from './python-bundle.js';

const WORKSPACE = '/workspace';
const SKIPPED = /^\/workspace\/\.(thebird|git)(\/|$)/;
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CANCELLED = 'cancelled';

let worker = null;
let nextId = 0;
const pending = new Map();
const known = new Map();
const knownRevision = new Map();
let phaseSink = () => {};

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

export function onPythonPhase(sink) {
  phaseSink = sink;
}

function spawn(bundle) {
  if (worker) return worker;
  worker = new Worker(new URL('./python-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(new Error(data.error));
  };
  worker.onerror = (event) => stop(new Error(event.message || 'python worker failed'));
  worker.postMessage({ id: 0, op: 'load', files: bundle.files, lock: bundle.lock });
  return worker;
}

async function bundleFor(signal) {
  try {
    const bundle = await pythonBundle({ signal, onStart: () => phaseSink('loading') });
    phaseSink('done');
    return bundle;
  } catch (err) {
    phaseSink(signal?.aborted ? 'done' : 'failed', err.message);
    if (signal?.aborted) throw new Error(CANCELLED);
    throw err;
  }
}

function stop(reason) {
  worker?.terminate();
  worker = null;
  known.clear();
  knownRevision.clear();
  for (const call of pending.values()) call.reject(reason);
  pending.clear();
}

async function request(op, payload, signal) {
  if (signal?.aborted) throw new Error(CANCELLED);
  const bundle = await bundleFor(signal);
  if (signal?.aborted) throw new Error(CANCELLED);
  const target = spawn(bundle);
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onAbort = () => stop(new Error(CANCELLED));
    const settle = (done) => (value) => {
      signal?.removeEventListener('abort', onAbort);
      done(value);
    };
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    signal?.addEventListener('abort', onAbort, { once: true });
    target.postMessage({ id, op, ...payload });
  });
}

function shimPaths(dir = WORKSPACE, out = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (SKIPPED.test(path)) continue;
    if (entry.isDirectory()) shimPaths(path, out);
    else if (entry.isFile()) out.add(path);
  }
  return out;
}

function outbound() {
  const paths = shimPaths();
  const put = [];
  for (const path of paths) {
    const revision = fs.revisionOf(path);
    if (knownRevision.get(path) === revision) continue;
    const bytes = fs.readFileSync(path);
    if (!known.has(path) || !sameBytes(known.get(path), bytes)) put.push([path, bytes]);
    known.set(path, bytes);
    knownRevision.set(path, revision);
  }
  for (const path of [...known.keys()]) {
    if (paths.has(path)) continue;
    known.delete(path);
    knownRevision.delete(path);
  }
  return { paths: [...paths], put };
}

function inbound(writes, drops) {
  for (const [path, bytes] of writes) {
    if (SKIPPED.test(path)) continue;
    fs.mkdirSync(parentOf(path), { recursive: true });
    fs.writeFileSync(path, bytes);
    known.set(path, bytes);
    knownRevision.set(path, fs.revisionOf(path));
  }
  for (const path of drops) {
    if (SKIPPED.test(path)) continue;
    fs.rmSync(path, { force: true });
    known.delete(path);
    knownRevision.delete(path);
  }
}

async function runPython(payload, signal) {
  const { paths, put } = outbound();
  let reply;
  try {
    reply = await request('run', { ...payload, paths, put }, signal);
  } catch (err) {
    known.clear();
    knownRevision.clear();
    throw err;
  }
  inbound(reply.writes, reply.drops);
  return reply;
}

function finish({ output, error }) {
  if (error === null) return output;
  throw new Error([output, error].filter(Boolean).join('\n').replace(/https?:\/\//g, ''));
}

export async function pythonBuiltin(argv, signal) {
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
  return finish(await runPython({ source, filename }, signal));
}

export async function pipBuiltin(argv, signal) {
  const [verb, ...names] = argv;
  if (verb !== 'install' || names.length === 0) throw new Error('pip install <package>...');
  const bad = names.find((name) => !PACKAGE_NAME.test(name));
  if (bad) throw new Error(`pip install: ${bad} is not a package name (version specifiers and URLs are not supported)`);
  return finish(await request('install', { names }, signal));
}
