import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';
import { pythonBundle, pythonBundleReady } from './python-bundle.js';

const WORKSPACE = '/workspace';
const SKIPPED = /^\/workspace\/\.(thebird|git)(\/|$)/;
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CANCELLED = 'cancelled';
const PIP_USAGE = 'usage: pip install <package>...\n       pip --version\n       pip --help';

let worker = null;
let nextId = 0;
const pending = new Map();
const known = new Map();
let synced = 0;
let phaseSink = () => {};

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const inWorkspace = (path) => path.startsWith(`${WORKSPACE}/`) && !SKIPPED.test(path);
const isFile = (path) => fs.lstatSync(path, { throwIfNoEntry: false })?.isFile() === true;

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
    if (!pythonBundleReady()) phaseSink('loading');
    const bundle = await pythonBundle({ signal });
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
  synced = 0;
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

function outbound() {
  const full = synced === 0;
  const candidates = (full ? fs.listFiles() : fs.changedSince(synced)).filter(inWorkspace);
  const put = [];
  const drops = [];
  for (const path of candidates) {
    if (isFile(path)) {
      const bytes = fs.readFileSync(path);
      if (!known.has(path) || !sameBytes(known.get(path), bytes)) put.push([path, bytes]);
      known.set(path, bytes);
    } else if (known.delete(path)) {
      drops.push(path);
    }
  }
  synced = fs.currentRevision();
  return { put, drops, keep: full ? candidates : null };
}

function inbound(writes, drops) {
  for (const [path, bytes] of writes) {
    if (SKIPPED.test(path)) continue;
    fs.mkdirSync(parentOf(path), { recursive: true });
    fs.writeFileSync(path, bytes);
    known.set(path, bytes);
  }
  for (const path of drops) {
    if (SKIPPED.test(path)) continue;
    fs.rmSync(path, { force: true });
    known.delete(path);
  }
}

async function runPython(payload, signal) {
  const { put, drops, keep } = outbound();
  let reply;
  try {
    reply = await request('run', { ...payload, put, drops, keep }, signal);
  } catch (err) {
    known.clear();
    synced = 0;
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

export class UsageError extends Error {
  exitCode = 2;
}

export async function pipBuiltin(argv, signal) {
  const [verb, ...names] = argv;
  if (verb === undefined) throw new UsageError(PIP_USAGE);
  if (verb === '--help' || verb === '-h' || verb === 'help') return PIP_USAGE;
  if (verb === '--version' || verb === '-V') return `pip ${finish(await request('version', {}, signal)).trim()} (micropip, in-page)`;
  if (verb !== 'install') throw new UsageError(`unknown command '${verb}'\n${PIP_USAGE}`);
  if (names.length === 0) throw new UsageError(`install needs at least one package name\n${PIP_USAGE}`);
  const bad = names.find((name) => !PACKAGE_NAME.test(name));
  if (bad) throw new UsageError(`${bad} is not a package name (version specifiers and URLs are not supported)`);
  return finish(await request('install', { names }, signal));
}
