import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../src/runner.js';
import { createApi, joinPath } from '../src/api.js';
import { createThebird } from '../src/index.js';
import { startRelay } from '../src/relay.js';
import { remoteClient } from '../src/gm-remote.js';
import { runTerminal } from './browser-driver.mjs';
import { vendorBashkit } from './vendor-bashkit.mjs';
import { vendorPyodide } from './vendor-pyodide.mjs';
import { existsSync as fileExists } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin', 'thebird.js');
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function runCli(args, input) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', input, timeout: 60000 });
}

const help = runCli(['help']);
check('help exits 0 and lists commands', help.status === 0 && help.stdout.includes('gm <verb>'));

const shell = runCli(['shell', 'echo witness-ok']);
check('shell runs through gm', shell.status === 0 && shell.stdout.includes('witness-ok'), `exit ${shell.status}`);

const json = runCli(['gm', 'list_dir', '{"path":".","limit":2}']);
check('gm JSON arguments are honoured', json.status === 0 && json.stdout.trim().split('\n').length === 2, `exit ${json.status}`);

const memory = runCli(['memory', 'delete', 'k']);
check('unmapped memory action fails with exit 1', memory.status === 1 && memory.stderr.includes('not mapped'), `exit ${memory.status}`);

const ws = mkdtempSync(join(tmpdir(), 'thebird-witness-'));
const written = runCli(['--workspace', ws, 'memory', 'write', 'cli-note', 'hello from the cli']);
const cliFound = written.status === 0 && existsSync(join(ws, 'wiki', 'cli-note.md'));
check('memory write through the CLI writes a wiki page', cliFound, `exit ${written.status}`);

const repl = runCli(['-i'], 'gm list_dir {"path":".","limit":1}\nexit\n');
check('REPL accepts raw JSON arguments', repl.status === 0 && /thebird> \S/.test(repl.stdout) && !repl.stdout.includes('error:'), `exit ${repl.status}`);

const calls = [];
const api = new Proxy({}, {
  get: (_, name) => async (...args) => {
    calls.push([String(name), args]);
    return { ok: true, output: String(name) };
  },
});
const run = createRunner(api);
await run('read "my file.txt" 0 20');
await run('gm list_dir {"path":".","limit":10}');
check('runner keeps quoted paths and JSON arguments', calls[0][1][0].path === 'my file.txt' && calls[1][1][1].limit === 10);
await run('shell sqlite3 app.db "select count(*) from t" \'x y\'');
check('runner passes shell commands to gm with their quotes and parentheses', calls.at(-1)[1][0].command === 'sqlite3 app.db "select count(*) from t" \'x y\'', calls.at(-1)[1][0].command);

const fakeGm = { workspace: '/w', gmHome: '/g', runDir: '/r', call: async (verb, args) => ({ ok: true, verb, args }), close: async () => {} };
const lib = createApi(fakeGm);
check('library maps methods to gm verbs', (await lib.read({ path: 'x' })).verb === 'read_file');
const rejected = await lib.memory('delete', 'k').then(() => false, () => true);
check('library rejects unmapped memory actions', rejected);
const tb = await createThebird({ workspace: ws });
await tb.memory('write', 'house-rule', 'Keep the bird quiet near the lake');
const sourceBody = asciiBody('Keep the bird quiet near the lake');
const sourceId = createHash('sha256').update(sourceBody).digest('hex').slice(0, 12);
check('memory write stores the value as a gm source named by its hash', existsSync(join(ws, 'sources', sourceId + '.txt')) && readFileSync(join(ws, 'sources', sourceId + '.txt'), 'utf8') === sourceBody);
const page = readFileSync(join(ws, 'wiki', 'house-rule.md'), 'utf8');
check('memory write creates a wiki page that cites the source', page.includes(`"${sourceId}"`) && page.includes('Keep the bird quiet near the lake'));
const hit = await tb.memory('search', 'house-rule');
check('memory search finds the written page', String(hit.output ?? '').includes('house-rule'));
await tb.close();
check('memory write leaves the source hash-named', readdirSync(join(ws, 'sources')).every((name) => createHash('sha256').update(readFileSync(join(ws, 'sources', name), 'utf8')).digest('hex').startsWith(name.slice(0, 12))));
function asciiBody(text) {
  return text.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

check('joinPath resolves like path.resolve', joinPath('/a/b', '../c') === '/a/c' && joinPath('/a/b', '/etc/x') === '/etc/x');

const relayWs = mkdtempSync(join(tmpdir(), 'thebird-relay-'));
const relay = await startRelay({ workspace: relayWs });
const remote = await remoteClient({ url: relay.url });
const remoteRun = createRunner(createApi(remote));
check('relay serves a remote gm client', remote.workspace === relayWs);
check('remote shell runs through the relay', (await remoteRun('shell echo relay-ok')).includes('relay-ok'));
check('relay serves the browser terminal page', (await fetch(relay.url)).status === 200);
check('relay serves src and web files', (await fetch(relay.url + 'src/runner.js')).status === 200 && (await fetch(relay.url + 'web/terminal.js')).status === 200);
check('relay refuses paths outside src and web', (await fetch(relay.url + 'web//etc/passwd')).status === 404 && (await fetch(relay.url + 'src/../package.json')).status === 404);
check('relay rejects malformed call bodies', (await fetch(relay.url + 'call', { method: 'POST', body: '{nope' })).status === 400);

const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
if (fileExists(chrome)) {
  if (!fileExists(join(root, 'web', 'vendor', 'bashkit', 'bashkit_wasm_bg.wasm'))) await vendorBashkit();
  if (!fileExists(join(root, 'web', 'vendor', 'pyodide', 'pyodide.asm.wasm'))) await vendorPyodide();
  const profile = mkdtempSync(join(tmpdir(), 'thebird-profile-'));
  const terminal = (pairs, options = {}) => runTerminal({ chrome, profile, url: relay.url + '?' + new URLSearchParams(pairs).toString(), ...options });
  const relayTerminal = await terminal([['engine', 'relay'], ['run', 'help'], ['run', 'shell echo browser-ok']]);
  check('browser terminal runs shell through the relay in headless Chromium', relayTerminal.engine === 'ready' && relayTerminal.out.includes('browser-ok'));
  const before = await terminal([['gm', 'raw'], ['run', 'ls .']]);
  check('before: raw gm cannot load in the browser worker', before.engine === 'failed' && before.out.includes('gm-raw/tools.mjs'), before.out.split('\n')[0].slice(0, 140));
  const after = await terminal([['run', 'write notes/a.txt opfs-hello'], ['run', 'ls .']]);
  check('after: in-page gm writes and lists files over OPFS', after.engine === 'ready' && after.out.includes('wrote notes/a.txt') && after.out.includes('notes/'), after.out.split('\n').slice(0, 3).join(' / ').slice(0, 140));
  const reloaded = await terminal([['run', 'read notes/a.txt']]);
  check('after: the OPFS file survives a browser restart', reloaded.engine === 'ready' && reloaded.out.includes('opfs-hello'));
  const script = await terminal([['run', 'shell cat notes/a.txt | tr a-z A-Z > notes/upper.txt && cat notes/upper.txt']]);
  check('in-page bash runs a script over the OPFS tree', script.out.includes('OPFS-HELLO'), script.out.split('\n').slice(-2).join(' / ').slice(0, 120));
  const host = await terminal([['run', 'shell node -v']]);
  check('in-page bash reports host tools it lacks as exit 127', host.out.includes('node: command not found'));
  const repo = await terminal([
    ['run', 'shell mkdir -p notes'],
    ['run', 'shell git init'],
    ['run', 'shell echo one > notes/a.txt'],
    ['run', 'shell echo readme > README.md'],
    ['run', 'shell echo agents > AGENTS.md'],
    ['run', 'shell echo arch > ARCHITECTURE.md'],
    ['run', 'shell git add notes/a.txt README.md AGENTS.md ARCHITECTURE.md'],
    ['run', 'shell git commit -m first'],
    ['run', 'shell echo design > DESIGN.md'],
    ['run', 'shell git add DESIGN.md'],
    ['run', 'shell git commit -m first'],
    ['run', 'shell git log'],
  ]);
  check('in-page git commit without DESIGN.md is refused and names it', repo.out.includes('commit refused by the in-page gate') && repo.out.includes('DESIGN.md is not in the commit'), repo.out.split('\n').find((line) => line.includes('DESIGN.md is not in the commit'))?.slice(0, 160) ?? 'no refusal line');
  check('in-page git inits and stages over OPFS', repo.engine === 'ready' && repo.out.includes('initialized empty repository') && repo.out.includes('staged 1 path'), repo.out.split('\n').slice(0, 3).join(' / ').slice(0, 140));
  const committedSha = repo.out.match(/committed ([0-9a-f]{7})/)?.[1];
  const headSha = repo.out.match(/^([0-9a-f]{7}) first$/m)?.[1];
  check('in-page git commit runs the gate and sets HEAD', repo.out.includes('gate smoke:') && repo.out.includes('gate syntax:') && repo.out.includes('not run in-page') && committedSha !== undefined && committedSha === headSha, `committed ${committedSha} / log HEAD ${headSha}`);
  const broken = await terminal([
    ['run', 'shell mkdir -p notes'],
    ['run', 'shell git init'],
    ['run', 'shell echo "const =" > notes/bad.js'],
    ['run', 'shell echo café > notes/u.txt'],
    ['run', 'shell git add notes/bad.js notes/u.txt'],
    ['run', 'shell git commit -m broken'],
  ]);
  check('in-page git commit refuses broken syntax and non-ASCII and names both', broken.out.includes('commit refused by the in-page gate') && broken.out.includes('syntax:') && broken.out.includes('ascii:'), broken.out.split('\n').find((line) => line.includes('refused by the in-page gate'))?.slice(0, 160) ?? 'no refusal line');
  const job = await terminal([['run', 'job start bg echo x']]);
  check('in-page bash refuses background jobs with a pointer to the relay', job.out.includes('background jobs need the relay'));
  const sqlite = await terminal([
    ['run', 'shell mkdir -p notes'],
    ['run', 'shell sqlite3 notes/app.db "create table t(x)"'],
    ['run', 'shell sqlite3 notes/app.db "insert into t values (1),(2),(3)"'],
    ['run', 'shell sqlite3 notes/app.db "select sum(x) from t"'],
  ]);
  check('in-page sqlite3 creates a database and answers a query through sql.js', sqlite.engine === 'ready' && /^6$/m.test(sqlite.out), sqlite.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const reopened = await terminal([['run', 'shell sqlite3 notes/app.db "select count(*) from t"']]);
  check('in-page sqlite3 database survives a browser restart', /^3$/m.test(reopened.out), reopened.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const python = await terminal([
    ['run', 'shell python3 -c "print(6*7)"'],
    ['run', 'shell python3 -c "1/0"'],
    ['run', 'shell echo py-hello > notes/in.txt'],
    ['run', `shell echo "open('notes/out.txt','w').write(open('notes/in.txt').read().upper())" > notes/script.py`],
    ['run', 'shell python3 notes/script.py'],
    ['run', 'shell cat notes/out.txt'],
  ]);
  check('in-page python3 runs a one-line script through Pyodide', python.engine === 'ready' && /^42$/m.test(python.out), python.out.split('\n').slice(0, 2).join(' / ').slice(0, 140));
  check('in-page python3 reports a traceback as an error', python.out.includes('ZeroDivisionError'), python.out.split('\n').find((line) => line.includes('ZeroDivisionError'))?.slice(0, 140) ?? 'no traceback');
  check('in-page python3 reads and writes files on the OPFS tree', /^PY-HELLO$/m.test(python.out), python.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const pythonReopened = await terminal([['run', 'shell cat notes/out.txt'], ['run', 'shell python3 -c "print(open(\'notes/out.txt\').read().strip())"']]);
  check('in-page python3 files survive a browser restart', pythonReopened.out.split('\n').filter((line) => line === 'PY-HELLO').length >= 2, pythonReopened.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const incremental = await terminal([
    ['run', 'shell echo one > notes/inc.txt'],
    ['run', `shell python3 -c "print(open('notes/inc.txt').read().strip())"`],
    ['run', 'shell echo two > notes/inc.txt'],
    ['run', `shell python3 -c "print(open('notes/inc.txt').read().strip())"`],
    ['run', `shell python3 -c "import os; os.remove('notes/inc.txt')"`],
    ['run', `shell python3 -c "import os; print(os.path.exists('notes/inc.txt'))"`],
    ['run', 'shell echo three > notes/inc.txt'],
    ['run', `shell python3 -c "print(open('notes/inc.txt').read().strip())"`],
  ]);
  const incLines = incremental.out.split('\n');
  check('in-page python3 sees a shell rewrite made after its last call', incLines.includes('one') && incLines.includes('two') && incLines.indexOf('two') > incLines.indexOf('one'), incLines.filter((line) => /^(one|two|three|True|False)$/.test(line)).join(' / '));
  check('in-page python3 removes a file it deletes and the shell sees it gone', incLines.includes('False') && incLines.includes('three'), incLines.filter((line) => /^(one|two|three|True|False)$/.test(line)).join(' / '));
  const warmCalls = Array.from({ length: 30 }, () => 'python3 -c "print(1)"').join('; ');
  const timed = await terminal([
    ['run', 'shell mkdir -p notes/bulk'],
    ['run', `shell python3 -c "[open('notes/bulk/f%d.txt' % i, 'w').write('x' * 200) for i in range(300)]"`],
    ['run', `shell python3 -c "print(0)"; t0=$(date +%s%N); ${warmCalls}; t1=$(date +%s%N); echo $(( (t1 - t0) / 1000000 ))`],
  ]);
  const totalMs = Number(timed.out.split('\n').filter((line) => /^\d+$/.test(line)).pop());
  check('python3 warm calls are timed in-page over 300 files', Number.isFinite(totalMs) && totalMs > 0, `${totalMs} ms for 30 calls`);
  console.log(`python3 sync timing: 300 files, ${(totalMs / 30).toFixed(1)} ms per warm call (30 calls in-page)`);
  const gitRoot = mkdtempSync(join(tmpdir(), 'thebird-git-'));
  process.on('exit', () => rmSync(gitRoot, { recursive: true, force: true }));
  const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=witness', '-c', 'user.email=witness@localhost', ...args], { cwd, encoding: 'utf8' }).trim();
  const remote = join(gitRoot, 'remote.git');
  const seed = join(gitRoot, 'seed');
  const clone = join(gitRoot, 'clone');
  gitIn(gitRoot, 'init', '-q', '--bare', '-b', 'main', remote);
  gitIn(gitRoot, 'init', '-q', '-b', 'main', seed);
  gitIn(seed, 'remote', 'add', 'origin', remote);
  writeFileSync(join(seed, 'README.md'), 'first\n');
  gitIn(seed, 'add', '-A');
  gitIn(seed, 'commit', '-q', '-m', 'first');
  gitIn(seed, 'push', '-q', '-u', 'origin', 'main');
  gitIn(seed, 'checkout', '-q', '-b', 'feature');
  gitIn(seed, 'push', '-q', '-u', 'origin', 'feature');
  gitIn(seed, 'checkout', '-q', 'main');
  gitIn(gitRoot, 'clone', '-q', remote, clone);
  writeFileSync(join(seed, 'README.md'), 'second\n');
  gitIn(seed, 'commit', '-q', '-am', 'second');
  gitIn(seed, 'push', '-q', 'origin', 'main');
  const secondSha = gitIn(seed, 'rev-parse', 'HEAD');
  const gitRelay = await startRelay({ workspace: clone });
  try {
    const pairs = [
      ['engine', 'relay'],
      ['run', 'git branch'],
      ['run', 'git fetch'],
      ['run', 'shell git rev-parse origin/main'],
      ['run', 'git pull'],
      ['run', 'shell git log -1 --format=%s'],
      ['run', 'git checkout feature'],
      ['run', 'shell git branch --show-current'],
      ['run', 'git checkout main'],
      ['run', 'shell git branch --show-current'],
    ];
    const gitState = await runTerminal({ chrome, profile, url: gitRelay.url + '?' + new URLSearchParams(pairs).toString() });
    const lines = gitState.out.split('\n');
    check('relay git branch lists the local and remote feature branch', gitState.engine === 'ready' && lines.some((line) => /^\s*\*?\s*feature$/.test(line)), lines.find((line) => /feature$/.test(line)) ?? 'no branch line');
    check('relay git fetch updates origin/main to the seed commit', gitState.out.includes(secondSha), `expected ${secondSha}`);
    check('relay git pull fast-forwards main to the new commit', lines.some((line) => line === 'second'), lines.find((line) => line.includes('second')) ?? 'no subject line');
    check('relay git checkout switches to feature', lines.some((line) => line === 'feature'), 'no feature line');
    check('relay git checkout switches back to main', lines.some((line) => line === 'main'), 'no main line');
    writeFileSync(join(clone, 'ok.mjs'), 'export const ok = 1;\n');
    gitIn(clone, 'add', 'ok.mjs');
    gitIn(clone, 'commit', '-q', '-m', 'add ok module');
    const goodPush = await runTerminal({ chrome, profile, url: gitRelay.url + '?' + new URLSearchParams([['engine', 'relay'], ['run', 'git push']]).toString() });
    check('relay git push passes the gate and sends main to the remote', gitIn(remote, 'rev-parse', 'main') === gitIn(clone, 'rev-parse', 'HEAD'), goodPush.out.split('\n').slice(-2).join(' / ').slice(0, 140));
    writeFileSync(join(clone, 'bad.mjs'), 'export const = ;\n');
    gitIn(clone, 'add', 'bad.mjs');
    gitIn(clone, 'commit', '-q', '-m', 'add bad module');
    const badHead = gitIn(clone, 'rev-parse', 'HEAD');
    const badPush = await runTerminal({ chrome, profile, url: gitRelay.url + '?' + new URLSearchParams([['engine', 'relay'], ['run', 'git push']]).toString() });
    check('relay git push refuses broken syntax and leaves the remote unchanged', badPush.out.includes('commit gate failed before the push') && badPush.out.includes('syntax:') && gitIn(remote, 'rev-parse', 'main') !== badHead, badPush.out.split('\n').find((line) => line.includes('commit gate')) ?? 'no refusal line');
  } finally {
    await gitRelay.close();
  }
  rmSync(profile, { recursive: true, force: true });
} else {
  console.log('SKIP browser checks — no Chromium at ' + chrome + ' (set CHROME_BIN)');
}
const seeded = await import('../web/shims/fs.js');
const { gitBuiltin } = await import('../web/git-in-page.js');
seeded.mkdirSync('/workspace/notes', { recursive: true });
seeded.writeFileSync('/workspace/notes/a.txt', 'one\n');
for (const doc of ['README.md', 'AGENTS.md', 'ARCHITECTURE.md']) seeded.writeFileSync(`/workspace/${doc}`, `${doc}\n`);
await gitBuiltin(['init']);
await gitBuiltin(['add', 'notes/a.txt', 'README.md', 'AGENTS.md', 'ARCHITECTURE.md']);
const withoutDesign = await gitBuiltin(['commit', '-m', 'first']).then(() => 'committed', (err) => err.message);
check('Node-side in-page commit without DESIGN.md is refused and names it', withoutDesign.includes('DESIGN.md is not in the commit'), withoutDesign.slice(0, 160));
seeded.writeFileSync('/workspace/DESIGN.md', 'DESIGN.md\n');
await gitBuiltin(['add', 'DESIGN.md']);
const committed = await gitBuiltin(['commit', '-m', 'first']);
check('Node-side in-page commit passes the gate and commits as lanmower', committed.includes('gate smoke:') && committed.includes('committed '), committed.split('\n').slice(-1)[0]);
seeded.writeFileSync('/workspace/notes/a.txt', 'two\n');
const status = await gitBuiltin(['status']);
check('git status marks the modified file after a commit', status.includes('M notes/a.txt') && status.includes('## '), status.split('\n').join(' / ').slice(0, 140));
const log = await gitBuiltin(['log']);
check('git log lists the seeded commit', log.includes('first'), log.slice(0, 120));
const diff = await gitBuiltin(['diff']);
check('git diff shows the removed and added lines', diff.includes('-one') && diff.includes('+two'), diff.split('\n').join(' / ').slice(0, 140));
const refused = await gitBuiltin(['commit', '-m', 'second']).then(() => 'committed', (err) => err.message);
check('git commit with nothing staged is refused by the gate', refused.includes('commit refused by the in-page gate') && refused.includes('staged: nothing staged'), refused.slice(0, 160));
const goodSource = `${createHash('sha256').update('good\n').digest('hex').slice(0, 12)}.txt`;
seeded.mkdirSync('/workspace/sources', { recursive: true });
seeded.writeFileSync(`/workspace/sources/${goodSource}`, 'good\n');
seeded.writeFileSync('/workspace/sources/notes.txt', 'bad\n');
await gitBuiltin(['add', `sources/${goodSource}`, 'sources/notes.txt']);
const badSource = await gitBuiltin(['commit', '-m', 'sources']).then(() => 'committed', (err) => err.message);
check('in-page gate refuses a source whose name is not its hash', badSource.includes('sources/notes.txt is not a source name') && badSource.includes('commit refused by the in-page gate'), badSource.slice(0, 160));
seeded.rmSync('/workspace/sources/notes.txt');
await gitBuiltin(['add', 'sources/notes.txt']);
const sourceCommit = await gitBuiltin(['commit', '-m', 'sources']);
check('in-page gate passes sources whose names match their hash', sourceCommit.includes('gate sources: 1 sources match their names') && sourceCommit.includes('committed '), sourceCommit.split('\n').find((line) => line.startsWith('gate sources')) ?? 'no sources line');
await relay.close();
process.on('exit', () => rmSync(relayWs, { recursive: true, force: true }));
process.on('exit', () => rmSync(ws, { recursive: true, force: true }));
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
