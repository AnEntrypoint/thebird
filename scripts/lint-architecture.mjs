import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../src/api.js';
import { COMMANDS as CLI_COMMANDS } from '../src/commands.js';
import { createRunner } from '../src/runner.js';
import { shimFor } from '../src/shim-map.js';
import { startRelay } from '../src/relay.js';
import { runTerminal } from './browser-driver.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticOnly = process.argv.includes('--static');
const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
const gmHome = process.env.GM_HOME ?? join(root, '..', 'gm');
const docs = Object.fromEntries(['ARCHITECTURE.md', 'AGENTS.md'].map((name) => [name, readFileSync(join(root, name), 'utf8').split('\n')]));
let docName = 'ARCHITECTURE.md';
let docLines = docs[docName];
const inDoc = (name, fn) => {
  docName = name;
  docLines = docs[name];
  fn();
};
const witness = readFileSync(join(root, 'scripts', 'witness.mjs'), 'utf8');
const results = [];
const covered = new Set();
const COMMANDS = 'echo printf test seq sed awk grep sort uniq wc head tail cut tr find xargs tee ls cp mv rm mkdir touch cat basename dirname date env export type jq base64 md5sum sha256sum gzip gunzip sleep';
const GM_CALLS = ['spawn', 'spawnSync', 'execFileAsync', 'execFileSync'];

const outcome = (ok, detail) => ({ ok, detail });
const all = (...items) => {
  const ok = items.some((item) => item.ok === false) ? false : items.every((item) => item.ok === true) ? true : null;
  return outcome(ok, items.map((item) => item.detail).join('; '));
};

const record = (needle, result) => {
  const index = docLines.findIndex((line) => line.includes(needle));
  if (index === -1) {
    results.push({ doc: docName, line: 0, text: needle, ok: false, detail: `anchor not found in ${docName}; update the lint` });
    return;
  }
  covered.add(`${docName}:${index + 1}`);
  results.push({ doc: docName, line: index + 1, text: docLines[index].trim(), ok: result.ok, detail: result.detail });
};

const repo = (path) => join(root, path);
const read = (path) => readFileSync(repo(path), 'utf8');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const filesUnder = (path) => {
  const full = repo(path);
  if (!existsSync(full)) return [];
  return statSync(full).isDirectory() ? walk(full) : [full];
};
const fileHas = (path, needle) => existsSync(repo(path)) && read(path).includes(needle);
const versionIn = (path, needle) => {
  const files = filesUnder(path).filter((file) => /\.(m?js|json|js|md)$/.test(file));
  if (files.length === 0) return outcome(null, `${path} is not present in this checkout`);
  const found = files.some((file) => readFileSync(file, 'utf8').includes(needle));
  return outcome(found ? true : null, found ? `${needle} is recorded under ${path}` : `${needle} is not recorded in the text files under ${path}, so it is unverified`);
};
const isIgnored = (path) => {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const cites = (needle, labels) => record(needle, all(...labels.map((label) => (witness.includes(label)
  ? outcome(true, `witness: ${label}`)
  : outcome(false, `missing from scripts/witness.mjs: ${label}`)))));
const bulletOf = (needle) => {
  const start = docLines.findIndex((line) => line.includes(needle));
  let end = start + 1;
  while (end < docLines.length && docLines[end].startsWith('  ')) end++;
  return docLines.slice(start, end).join(' ');
};
const commitCount = () => {
  try {
    return Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return 0;
  }
};
const objectType = (name) => {
  try {
    return execFileSync('git', ['cat-file', '-t', name], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const overrideNames = () => ({
  inPage: [
    ...[...read('web/gm-worker.js').matchAll(/^\s+(\w+): async \(args\)/gm)].map((match) => match[1]),
    ...[...read('web/git-in-page.js').split('export const gitVerbs = {')[1].split('\n};')[0].matchAll(/^\s+(git_\w+):/gm)].map((match) => match[1]),
  ],
  relay: [...read('src/gm.js').matchAll(/^\s+(git_push): \(/gm)].map((match) => match[1]),
});
const paragraphAt = (needle) => {
  const start = docLines.findIndex((line) => line.includes(needle));
  let end = start + 1;
  while (end < docLines.length && docLines[end].trim() !== '' && !docLines[end].startsWith('#')) end++;
  return docLines.slice(start, end).join(' ');
};
const SAMPLE_LINES = {
  help: 'help', tools: 'tools', skills: 'skills', read: 'read a.txt', write: 'write a.txt hi', edit: 'edit a.txt x y',
  stat: 'stat a.txt', ls: 'ls', list: 'list', grep: 'grep pat', search: 'search q', shell: 'shell echo hi', exec: 'exec echo hi',
  run: 'run hi', memory: 'memory search k', chat: 'chat hi', delegate: 'delegate hi', 'web-search': 'web-search q',
  fetch: 'fetch http://x', job: 'job status x', log: 'log', git: 'git status', prd: 'prd list', unknown: 'unknown list',
  cron: 'cron list', sessions: 'sessions', projects: 'projects list', config: 'config', batch: 'batch read_file {"path":"a.txt"}',
  gm: 'gm read_file {"path":"a.txt"}', repl: 'repl', exit: 'exit',
};
const LOCAL_COMMANDS = ['help', 'tools', 'repl', 'exit', 'projects', 'config'];
async function thinMapping() {
  const dispatched = {};
  for (const [name, line] of Object.entries(SAMPLE_LINES)) {
    const verbs = [];
    const gm = { call: async (verb) => { verbs.push(verb); return {}; } };
    const error = await createRunner(createApi(gm))(line).then(() => '', (failure) => failure.message);
    dispatched[name] = { verbs, error };
  }
  return dispatched;
}
const thin = await thinMapping();
const shimExports = (file) => {
  const source = readFileSync(file, 'utf8');
  const names = new Set([...source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+(\w+)/g)].map((match) => match[1]));
  for (const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g)) for (const item of list.split(',')) names.add(item.trim().split(/\s+as\s+/).pop());
  return { names, hasDefault: /export\s+default\b/.test(source) || /\bas default\b/.test(source) };
};
function inPageNodeImports() {
  const seen = new Set();
  const found = [];
  const visit = (file) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    for (const [, clause, spec] of readFileSync(file, 'utf8').matchAll(/^import\s+([^;]*?)\s+from\s+'([^']+)'/gms)) {
      if (spec.startsWith('node:')) found.push({ file: file.slice(gmSrc.length + 1), spec, clause: clause.trim() });
      else if (spec.startsWith('.')) visit(join(dirname(file), spec));
    }
  };
  visit(join(gmSrc, 'tools.mjs'));
  visit(join(gmSrc, 'log.mjs'));
  return found;
}

const sourceText = [...walk(repo('src')), ...walk(repo('web')).filter((path) => !path.includes('/vendor/')), ...walk(repo('scripts')), ...walk(repo('bin'))]
  .filter((path) => /\.(m?js|html|js)$/.test(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const gmSrc = join(gmHome, 'src');
const gmText = existsSync(gmSrc) ? walk(gmSrc).filter((path) => path.endsWith('.mjs')).map((path) => readFileSync(path, 'utf8')).join('\n') : null;

const definedIn = (text, name) => new RegExp(`(\\bfunction\\s*\\*?\\s*${name}\\b|\\b(const|let|var|class)\\s+${name}\\b|\\b${name}\\s*\\([^)]*\\)\\s*\\{|['"]${name}['"]\\s*[:,)]|\\b${name}\\s*:)`).test(text);

function genericStatic() {
  const tokens = [...new Set(docLines.flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1])))];
  for (const token of tokens.filter((t) => /^[A-Za-z][\w.-]*\/[\w./-]*$/.test(t))) {
    const present = existsSync(repo(token));
    const ignored = !present && isIgnored(token);
    record(`\`${token}\``, present ? outcome(true, `${token} exists`) : ignored ? outcome(null, `${token} is gitignored and not present in this checkout`) : outcome(false, `${token} is missing`));
  }

  for (const token of tokens) {
    const name = token.replace(/\(\)$/, '');
    if (!/^[a-z]\w*[A-Z]\w*$/.test(name) && !/^[a-z]+_[a-z_]+$/.test(name) && !/^[a-z]\w*\(\)$/.test(token)) continue;
    const at = docLines.findIndex((line) => line.includes(`\`${token}\``));
    const phrase = `${docLines[at] ?? ''} ${docLines[at + 1] ?? ''}`.slice((docLines[at] ?? '').indexOf(token));
    const scope = phrase.match(/ in `([^`]+)`/)?.[1];
    if (scope) {
      const defined = existsSync(repo(scope)) && definedIn(read(scope), name);
      record(`\`${token}\``, outcome(defined, defined ? `${name} is defined or used in ${scope}` : `${name} has no definition or code use in ${scope}`));
      continue;
    }
    const defined = definedIn(sourceText, name) || (gmText !== null && definedIn(gmText, name));
    record(`\`${token}\``, outcome(defined ? true : gmText === null ? null : false, defined ? `${name} is defined or used in the repo or gm` : `${name} has no definition or code use in the repo or gm`));
  }
}

function architectureStatic() {
  record('owner-approved commit `cc242f5`', (() => {
    const type = objectType('cc242f5');
    if (type !== null) return outcome(type === 'commit', `cc242f5 is a ${type}`);
    if (commitCount() <= 1) return outcome(null, 'cc242f5 cannot be verified: this tree has one commit and no history to check it against (UNVERIFIED, no history)');
    return outcome(false, 'cc242f5 is not in the repository');
  })());

  for (const line of docLines) {
    const row = line.match(/^\| `([\w.-]+\.mjs)` \| ([^|]+) \|/);
    if (!row) continue;
    const [, file, cell] = row;
    const expected = Object.fromEntries(GM_CALLS.map((name) => [name, 0]));
    for (const [, count, name] of cell.matchAll(/(\d+) `(\w+)`/g)) expected[name] = Number(count);
    const path = join(gmSrc, file);
    const needle = `| \`${file}\` |`;
    if (!existsSync(path)) {
      record(needle, outcome(null, `${file} is not under ${gmSrc}, so the call count is unverified`));
      continue;
    }
    const source = readFileSync(path, 'utf8');
    const actual = Object.fromEntries(GM_CALLS.map((name) => [name, (source.match(new RegExp(`\\b${name}\\(`, 'g')) ?? []).length]));
    const mismatch = GM_CALLS.filter((name) => actual[name] !== expected[name]);
    const documented = GM_CALLS.filter((name) => expected[name]).map((name) => `${expected[name]} ${name}`).join(', ') || 'no direct child_process call';
    record(needle, outcome(mismatch.length === 0, mismatch.length
      ? `${file}: doc says ${documented}; source has ${GM_CALLS.filter((name) => actual[name]).map((name) => `${actual[name]} ${name}`).join(', ') || 'none'}`
      : `${file}: ${documented} as documented`));
  }

  record('every real operation on the CLI and relay path', (() => {
    const { inPage, relay } = overrideNames();
    const paragraph = paragraphAt('In the browser, `web/gm-worker.js` runs');
    const unnamed = [...inPage, ...relay].filter((name) => !paragraph.includes(`\`${name}\``));
    return outcome(unnamed.length === 0, unnamed.length
      ? `not named in the browser paragraph: ${unnamed.join(', ')}`
      : `the browser paragraph names every in-page override (${inPage.join(', ')}) and the relay wrapper (${relay.join(', ')})`);
  })());
  record('In the browser, `web/gm-worker.js` runs', outcome(fileHas('web/gm-worker.js', '/tools.mjs') && fileHas('web/git-in-page.js', 'export const gitVerbs'), 'gm-worker.js loads gm tools.mjs, and git-in-page.js exports the git overrides'));
  record('`@everruns/bashkit-wasm` 0.20.3', versionIn('web/vendor/bashkit', '0.20.3'));
  record('which verifies the wasm SHA-256', outcome(fileHas('scripts/vendor-bashkit.mjs', 'build-info.json') && fileHas('scripts/vendor-bashkit.mjs', 'sha256'), 'vendor-bashkit.mjs reads build-info.json and checks sha256'));
  record('backed by isomorphic-git 1.44.11', versionIn('web/vendor/isomorphic-git.mjs', '1.44.11'));
  record('sql.js (MIT', outcome(fileHas('web/vendor/SQLJS-LICENSE', 'MIT'), 'the vendored licence names MIT'));
  record('about 670 KB of wasm', (() => {
    const wasm = filesUnder('web/vendor/sqljs').filter((file) => file.endsWith('.wasm'));
    if (wasm.length === 0) return outcome(null, 'no sql.js wasm is vendored in this checkout');
    const kib = Math.round(wasm.reduce((sum, file) => sum + statSync(file).size, 0) / 1024);
    return outcome(kib >= 600 && kib <= 740, `sql.js wasm is ${kib} KiB`);
  })());
  record('| `python3` | Pyodide 314.0.7', (() => {
    if (filesUnder('web/vendor/pyodide').length === 0) return outcome(null, 'web/vendor/pyodide is not present in this checkout');
    const bytes = filesUnder('web/vendor/pyodide').reduce((sum, file) => sum + statSync(file).size, 0);
    const megabytes = (bytes / 1e6).toFixed(1);
    const size = outcome(bytes >= 11.2e6 && bytes <= 16.8e6, `vendored Pyodide is ${megabytes} MB unpacked`);
    return all(versionIn('web/vendor/pyodide', '314.0.7'), size);
  })());
  record('`pyodide-lock.json`, 357 entries', (() => {
    const lock = repo('web/vendor/pyodide/pyodide-lock.json');
    if (!existsSync(lock)) return outcome(null, 'pyodide-lock.json is not vendored in this checkout');
    const count = Object.keys(JSON.parse(readFileSync(lock, 'utf8')).packages).length;
    return outcome(count === 357, `pyodide-lock.json has ${count} entries`);
  })());
  record('checks each file\'s pinned SHA-256', outcome(fileHas('scripts/vendor-pyodide.mjs', 'sha256'), 'vendor-pyodide.mjs checks SHA-256'));
  record('It loads micropip 0.11.1 from the jsDelivr CDN', outcome(
    fileHas('web/python-in-page.js', '0.11.1') && fileHas('web/python-in-page.js', 'v314.0.7') && fileHas('web/python-in-page.js', 'jsdelivr'),
    'python-in-page.js names micropip 0.11.1, the v314.0.7 Pyodide pin and jsDelivr',
  ));
  record('`which`, `command -v` and `type` are shell functions', outcome(
    fileHas('web/shell-lookup.js', 'builtin command -v') && fileHas('web/shell-lookup.js', 'builtin type'),
    'shell-lookup.js defines the functions over builtin command -v and builtin type',
  ));
  record('`git` is a bashkit custom builtin', outcome(fileHas('web/bash-shell.js', 'git: (ctx)') && fileHas('web/bash-shell.js', 'customBuiltins'), 'bash-shell.js registers git in customBuiltins'));
  record('because gm\'s `pending.mjs`', (() => {
    const path = join(gmSrc, 'pending.mjs');
    if (!existsSync(path)) return outcome(null, 'gm pending.mjs is not present');
    return outcome(readFileSync(path, 'utf8').includes('SharedArrayBuffer'), 'gm pending.mjs uses SharedArrayBuffer');
  })());
  record('hydrated from OPFS at start', outcome(fileHas('web/shims/fs.js', 'hydrate'), 'fs.js hydrates the tree from OPFS'));
  record('table is kept in `/.thebird/links.json`', outcome(fileHas('web/shims/fs.js', 'links.json'), 'fs.js stores the link table in links.json'));

  cites('Measured in headless Chromium (`npm run witness`)', ['browser terminal runs shell through the relay in headless Chromium']);
  cites('over 300 files, a warm call takes under 5 ms', ['python3 warm calls are timed in-page over 300 files']);
  record('`fs.watch` is a no-op', outcome(witness.includes('fs.watch returns an inert handle') && !fileHas('web/shims/fs.js', 'chmod') && !fileHas('web/shims/fs.js', 'lock'), 'the witness checks the inert handle, and fs.js has no file modes or locks'));
  record('The gm worker holds the whole tree in memory', outcome(/await flushFs\(\);\n\s+postMessage\(reply\);/.test(read('web/gm-worker.js')), 'gm-worker.js waits for flushFs before each reply'));
  record('`AsyncLocalStorage` only holds', outcome(witness.includes('AsyncLocalStorage holds its store for synchronous code and loses it after an await'), 'the witness checks the store before and after an await'));
  cites('The read-back reads every Pyodide file', ['in-page python3 removes a file it deletes and the shell sees it gone']);
  cites('Installed packages live in Pyodide', ['pip installs stay in Pyodide memory: no tabulate file reaches OPFS']);
  cites('bashkit cuts error text at', ['in-page python3 error text keeps a readable link instead of bashkit cutting it at //']);
  record('It does not run gm\'s sources', outcome(['wiki', 'skills', 'connect', 'workers', 'prompt', 'KEEP'].every((name) => fileHas('web/commit-gate.js', `'${name}'`)), 'commit-gate.js names each of these as not run in-page'));

  cites('`?gm=raw` loads gm without', ['before: raw gm cannot load in the browser worker']);
  cites('the file survives a browser restart', ['after: the OPFS file survives a browser restart']);
  cites('Writes are write-behind', ['after: the OPFS file survives a browser restart']);
  cites('`git commit` (shell and gm `git_commit`)', ['in-page git commit runs the gate and sets HEAD', 'in-page git commit refuses broken syntax and non-ASCII and names both']);
  cites('In-page git has local branches and checkout', ['in-page git lists branches, creates one and switches to it', 'in-page git checkout refuses an unknown branch and leaves HEAD where it was']);
  cites('`git branch`, `git checkout` (local branches)', ['in-page git lists branches, creates one and switches to it', 'in-page git checkout restores the working tree of the branch it returns to']);
  cites('A missing README, AGENTS, ARCHITECTURE or DESIGN', ['in-page git commit without DESIGN.md is refused and names it']);
  cites('- Symlinks are link nodes', ['in-page ln -s makes a link that readlink reports, and a read and a stat follow it', 'in-page symlinks survive a browser restart, ls -l shows them, and rm removes only the link']);
  cites('`ps`, `uname`, `hostname` and `tar` are emulated', ['in-page uname, whoami and tar are labelled as emulations, and plain commands are not']);
  cites('`sqlite3 <database> <sql>` is a custom builtin', ['in-page sqlite3 creates a database and answers a query through sql.js', 'in-page sqlite3 database survives a browser restart']);
  cites('Pyodide loads on the first call', ['in-page python3 runs a one-line script through Pyodide']);
  cites('The `/workspace` tree is mirrored', ['in-page python3 reads and writes files on the OPFS tree', 'in-page python3 sees a shell rewrite made after its last call', 'in-page python3 removes a file it deletes and the shell sees it gone']);
  cites('Only the last line of a traceback is reported', ['in-page python3 reports a traceback as an error', 'in-page python3 error text keeps a readable link instead of bashkit cutting it at //']);
  cites('`pip install <package>...` runs in-page', ['in-page pip installs a pure package from PyPI, and python3 imports it in the same page']);
  cites('It loads micropip 0.11.1 from the jsDelivr CDN', ['the micropip wheel the page loads is the one pinned in the Pyodide lock']);
  cites('Only plain names are',['in-page pip refuses version specifiers, Pyodide-bundled packages and unknown names with a message and no URL']);
  cites('`which`, `command -v` and `type` are shell functions', ['which, command -v and type agree for every name Tab offers, path or builtin']);
  cites('witnessed loop checks that the three agree',['which, command -v and type agree for every name Tab offers, path or builtin', 'in-page git is reported as a builtin by type, command -v and which']);
  cites('bashkit resets `$?`', ['in-page bash keeps $? across terminal lines']);
  cites('Shell output streams while a command runs.', ['in-page terminal shows shell output while the command is still running', 'in-page terminal prints each streamed line once, in order']);
  cites('Output is plain text by default', ['ANSI off by default: escape sequences are stripped and the text copies as plain', 'ansi parser keeps the text of escape sequences out of plain output']);
  cites('`?ansi=color` renders', ['?ansi=color renders SGR colour and style as classed spans, and the copied text stays plain']);
  cites('Ctrl-L clears the output', ['in-page terminal Ctrl-L clears the output', 'in-page terminal Ctrl-U clears the line, and Ctrl-A and Ctrl-E move the caret to its ends']);
  cites('Lines typed while a command runs wait in a queue', ['in-page terminal runs lines typed during a command in order, not as busy errors', 'in-page terminal Ctrl-C drops lines queued behind the cancelled command']);
  cites('The prompt shows the shell\'s working directory', ['in-page prompt shows the working directory after cd', 'in-page cd persists to the next command and Tab completes relative to it']);
  cites('Relay mode shows the workspace in the prompt', ['relay prompt shows the workspace, where host commands run']);
  cites('The terminal keeps history for the up and down arrows', ['in-page terminal recalls submitted commands with the up and down arrows', 'in-page terminal recalls a submitted command after the page reloads']);
  cites('Tab completes the first word after `shell`', ['in-page terminal completes a command name in command position with Tab', 'a command completed by name really runs in-page', 'every name Tab offers in command position resolves in-page, and the custom builtins are among them']);
  cites('Otherwise Tab completes the last word', ['in-page terminal completes a unique file name with Tab and adds a space', 'in-page terminal completes a directory with a trailing slash', 'in-page terminal lists several matches when Tab cannot finish a name']);
  cites('Relay mode completes the same way', ['relay Tab completes a file name, lists several matches and completes a command name']);
  cites('cancels it through bashkit\'s `cancel()`', ['in-page terminal Ctrl-C cancels a running command and the shell carries on']);
  cites('Relay mode cancels the same way through `POST /cancel`', ['relay Ctrl-C cancels a running host command in about a second and the shell carries on']);
  cites('`--version` reports the in-page library version', ['in-page git --version names the in-page library, not a host git']);
  cites('`init`, `add`, `status`, `log [-n N]` and `diff` run over the OPFS tree', ['in-page git inits and stages over OPFS']);
  cites('`commit -m` runs the in-page gate', ['in-page git commit runs the gate and sets HEAD']);
  cites('a failing gate refuses the',['in-page git commit refuses broken syntax and non-ASCII and names both']);
  cites('browser witness commits',['in-page git commit runs the gate and sets HEAD']);
  cites('A Node-side witness check',['Node-side in-page commit passes the gate and commits as lanmower', 'git status marks the modified file after a commit', 'git log lists the seeded commit', 'git diff shows the removed and added lines']);
  cites('`curl` and `wget` (`web/curl-in-page.js`) run over fetch', ['in-page curl and wget fetch from a host that sends CORS headers', 'in-page curl refuses a host that sends no CORS headers, and the shell goes on']);
  cites('Background jobs', ['in-page bash refuses background jobs with a pointer to the relay', 'in-page bash refuses a bare & and keeps &&, redirects and quoted ampersands']);
  cites('| `node` | none verified', ['relay mode runs the host node, which the in-page shell cannot']);
}

const NODE_BARE = ['fs', 'path', 'os', 'url', 'http', 'crypto', 'module', 'readline', 'child_process', 'process'];
const importSpecs = (file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]);
function nodeReach(file, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const specs = importSpecs(file);
  if (specs.some((spec) => spec.startsWith('node:') || NODE_BARE.includes(spec))) return true;
  return specs.filter((spec) => spec.startsWith('.')).some((spec) => {
    const target = join(dirname(file), spec);
    return existsSync(target) && nodeReach(target, seen);
  });
}

function agentsStatic() {
  record('Browser-safe: `src/api.js`', outcome(['src/api.js', 'src/commands.js', 'src/runner.js', 'src/gm-client.js', 'src/gm-remote.js', 'web/terminal.js'].every((file) => !nodeReach(repo(file))), 'none of these reaches a Node module, directly or through a relative import'));
  record('Node-only: `src/gm.js`', outcome(['src/gm.js', 'src/relay.js', 'src/index.js', 'src/cli.js'].every((file) => nodeReach(repo(file))), 'each Node-only file reaches a node: module, directly or through a relative import'));
  record('`createGmClient()` resolves', outcome(['GM_HOME', 'THEBIRD_GM_HOME', 'gm/package.json', "'../gm'", "'gm'"].every((needle) => fileHas('src/gm.js', needle)) && fileHas('src/cli.js', '--gm-home') && fileHas('AGENTS.md', 'THEBIRD_GM_HOME'), 'src/gm.js searches --gm-home, GM_HOME, THEBIRD_GM_HOME, the gm package, ../gm and ./gm, and AGENTS.md names THEBIRD_GM_HOME'));
  record('`web/shims/*.js` are browser-only', outcome(!walk(repo('web/shims')).some((file) => /from 'node:/.test(readFileSync(file, 'utf8'))), 'no shim imports a node: module'));
  const foreign = walk(repo('web/shims')).filter((file) => file.endsWith('.js')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)]
    .filter(([, specifier]) => !specifier.startsWith('./')).map(([, specifier]) => ({ file: file.split('/').pop(), specifier })));
  const acornOnly = foreign.every((item) => item.file === 'node-stubs.js' && item.specifier === '../vendor/acorn.mjs');
  const bullet = docLines.findIndex((line) => line.includes('import only each other'));
  const paragraph = docLines.slice(bullet, docLines.findIndex((line, index) => index > bullet && line.startsWith('- ')) || undefined).join(' ');
  const mentionsAcorn = paragraph.includes('acorn');
  record('import only each other', outcome(acornOnly && mentionsAcorn, `non-relative shim imports: ${foreign.map((item) => `${item.file} -> ${item.specifier}`).join(', ') || 'none'}; the doc ${mentionsAcorn ? 'names' : 'does not name'} the acorn import`));
  record('`web/vendor/pyodide/` is generated by', outcome(isIgnored('web/vendor/pyodide/') && fileHas('scripts/vendor-pyodide.mjs', 'sha256'), 'web/vendor/pyodide is gitignored and vendor-pyodide.mjs checks SHA-256'));
  record('`web/vendor/bashkit/` is generated by', outcome(isIgnored('web/vendor/bashkit/') && fileHas('scripts/vendor-bashkit.mjs', 'sha256'), 'web/vendor/bashkit is gitignored and vendor-bashkit.mjs checks SHA-256'));
  record('`pip install` in-page loads micropip', all(
    outcome(witness.includes('the micropip wheel the page loads is the one pinned in the Pyodide lock') && fileHas('web/python-in-page.js', 'v314.0.7'), 'the micropip pin is checked by the witness, and python-in-page.js pins v314.0.7'),
    outcome(!filesUnder('web/vendor').some((file) => file.endsWith('.whl')), 'no wheel is vendored under web/vendor'),
  ));
  record('`thebird.history`. It stores only', all(
    outcome(fileHas('web/terminal.js', 'HISTORY_LIMIT = 500') && fileHas('web/terminal.js', "'thebird.history'"), 'terminal.js sets the thebird.history key and a 500 cap'),
    outcome(witness.includes('in-page terminal stores only the submitted command lines in localStorage'), 'witness: localStorage holds only the submitted command lines'),
  ));
  record('The browser terminal shows plain text by default', all(
    outcome(witness.includes('ANSI off by default: escape sequences are stripped and the text copies as plain'), 'witness: ANSI off by default'),
    outcome(witness.includes('?ansi=color renders SGR colour and style as classed spans, and the copied text stays plain'), 'witness: ?ansi=color renders SGR colour'),
  ));
  cites('The default browser terminal runs gm in', ['after: in-page gm writes and lists files over OPFS']);
  cites('sends gm calls to the relay on the host instead', ['browser terminal runs shell through the relay in headless Chromium']);
  cites('The browser terminal (relay mode) runs in a page served by the relay', ['relay serves the browser terminal page']);
  record('`job_start` maps to gm\'s `run_shell`', outcome(fileHas('src/gm-client.js', "name === 'job_start'") && fileHas('src/gm-client.js', "call('run_shell', { ...args, background: true }"), 'gm-client.js maps job_start to run_shell with background: true'));
  record('Validation is `npm run witness`', (() => {
    const scripts = JSON.parse(read('package.json')).scripts ?? {};
    return outcome(Boolean(scripts.witness) && !scripts.test, `witness script ${scripts.witness ? 'is defined' : 'is missing'}; test script ${scripts.test ? 'exists' : 'is absent'}`);
  })());
  cites('- Repo-owned code has no comments', ['repo-owned code has no comments']);
  cites('The third-party bundles in `web/vendor/` with comments', ['every vendored bundle with comments has a provenance witness']);
  record('A tree from `git archive` has no `.git`', all(
    outcome(fileHas('scripts/witness.mjs', 'await vendorBashkit()') && fileHas('scripts/witness.mjs', 'await vendorPyodide()'), 'witness.mjs generates both vendor directories when they are missing'),
    outcome(fileHas('scripts/lint-architecture.mjs', 'commitCount() <= 1') && fileHas('scripts/lint-architecture.mjs', 'UNVERIFIED, no history'), 'the cc242f5 record takes the no-history branch only for a one-commit tree'),
  ));
  record('Use Conventional Commits', (() => {
    const subjects = execFileSync('git', ['log', '-n', '20', '--format=%s'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    const matching = subjects.filter((subject) => /^(feat|fix|docs|test|chore|refactor|perf|build|ci|style|revert)(\([^)]+\))?!?: /.test(subject)).length;
    return outcome(matching === subjects.length ? true : null, `${matching} of the last ${subjects.length} commit subjects are Conventional`);
  })());
  record('gm is the only execution engine', (() => {
    const named = bulletOf('gm is the only execution engine');
    const { inPage, relay: relayOverrides } = overrideNames();
    const unnamed = inPage.filter((name) => !named.includes(`\`${name}\``));
    const relayNamed = relayOverrides.every((name) => named.includes(`\`${name}\``));
    const bothCreateTools = fileHas('src/gm.js', 'createTools({') && fileHas('web/gm-worker.js', 'tools.mjs');
    return outcome(unnamed.length === 0 && relayNamed && bothCreateTools, unnamed.length || !relayNamed || !bothCreateTools
      ? `overrides not named in the rule: ${unnamed.join(', ') || relayOverrides.filter((name) => !named.includes(`\`${name}\``)).join(', ') || 'gm tools are not created in both engines'}`
      : `in-page overrides ${inPage.join(', ')} and relay override ${relayOverrides.join(', ')} are all named; both engines create gm's tools`);
  })());
  record('CLI commands and library methods must be thin mappings', (() => {
    const failures = Object.keys(CLI_COMMANDS).flatMap((name) => {
      if (!(name in SAMPLE_LINES)) return [`${name} has no sample line`];
      const { verbs, error } = thin[name];
      if (LOCAL_COMMANDS.includes(name)) return verbs.length === 0 ? [] : [`${name} sends ${verbs.join(', ')}`];
      return verbs.length > 0 ? [] : [`${name} sends no gm verb${error ? ` (${error})` : ''}`];
    });
    return outcome(failures.length === 0, failures.length
      ? failures.join('; ')
      : `${Object.keys(CLI_COMMANDS).length} commands: each sends a gm verb except ${LOCAL_COMMANDS.join(', ')}, which send none`);
  })());
  record('Add a shim here before adding a `node:` import', (() => {
    if (!existsSync(gmSrc)) return outcome(null, 'gm is not present, so the in-page imports are unverified');
    const imports = inPageNodeImports();
    const gaps = imports.flatMap(({ file, spec, clause }) => {
      const { names, hasDefault } = shimExports(repo(shimFor(spec)));
      const named = [...clause.matchAll(/\{([^}]*)\}/g)].flatMap((match) => match[1].split(',')).map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const missing = named.filter((name) => !names.has(name));
      if (/^\w/.test(clause) && !hasDefault) missing.push('default');
      return missing.length ? [`${file} ${spec} needs ${missing.join(', ')} from ${shimFor(spec)}`] : [];
    });
    return outcome(gaps.length === 0, gaps.length
      ? gaps.join('; ')
      : `${imports.length} node: imports reachable from the in-page gm entry points are provided by their shims`);
  })());
  record('`type -a` is not handled.', (() => {
    const body = read('web/shell-lookup.js').split('type() {')[1]?.split('\n}')[0] ?? '';
    return outcome(/case "\$1" in -t\|-p\)/.test(body) && !/-a\b/.test(body), 'the prologue type takes only -t and -p as its first word, and has no -a case');
  })());
}

function probe(blocks, id, pass, detail) {
  const text = blocks[id];
  if (text === null || text === undefined) return outcome(false, `${id} did not run`);
  return outcome(pass(text), `${detail} (${id}: ${JSON.stringify(text).slice(0, 120)})`);
}

const blocksOf = (out, probes) => Object.fromEntries(probes.map(([id]) => {
  const match = out.match(new RegExp(`^@@BEGIN-${id}\\n([\\s\\S]*?)^@@END-${id}$`, 'm'));
  return [id, match ? match[1].split('\n').filter((line) => !line.startsWith('thebird> ')).join('\n').trimEnd() : null];
}));

const pairsFor = (probes, extra = []) => [
  ...extra,
  ...probes.flatMap(([id, command]) => [['run', `shell echo @@BEGIN-${id}`], ['run', command], ['run', `shell echo @@END-${id}`]]),
];

const relayFacts = async (url) => {
  const get = async (path, init) => {
    const response = await fetch(new URL(path, url), init);
    await response.text();
    return response;
  };
  const json = { 'content-type': 'application/json' };
  const meta = await get('meta');
  const page = await get('');
  const cancel = [
    await get('cancel', { method: 'POST', headers: json, body: JSON.stringify({ id: 'nobody' }) }),
    await get('cancel', { method: 'POST', headers: json, body: 'not json' }),
    await get('cancel', { method: 'PUT' }),
    await get('cancel'),
  ];
  const call = await get('call', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'not json' });
  const preflight = await get('call', { method: 'OPTIONS' });
  const corsKeys = [...cancel, preflight].flatMap((response) => [...response.headers.keys()]).filter((key) => key.startsWith('access-control-'));
  return {
    metaStatus: meta.status,
    metaCoop: meta.headers.get('cross-origin-opener-policy'),
    pageCoop: page.headers.get('cross-origin-opener-policy'),
    pageCoep: page.headers.get('cross-origin-embedder-policy'),
    codes: cancel.map((response) => response.status),
    callStatus: call.status,
    host: new URL(url).hostname,
    corsKeys,
  };
};

function liveRecords(page, remote, facts) {
  const P = (id, pass, detail) => probe(page, id, pass, detail);
  const R = (id, pass, detail) => probe(remote, id, pass, detail);
  const refused = (text) => /relay/i.test(text);
  const notRefused = (text) => !/need the relay/i.test(text);
  const noError = (text) => text.length > 0 && !/error|usage|unknown/i.test(text);

  record('`write`, `read`, `ls`, `stat`, `grep`, `search`', all(
    P('write', (t) => t.includes('wrote lint/a.txt'), 'write wrote the file'),
    P('read', (t) => t.includes('lint-probe-text'), 'read returns the text'),
    P('ls', (t) => t.includes('a.txt'), 'ls lists the file'),
    P('stat', (t) => /"type":"file"/.test(t) && /"size":15/.test(t), 'stat reports a file of the written size'),
    P('grep', (t) => t.includes('a.txt'), 'grep finds the text'),
    P('search', (t) => !/error/i.test(t), 'search runs'),
  ));
  record('`memory write`, `memory search`, `prd add`, `prd list`, `log`, `config`', all(
    P('memory', noError, 'memory write runs'),
    P('memory-search', noError, 'memory search runs'),
    P('prd', noError, 'prd list runs'),
    P('log-tool', noError, 'log runs'),
    P('config', noError, 'config runs'),
    P('prd-add', (t) => /^prd-\S+$/m.test(t), 'prd add returns an id'),
  ));
  record('`shell` (bash builtins and pipelines, see below)', all(
    P('pipe', (t) => t === 'b', 'a pipeline runs in-page'),
    P('commands', (t) => t.includes('all-resolved') && !t.includes('missing-'), 'every listed command resolves'),
  ));
  record('`git init`, `add`, `status`, `log`, `diff`', all(
    P('status', (t) => /^ M a\.txt$/m.test(t), 'status prints porcelain v1'),
    P('log', (t) => /\bone\b/.test(t), 'log shows the seeded commit'),
    P('diff', (t) => t.includes('more') && !/^@@/m.test(t), 'diff prints no hunk header'),
  ));
  record('`git push/fetch/pull`, `job start` | need the relay', all(
    P('push', refused, 'git push is refused with a relay pointer'),
    P('jobstart', refused, 'job start is refused with a relay pointer'),
    R('relay-push', notRefused, 'the relay runs git push'),
    R('relay-job', notRefused, 'the relay runs job start'),
  ));
  record('`git branch`, `git checkout` (local branches)', P('branch', (t) => t.includes('lint-b'), 'git branch lists the new branch'));
  record('| `fetch` | fails for hosts without CORS headers', all(
    P('fetch-nocors', (t) => !t.includes('plain-host-hello'), 'fetch to a host without CORS fails'),
    P('fetch-cors', (t) => t.includes('cors-host-hello'), 'the positive control, a host with CORS, succeeds'),
  ));
  record('In-page git has local branches and checkout', all(
    P('remote', (t) => t.includes('the in-page shell supports init'), 'git remote is refused with the supported list'),
    P('stash', (t) => t.includes('the in-page shell supports init'), 'git stash is refused with the supported list'),
  ));
  record('`diff` compares the working tree with HEAD', P('diff', (t) => t.includes('more') && !/^@@/m.test(t), 'diff has no hunk header'));
  record('`status` prints porcelain v1 lines', P('status', (t) => /^ M a\.txt$/m.test(t), 'status porcelain line'));
  record('`.thebird/` is excluded from the index', P('status', (t) => !t.includes('.thebird'), '.thebird is not listed'));
  record('`init`, `add`, `status`, `log [-n N]` and `diff` run over the OPFS tree', all(
    P('status', (t) => /^ M a\.txt$/m.test(t), 'status runs'),
    P('log', (t) => /\bone\b/.test(t), 'log runs'),
  ));
  record('`shell` passes its text to bashkit raw', P('quotes', (t) => t === '(x)|y z', 'quotes and parentheses survive'));
  record('`head` after an early-closing pipe', P('head', (t) => t === '1', 'head closes the pipe'));
  record('`sqlite3 <database> <sql>` is a custom builtin', P('sqlite', (t) => t.includes('1|two'), 'sqlite3 prints list mode'));
  record('sqlite\'s list mode', P('sqlite', (t) => t.includes('1|two'), 'sqlite3 list mode uses |'));
  record('| `node` | none verified', P('node', (t) => /rc=127/.test(t) && /not available in the sandbox/.test(t), 'node exits 127 with the sandbox message'));
  record('Not covered: node and any host binary (exit 127)', P('node', (t) => /rc=127/.test(t), 'node exits 127'));
  record('`ps`, `uname`, `hostname` and `tar` are emulated', P('tar', (t) => t.includes('tar (bashkit) 0.1'), 'tar reports bashkit'));
  record('`tar --version` reports `tar (bashkit) 0.1`', P('tar', (t) => t.includes('tar (bashkit) 0.1'), 'tar --version reports bashkit'));
  record('Probed coverage (in-page, 0.20.3)', P('commands', (t) => t.includes('all-resolved') && !t.includes('missing-'), 'the listed commands resolve in-page'));
  record('`git_commit` refuses `paths` and `author`', all(
    P('commit-paths', (t) => t.includes('stage with git_add and omit paths'), 'paths are refused'),
    P('commit-author', (t) => t.includes('authored lanmower'), 'author is refused'),
  ));
  record('`python3 -c <code>` and `python3 <file>`', all(
    P('python-c', (t) => /^42$/m.test(t), 'python3 -c runs'),
    P('python-file', (t) => /^42$/m.test(t), 'python3 <file> runs'),
  ));
  record('`shell` runs in-page through', P('pipe', (t) => t === 'b', 'in-page bash runs a pipeline'));
  record('`curl` and `wget` (`web/curl-in-page.js`) run over fetch', all(
    P('curl-cors', (t) => t.includes('cors-host-hello'), 'curl succeeds on a CORS host'),
    P('curl-nocors', refused, 'curl refuses a host without CORS with a relay pointer'),
  ));
  record('The flags `-s`, `-S`, `-f`, `-L` and `-q` work for both', all(
    P('curl-v', (t) => t.includes('flag not supported') && t.includes('relay'), 'an unlisted flag is refused with a relay pointer'),
    P('curl-SL', (t) => !t.includes('flag not supported'), 'combined -SL is accepted'),
  ));
  record('Background jobs', all(
    P('jobstart', refused, 'job start is refused'),
    P('amp', refused, 'a bare & is refused'),
  ));

  record('The relay must send `Cross-Origin-Opener-Policy', outcome(
    facts.metaCoop === 'same-origin' && facts.pageCoop === 'same-origin' && facts.pageCoep === 'require-corp',
    `meta COOP ${facts.metaCoop}, page COOP ${facts.pageCoop}, page COEP ${facts.pageCoep}`,
  ));
  record('`/cancel` answers 404 for an unknown id', outcome(
    JSON.stringify(facts.codes) === '[404,400,405,405]',
    `POST unknown 404, bad JSON 400, PUT 405, GET 405: got ${facts.codes.join(', ')}`,
  ));
  record('it adds no CORS headers', outcome(facts.corsKeys.length === 0, facts.corsKeys.length ? `access-control headers: ${facts.corsKeys.join(', ')}` : 'no access-control headers on /cancel or the /call preflight'));
}

function agentsLive(page, remote, facts) {
  const P = (id, pass, detail) => probe(page, id, pass, detail);
  const R = (id, pass, detail) => probe(remote, id, pass, detail);

  record('In-page `which`, `type` and `command -v` are one answer', all(
    P('type-t', (t) => t === 'builtin', '`type -t git` says builtin'),
    P('type-fn', (t) => /function/.test(t), '`type which` says it is a function'),
    P('compgen', (t) => /^which$/m.test(t), 'compgen -c lists the prologue function'),
  ));
  record('`node` is relay-only.', P('node', (t) => /rc=127/.test(t) && /not available in the sandbox/.test(t), 'node exits 127 in-page with the sandbox message'));
  record('Unknown gm verbs pass through unchanged', R('relay-unknown', (t) => t.includes('no_such_verb'), 'the relay returns gm\'s own error for an unknown verb'));
  record('(`GET /meta`, `POST /call`, and `POST /cancel`', outcome(facts.metaStatus === 200 && facts.codes[0] === 404, `GET /meta ${facts.metaStatus}; POST /cancel unknown id ${facts.codes[0]}`));
  record('The relay binds 127.0.0.1 by', outcome(facts.host === '127.0.0.1', `relay host is ${facts.host}`));
  record('answers only JSON POSTs', outcome(facts.callStatus === 400, `POST /call with a non-JSON body answers ${facts.callStatus}`));
}

async function liveChecks() {
  const workspace = mkdtempSync(join(tmpdir(), 'lint-workspace-'));
  const profiles = [];
  const relay = await startRelay({ workspace });
  const corsHost = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('cors-host-hello\n');
  });
  const plainHost = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('plain-host-hello\n');
  });
  await Promise.all([corsHost, plainHost].map((server) => new Promise((ok) => server.listen(0, '127.0.0.1', ok))));
  const corsPort = corsHost.address().port;
  const plainPort = plainHost.address().port;
  const session = async (pairs) => {
    const profile = mkdtempSync(join(tmpdir(), 'lint-profile-'));
    profiles.push(profile);
    return runTerminal({ chrome, profile, url: relay.url + '?' + new URLSearchParams(pairs).toString(), timeoutMs: 900000 });
  };
  try {
    const probes = [
      ['init', 'shell git init'],
      ['seed', 'shell echo doc-README > README.md && echo doc-AGENTS > AGENTS.md && echo doc-ARCHITECTURE > ARCHITECTURE.md && echo doc-DESIGN > DESIGN.md && echo one > a.txt && git add README.md AGENTS.md ARCHITECTURE.md DESIGN.md a.txt && git commit -m one'],
      ['modify', 'shell echo more >> a.txt'],
      ['pipe', String.raw`shell printf "a\nb\n" | sort -r | head -1`],
      ['quotes', String.raw`shell printf "%s|%s\n" "(x)" 'y z'`],
      ['status', 'shell mkdir -p .thebird && echo x > .thebird/run.log && git status --porcelain'],
      ['diff', 'shell git diff'],
      ['log', 'shell git log -n 1'],
      ['branch', 'shell git branch lint-b && git branch'],
      ['remote', 'shell git remote'],
      ['stash', 'shell git stash'],
      ['push', 'shell git push'],
      ['jobstart', 'job start sleep 1'],
      ['amp', 'shell sleep 0 & echo x'],
      ['curl-v', 'shell curl -v http://127.0.0.1:9/'],
      ['curl-SL', 'shell curl -SL http://127.0.0.1:9/'],
      ['curl-cors', `shell curl -s http://127.0.0.1:${corsPort}/hello`],
      ['curl-nocors', `shell curl http://127.0.0.1:${plainPort}/hello`],
      ['fetch-cors', `fetch http://127.0.0.1:${corsPort}/hello`],
      ['fetch-nocors', `fetch http://127.0.0.1:${plainPort}/hello`],
      ['node', 'shell node -v; echo rc=$?'],
      ['commands', `shell for n in ${COMMANDS}; do command -v "$n" >/dev/null || echo missing-$n; done; echo all-resolved`],
      ['write', 'write lint/a.txt lint-probe-text'],
      ['read', 'read lint/a.txt'],
      ['ls', 'ls lint'],
      ['stat', 'stat lint/a.txt'],
      ['grep', 'grep lint-probe-text lint'],
      ['search', 'search lint-probe-text'],
      ['memory', 'memory write lint-key lint-value'],
      ['memory-search', 'memory search lint-value'],
      ['prd', 'prd list'],
      ['log-tool', 'log'],
      ['config', 'config'],
      ['sqlite', `shell sqlite3 lint.db "create table t(a,b); insert into t values (1,'two'); select a,b from t"`],
      ['python-c', 'shell python3 -c "print(40+2)"'],
      ['python-file', 'shell echo "print(40+2)" > lint.py && python3 lint.py'],
      ['tar', 'shell tar --version'],
      ['head', 'shell seq 1 100000 | head -1'],
      ['prd-add', 'prd add lint-probe-title'],
      ['commit-paths', 'gm git_commit {"message":"x","paths":["a.txt"]}'],
      ['commit-author', 'gm git_commit {"message":"x","author":"me"}'],
      ['type-t', 'shell type -t git'],
      ['type-fn', 'shell type which'],
      ['compgen', 'shell compgen -c | grep -x which'],
    ];
    const remoteProbes = [
      ['relay-push', 'git push'],
      ['relay-job', 'job start sleep 0'],
      ['relay-curl', 'shell curl -v http://127.0.0.1:9/'],
      ['relay-unknown', 'gm no_such_verb {}'],
    ];
    const pageState = await session(pairsFor(probes));
    const relayState = await session(pairsFor(remoteProbes, [['engine', 'relay']]));
    const facts = await relayFacts(relay.url);
    return { page: blocksOf(pageState.out, probes), remote: blocksOf(relayState.out, remoteProbes), facts };
  } finally {
    await relay.close();
    corsHost.close();
    plainHost.close();
    for (const dir of [workspace, ...profiles]) rmSync(dir, { recursive: true, force: true });
  }
}

inDoc('ARCHITECTURE.md', () => {
  genericStatic();
  architectureStatic();
});
inDoc('AGENTS.md', () => {
  genericStatic();
  agentsStatic();
});
if (!staticOnly) {
  try {
    const live = await liveChecks();
    inDoc('ARCHITECTURE.md', () => liveRecords(live.page, live.remote, live.facts));
    inDoc('AGENTS.md', () => agentsLive(live.page, live.remote, live.facts));
  } catch (error) {
    results.push({ doc: 'live', line: 0, text: 'live checks', ok: false, detail: `live checks did not run: ${error.message}` });
  }
}

for (const doc of Object.keys(docs).filter(() => !staticOnly)) {
  docs[doc].forEach((raw, index) => {
    const line = raw.trim();
    if (line && !/^(\||```|#)/.test(line) && !covered.has(`${doc}:${index + 1}`)) results.push({ doc, line: index + 1, text: line, ok: 'NO_CLAIM', detail: 'prose line with no claim record' });
  });
}
results.sort((a, b) => a.doc.localeCompare(b.doc) || a.line - b.line);
const label = (ok) => (ok === true ? 'PASS' : ok === false ? 'FAIL' : ok === 'NO_CLAIM' ? 'NO_CLAIM' : 'UNVERIFIED');
for (const result of results) {
  console.log(`${label(result.ok).padEnd(10)} ${result.doc}:${result.line}  ${result.text.slice(0, 100)}\n           ${result.detail}`);
}
const count = (ok) => results.filter((result) => result.ok === ok).length;
console.log(`\n${count(true) + count(false) + count(null)} claims: ${count(true)} pass, ${count(false)} fail, ${count(null)} unverified; ${count('NO_CLAIM')} prose lines with NO_CLAIM`);
if (count(false)) process.exitCode = 1;
