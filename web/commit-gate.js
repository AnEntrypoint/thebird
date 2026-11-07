import { parse } from './vendor/acorn.mjs';
import * as fsp from './shims/fs-promises.js';
import { createHash } from './shims/crypto.js';

const SOURCE = /\.(?:mjs|js|cjs)$/;
const SOURCE_NAME = /^[0-9a-f]{12}\.txt$/;
const REGISTRY = 'index.jsonl';
const DOCS = ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'DESIGN.md'];
const BINARY_PROBE = 8000;
const SMOKE_DIR = '.thebird/gate-smoke';
const SMOKE_TEXT = 'gate smoke\n';
const SMOKE_OID = 'd3a9ff9b9a59ac94d87b5d90d53453586a75e58a';

export const NOT_RUN = ['wiki', 'skills', 'connect', 'workers', 'prompt', 'KEEP', 'gm agent smoke run and its negative control'];
export const NOT_COVERED = [
  'semantic correctness: the gate parses the code and does not judge what the change means',
  'behaviour: the in-page smoke is a file and git object round trip, not a gm agent run, so it has no negative control of gm behaviour',
  'doc content beyond path existence: the docs check finds repo paths, not whether a claim is true',
  '.js files parse as ES modules; a CommonJS-only construct that is not valid in a module is refused, and node --check on the relay side may differ',
  'wiki, skills, connect, workers, prompt and KEEP need Node: they read gm-owned tool lists, text, constants, or child processes, and a copy here would drift from gm',
];

const check = (name, ok, detail) => ({ name, ok, detail });

const isRepoPath = (token, tops) => {
  if (token.includes('<') || token.includes('*') || token.includes('://') || token.includes('=') || token.startsWith('/')) return false;
  if (token.includes('/') === false) return false;
  return tops.has(token.split('/')[0]);
};

async function committedBytes(lib, fs, dir, rows) {
  const headOid = await lib.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
  const files = [];
  for (const [path, , , stage] of rows) {
    if (stage === 2) files.push({ path, bytes: await fsp.readFile(`${dir}/${path}`) });
    else if (stage === 1 && headOid) files.push({ path, bytes: (await lib.readBlob({ fs, dir, oid: headOid, filepath: path })).blob });
  }
  return files;
}

function sourcesCheck(files) {
  const entries = files.filter(({ path }) => /^sources\/[^/]+$/.test(path));
  if (entries.length === 0) return check('sources', true, 'no sources archived');
  const bad = [];
  let count = 0;
  for (const { path, bytes } of entries) {
    const name = path.slice('sources/'.length);
    if (name === REGISTRY) {
      const lines = new TextDecoder().decode(bytes).split('\n').filter(Boolean);
      if (lines.some((line) => !isJson(line))) bad.push(`sources/${REGISTRY} has a line that is not JSON`);
      continue;
    }
    if (!SOURCE_NAME.test(name)) {
      bad.push(`${path} is not a source name`);
      continue;
    }
    count += 1;
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    if (`${id}.txt` !== name) bad.push(`${path} has the hash of ${id}`);
  }
  return check('sources', bad.length === 0, bad.length ? bad.join(' | ') : `${count} sources match their names`);
}

const isJson = (line) => {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
};

async function smoke(lib, fs, dir) {
  const root = `${dir}/${SMOKE_DIR}`;
  const file = `${root}/probe.txt`;
  await fsp.mkdir(root, { recursive: true });
  try {
    await fsp.writeFile(file, SMOKE_TEXT);
    const back = await fsp.readFile(file, 'utf8');
    const { oid } = await lib.hashBlob({ object: SMOKE_TEXT });
    const { oid: changed } = await lib.hashBlob({ object: 'changed\n' });
    const ok = back === SMOKE_TEXT && oid === SMOKE_OID && changed !== SMOKE_OID;
    return check('smoke', ok, ok ? 'file round trip matches and the git blob hash matches git; a changed payload hashes differently' : `round trip ${back === SMOKE_TEXT}, blob hash ${oid}`);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

export async function runCommitGate({ lib, fs, dir, rows }) {
  const checks = [];
  const stale = rows.filter(([, , , stage]) => stage === 3).map(([path]) => path);
  checks.push(check('index', stale.length === 0, stale.length ? `re-add ${stale.join(', ')}: the staged copy differs from the working tree` : 'every staged file matches the working tree'));
  const staged = rows.filter(([, head, , stage]) => (head === 1 ? stage !== 1 : stage !== 0));
  checks.push(check('staged', staged.length > 0, staged.length ? `${staged.length} changed path${staged.length === 1 ? '' : 's'} staged` : 'nothing staged'));

  const files = await committedBytes(lib, fs, dir, rows);

  const syntaxErrors = [];
  let modules = 0;
  for (const { path, bytes } of files) {
    if (!SOURCE.test(path)) continue;
    modules += 1;
    try {
      parse(new TextDecoder().decode(bytes), { ecmaVersion: 'latest', sourceType: path.endsWith('.cjs') ? 'script' : 'module' });
    } catch (err) {
      syntaxErrors.push(`${path}: ${err.message}`);
    }
  }
  checks.push(check('syntax', syntaxErrors.length === 0, syntaxErrors.length ? `syntax errors in ${syntaxErrors.join('; ')}` : `${modules} modules parse`));

  const nonAscii = [];
  let text = 0;
  for (const { path, bytes } of files) {
    if (bytes.subarray(0, BINARY_PROBE).includes(0)) continue;
    text += 1;
    if (bytes.some((byte) => byte > 0x7f)) nonAscii.push(path);
  }
  checks.push(check('ascii', nonAscii.length === 0, nonAscii.length ? `non-ASCII in ${nonAscii.join(', ')}` : `${text} text files are ASCII`));

  const committed = new Set(files.map(({ path }) => path));
  const tops = new Set([...committed].map((path) => path.split('/')[0]));
  const missing = [];
  let paths = 0;
  for (const doc of DOCS) {
    const file = files.find(({ path }) => path === doc);
    if (!file) {
      missing.push(`${doc} is not in the commit`);
      continue;
    }
    for (const match of new TextDecoder().decode(file.bytes).matchAll(/`([^`\s]+)`/g)) {
      const token = match[1].replace(/:\d+(?::\d+)?$/, '');
      if (!isRepoPath(token, tops)) continue;
      paths += 1;
      const exists = token.endsWith('/') ? [...committed].some((path) => path.startsWith(token)) : committed.has(token);
      if (!exists) missing.push(`${doc}: ${token}`);
    }
  }
  checks.push(check('docs', missing.length === 0, missing.length ? `missing: ${missing.join(' | ')}` : `${paths} repo paths in the docs exist`));

  checks.push(sourcesCheck(files));
  checks.push(await smoke(lib, fs, dir));

  return { ok: checks.every((item) => item.ok), checks, notRun: NOT_RUN, notCovered: NOT_COVERED };
}
