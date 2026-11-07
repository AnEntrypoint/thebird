import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../src/runner.js';
import { createApi, joinPath } from '../src/api.js';
import { createThebird } from '../src/index.js';

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

process.on('exit', () => rmSync(ws, { recursive: true, force: true }));
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
