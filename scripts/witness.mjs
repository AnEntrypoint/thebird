import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../src/runner.js';
import { createApi, joinPath } from '../src/api.js';
import { createThebird } from '../src/index.js';
import { startRelay } from '../src/relay.js';
import { remoteClient } from '../src/gm-remote.js';
import { runTerminal } from './browser-driver.mjs';
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
  const shell = await terminal([['run', 'shell echo in-page']]);
  check('in-page shell reports ENOSYS instead of crashing', shell.out.includes('ENOSYS'), shell.out.split('\n')[1]?.slice(0, 120));
  const callers = await terminal([['run', 'gm write_file {"path":"notes/app.js","content":"function foo(){return 1}\\nfunction bar(){return foo()}\\n"}'], ['run', 'gm callers {"name":"foo"}']]);
  check('after: callers runs in-page with vendored acorn and an OPFS file listing', callers.engine === 'ready' && callers.out.includes('notes/app.js:2 [direct]'), callers.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  rmSync(profile, { recursive: true, force: true });
} else {
  console.log('SKIP browser checks — no Chromium at ' + chrome + ' (set CHROME_BIN)');
}
await relay.close();
process.on('exit', () => rmSync(relayWs, { recursive: true, force: true }));
process.on('exit', () => rmSync(ws, { recursive: true, force: true }));
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
