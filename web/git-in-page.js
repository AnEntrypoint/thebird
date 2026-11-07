import { Buffer } from './shims/buffer.js';
import * as fsp from './shims/fs-promises.js';
import { runCommitGate } from './commit-gate.js';

const DIR = '/workspace';
const fs = { promises: fsp };
const MAX_DIFF_CELLS = 4000000;
const AUTHOR = { name: 'lanmower', email: 'almagestfraternite@gmail.com' };

let library;
const isomorphic = async () => {
  library ??= (await import('./vendor/isomorphic-git.mjs')).default;
  return library;
};

const ignored = (path) => /^\.thebird(\/|$)/.test(path);
const rows = async () => (await isomorphic()).statusMatrix({ fs, dir: DIR, filter: (path) => !ignored(path) });
const valueOf = (args, flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

function shortStatus([path, head, workdir, stage]) {
  if (head === 0 && stage === 0 && workdir === 2) return `?? ${path}`;
  const x = head === stage ? ' ' : stage === 0 ? 'D' : head === 0 ? 'A' : 'M';
  const y = workdir === stage ? ' ' : workdir === 0 ? 'D' : 'M';
  if (x === ' ' && y === ' ') return null;
  return `${x}${y} ${path}`;
}

async function status() {
  const lib = await isomorphic();
  const branch = await lib.currentBranch({ fs, dir: DIR });
  const lines = (await rows()).map(shortStatus).filter(Boolean);
  return [`## ${branch ?? 'HEAD (no branch)'}`, ...lines].join('\n');
}

async function log(count = 20) {
  let commits;
  try {
    commits = await (await isomorphic()).log({ fs, dir: DIR, depth: Math.max(1, Number(count) || 20) });
  } catch (err) {
    if (err.code === 'NotFoundError') throw new Error('no commits yet');
    throw err;
  }
  return commits.map(({ oid, commit }) => `${oid.slice(0, 7)} ${commit.message.split('\n')[0]}`).join('\n');
}

function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_DIFF_CELLS) return [...a.map((line) => '-' + line), ...b.map((line) => '+' + line)];
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) out.push('-' + a[i++]);
    else out.push('+' + b[j++]);
  }
  while (i < a.length) out.push('-' + a[i++]);
  while (j < b.length) out.push('+' + b[j++]);
  return out;
}

async function diff() {
  const lib = await isomorphic();
  const headOid = await lib.resolveRef({ fs, dir: DIR, ref: 'HEAD' });
  const sections = [];
  for (const [path, head, workdir] of await rows()) {
    if (head === 0 || workdir === head) continue;
    const { blob } = await lib.readBlob({ fs, dir: DIR, oid: headOid, filepath: path });
    const before = Buffer.from(blob).toString('utf8');
    const after = workdir === 0 ? '' : await fsp.readFile(`${DIR}/${path}`, 'utf8');
    const lines = changedLines(before, after);
    if (lines.length === 0) continue;
    sections.push([`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...lines].join('\n'));
  }
  return sections.join('\n');
}

async function add(paths) {
  const lib = await isomorphic();
  const all = paths.length === 0 || paths.includes('.');
  let count = 0;
  for (const [path, , workdir, stage] of await rows()) {
    if (!all && !paths.includes(path)) continue;
    if (workdir === 0 && stage === 0) continue;
    if (workdir === 0) await lib.remove({ fs, dir: DIR, filepath: path });
    else if (workdir !== stage) await lib.add({ fs, dir: DIR, filepath: path });
    else continue;
    count++;
  }
  return `staged ${count} path${count === 1 ? '' : 's'}`;
}

async function init() {
  await (await isomorphic()).init({ fs, dir: DIR });
  return `initialized empty repository in ${DIR}/.git/`;
}

async function commit(message) {
  if (!message) throw new Error('commit needs -m <message>');
  const lib = await isomorphic();
  const gate = await runCommitGate({ lib, fs, dir: DIR, rows: await rows() });
  if (!gate.ok) {
    const failed = gate.checks.filter((item) => !item.ok).map((item) => `${item.name}: ${item.detail}`);
    throw new Error(`commit refused by the in-page gate: ${failed.join('; ')}`);
  }
  const oid = await lib.commit({ fs, dir: DIR, message, author: AUTHOR });
  return [
    ...gate.checks.map((item) => `gate ${item.name}: ${item.detail}`),
    `gate not run in-page: ${gate.notRun.join(', ')}`,
    `committed ${oid.slice(0, 7)}`,
  ].join('\n');
}

const reply = (output) => ({ ok: true, output });
const failure = (error) => ({ ok: false, error });
const verb = (task) => task().then(reply, (err) => failure(err.message));

export const gitVerbs = {
  git_status: () => verb(status),
  git_log: (args) => (args.path === undefined ? verb(() => log(args.count)) : failure('path-limited log needs the relay (?engine=relay)')),
  git_diff: (args) => (args.staged || args.paths ? failure('staged and path-limited diffs need the relay (?engine=relay)') : verb(diff)),
  git_add: (args) => (args.paths?.length ? verb(() => add(args.paths)) : failure('git_add needs explicit paths in the browser shell')),
  git_commit: (args) => {
    if (args.paths?.length) return failure('in-page commit commits the whole index: stage with git_add and omit paths');
    if (args.author !== undefined) return failure('in-page commits are authored lanmower; omit author');
    return verb(() => commit(args.message));
  },
};

export async function gitBuiltin(argv) {
  const [sub, ...rest] = argv;
  const tasks = {
    '--version': async () => `git version ${(await isomorphic()).version()} (in-page, isomorphic-git)`,
    init: () => init(),
    status: () => status(),
    log: () => log(valueOf(rest, '-n')),
    diff: () => diff(),
    add: () => add(rest),
    commit: () => commit(valueOf(rest, '-m')),
  };
  const task = tasks[sub];
  if (!task) throw new Error(`git ${sub ?? ''}: the in-page shell supports init, status, log, diff, add and commit; push, fetch, branch and checkout need the relay`);
  return task();
}
