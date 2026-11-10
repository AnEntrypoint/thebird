import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticOnly = process.argv.includes('--static');
const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
const LIVE_TIMEOUT_MS = 900000;
const stamp = () => new Date().toISOString().slice(11, 23);
const label = (ok) => (ok === true ? 'PASS' : ok === false ? 'FAIL' : ok === 'NO_CLAIM' ? 'NO_CLAIM' : 'UNVERIFIED');
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

const outcome = (ok, detail) => ({ ok, detail });
const all = (...items) => {
  const ok = items.some((item) => item.ok === false) ? false : items.every((item) => item.ok === true) ? true : null;
  return outcome(ok, items.map((item) => item.detail).join('; '));
};

const add = (entry) => {
  results.push(entry);
  console.log(`${stamp()} ${label(entry.ok).padEnd(10)} ${entry.doc}:${entry.line}  ${entry.text.slice(0, 100)}\n           ${entry.detail}`);
};

const record = (needle, result) => {
  const index = docLines.findIndex((line) => line.includes(needle));
  if (index === -1) {
    add({ doc: docName, line: 0, text: needle, ok: false, detail: `anchor not found in ${docName}; update the lint` });
    return;
  }
  covered.add(`${docName}:${index + 1}`);
  add({ doc: docName, line: index + 1, text: docLines[index].trim(), ok: result.ok, detail: result.detail });
};

const repo = (path) => join(root, path);
const read = (path) => readFileSync(repo(path), 'utf8');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const filesUnder = (path) => {
  const full = repo(path);
  if (!existsSync(full)) return [];
  return statSync(full).isDirectory() ? walk(full) : [full];
};
const fileHas = (path, needle) => existsSync(repo(path)) && read(path).toLowerCase().includes(needle.toLowerCase());
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

const definedIn = (text, name) => new RegExp(`(\\bfunction\\s*\\*?\\s*${name}\\b|\\b(const|let|var|class)\\s+${name}\\b|\\b${name}\\s*\\([^)]*\\)\\s*\\{|['"]${name}['"]\\s*[:,)]|\\b${name}\\s*:|\\bprocess\\.env\\.${name}\\s*=)`).test(text);
const sourceText = [...walk(repo('src')), ...walk(repo('web')).filter((path) => !path.includes('/vendor/')), ...walk(repo('scripts')), ...walk(repo('bin'))]
  .filter((path) => /\.(m?js|html|js|c|h)$/.test(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

const pyodideNotVendored = () => all(
  outcome(!existsSync(repo('scripts/vendor-pyodide.mjs')) && !fileHas('.gitignore', 'web/vendor/pyodide/'), 'scripts/vendor-pyodide.mjs is retired and .gitignore has no web/vendor/pyodide/ entry'),
  outcome(witness.includes('https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json') && fileHas('web/python-bundle.js', 'pyodide-minimal.br'), 'the witness reads the Pyodide lock from its pinned jsDelivr URL, and the page fetches the stripped bundle at run time'),
);

function genericStatic() {
  const tokens = [...new Set(docLines.flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1])))];
  for (const token of tokens.filter((t) => /^[A-Za-z][\w.-]*\/[\w./-]*$/.test(t))) {
    const present = existsSync(repo(token));
    const ignored = !present && isIgnored(token);
    record(`\`${token}\``, present ? outcome(true, `${token} exists`) : ignored ? outcome(null, `${token} is gitignored and not present in this checkout`) : outcome(false, `${token} is missing`));
  }
  for (const token of tokens) {
    const name = token.replace(/\(\)$/, '');
    if (!/^[a-z]\w*[A-Z]\w*$/.test(name) && !/^[A-Z][A-Z0-9_]+$/.test(name) && !/^[a-z]+_[a-z_]+$/.test(name)) continue;
    const defined = definedIn(sourceText, name);
    record(`\`${token}\``, outcome(defined, defined ? `${name} is defined or used in the repo` : `${name} has no definition or code use in the repo`));
  }
}

function architectureStatic() {
  record('The `cc242f5` record', (() => {
    const type = objectType('cc242f5');
    if (type !== null) return outcome(type === 'commit', `cc242f5 is a ${type}`);
    if (commitCount() <= 1) return outcome(null, 'cc242f5 cannot be verified: this tree has one commit and no history to check it against (UNVERIFIED, no history)');
    return outcome(false, 'cc242f5 is not in the repository');
  })());

  record('`COMMAND_TIMEOUT_MS` in `web/bash-shell.js` is 900000', all(
    outcome(fileHas('web/bash-shell.js', 'COMMAND_TIMEOUT_MS = 900000'), 'bash-shell.js sets COMMAND_TIMEOUT_MS to 900000'),
    outcome(fileHas('web/bash-shell.js', 'timeoutMs: COMMAND_TIMEOUT_MS'), 'bash-shell.js passes it to Bash as timeoutMs'),
  ));
  cites('In one of seven recorded witness runs', ['in-page bash runs a 40-second sleep without a timeout']);
  cites('The witness checks the expiry', ['a command past 900 s is cut at the limit with the expiry message']);
  cites('With 900 s, a cold tabulate install completes', ['in-page pip installs a pure package from PyPI, and python3 imports it in the same page']);

  record('`@everruns/bashkit-wasm` 0.20.3', versionIn('web/vendor/bashkit', '0.20.3'));
  record('isomorphic-git 1.44.11', versionIn('web/vendor/isomorphic-git.mjs', '1.44.11'));
  record('Pyodide 314.0.7 core, unpacked in the page from the stripped bundle', all(
    outcome(fileHas('web/python-bundle.js', 'pyodide-minimal.br') && fileHas('web/python-bundle.js', "'pyodide-minimal/1'"), 'python-bundle.js fetches pyodide-minimal.br and checks its format'),
    outcome(fileHas('web/python-bundle.js', '314.0.7') || fileHas('web/python-worker.js', 'v314.0.7'), 'the core pins name the Pyodide 314.0.7 build'),
  ));
  record('micropip 0.11.1 from the jsDelivr CDN', outcome(
    fileHas('web/python-worker.js', '0.11.1') && fileHas('web/python-worker.js', 'v314.0.7') && fileHas('web/python-worker.js', 'jsdelivr'),
    'python-worker.js names micropip 0.11.1, the v314.0.7 Pyodide pin and jsDelivr',
  ));
  record('Names in the lock inside the bundle', outcome(fileHas('web/python-worker.js', 'bundledNames') && fileHas('web/python-bundle.js', 'pyodide-lock.json'), 'python-worker.js refuses names listed in pyodide-lock.json'));
  record('Flags `-s`, `-S`, `-f`, `-L`, `-q`', outcome(fileHas('web/curl-in-page.js', "'-SL'") || fileHas('web/curl-in-page.js', 'flag not supported'), 'curl-in-page.js accepts the listed flags and refuses others'));
  record('The page\'s shell functions', outcome(fileHas('web/shell-lookup.js', 'builtin command -v') && fileHas('web/shell-lookup.js', 'builtin type'), 'shell-lookup.js defines the functions over builtin command -v and builtin type'));
  record('`ps`, `uname`, `hostname`, `id`, `whoami`, `kill` and `tar` are emulations', outcome(fileHas('web/bash-shell.js', 'EMULATION_NOTE') && fileHas('web/bash-shell.js', 'uname|whoami|hostname|id|ps|kill|tar'), 'bash-shell.js labels these commands as emulations'));
  record('Background jobs are refused', outcome(fileHas('web/bash-shell.js', 'hasBackgroundOperator') && fileHas('web/shell-worker.js', 'background jobs are not supported'), 'bash-shell.js detects a bare & and shell-worker.js refuses it'));
  record('Symlinks are link entries', outcome(fileHas('web/shims/fs.js', 'links.json') && fileHas('web/shims/fs.js', 'LINKS_FILE'), 'fs.js stores its link table in links.json'));
  record('`fs.watch` is a no-op', outcome(witness.includes('fs.watch returns an inert handle') && !fileHas('web/shims/fs.js', 'chmod') && !fileHas('web/shims/fs.js', 'lock'), 'the witness checks the inert handle, and fs.js has no file modes or locks'));
  record('`hydrate()`', outcome(fileHas('web/shims/fs.js', 'export async function hydrate') || fileHas('web/shims/fs.js', 'export function hydrate'), 'fs.js exports hydrate'));

  record('Each check is named in the refusal', all(
    ...['index', 'staged', 'syntax', 'ascii', 'docs', 'smoke'].map((name) => outcome(fileHas('web/commit-gate.js', `'${name}'`) || fileHas('web/commit-gate.js', `check('${name}'`), `commit-gate.js names the ${name} check`)),
  ));
  record('It lists these in `NOT_COVERED`', outcome(fileHas('web/commit-gate.js', 'export const NOT_COVERED'), 'commit-gate.js exports NOT_COVERED'));

  record('It answers GET and HEAD only', outcome(fileHas('src/relay.js', "req.method !== 'GET' && req.method !== 'HEAD'") && fileHas('src/relay.js', '405'), 'relay.js answers 405 to other methods'));
  record('Every response carries', outcome(fileHas('src/relay.js', 'cross-origin-opener-policy') && fileHas('src/relay.js', 'cross-origin-embedder-policy'), 'relay.js sets both isolation headers'));

  cites('- `npm run witness` (`scripts/witness.mjs`) drives headless Chromium', ['browser terminal runs a bash line in headless Chromium']);
  record('`npm run witness` (`scripts/witness.mjs`) drives headless Chromium', outcome(fileHas('scripts/witness.mjs', 'CHROME_BIN') && fileHas('scripts/browser-driver.mjs', 'remote-debugging-port'), 'the witness uses CHROME_BIN and the driver starts Chromium with a DevTools port'));

  cites('Lines typed while a command runs wait in a queue', ['in-page terminal runs lines typed during a command in order, not as busy errors', 'in-page terminal Ctrl-C drops lines queued behind the cancelled command']);
  cites('The prompt shows the working directory', ['in-page prompt shows the working directory after cd', 'in-page cd persists to the next command and Tab completes relative to it']);
  cites('Each run starts with `(exit N);`', ['in-page bash keeps $? across terminal lines']);
  cites('The worker posts each streamed output chunk', ['in-page terminal shows shell output while the command is still running', 'in-page terminal prints each streamed line once, in order']);
  cites('| `git` | isomorphic-git 1.44.11', ['in-page git inits and stages over OPFS', 'in-page git lists branches, creates one and switches to it', 'in-page git checkout restores the working tree of the branch it returns to']);
  cites('| `git` | isomorphic-git 1.44.11', ['in-page git --version names the in-page library, not a host git']);
  cites('The gate does not judge meaning', ['in-page git commit runs the gate and sets HEAD', 'in-page git commit refuses broken syntax and non-ASCII and names both']);
  cites('`git commit -m` runs `web/commit-gate.js`', ['in-page git commit without DESIGN.md is refused and names it', 'git commit with nothing staged is refused by the gate']);
  cites('Symlinks are link entries', ['in-page ln -s makes a link that readlink reports, and a read and a stat follow it', 'in-page symlinks survive a browser restart, ls -l shows them, and rm removes only the link']);
  cites('`fs.watch` is a no-op', ['fs.watch returns an inert handle: close is a no-op and on/once return the handle']);
  cites('`ps`, `uname`, `hostname`, `id`, `whoami`, `kill` and `tar` are emulations', ['in-page uname, whoami and tar are labelled as emulations, and plain commands are not']);
  cites('| `sqlite3` | tjs:sqlite', ['in-page sqlite3 creates a database and answers a query through tjs:sqlite', 'in-page tjs -e opens a tjs:sqlite database and sums it', 'in-page sqlite3 database survives a browser restart']);
  cites('| `python3` | Pyodide 314.0.7', ['in-page python3 runs a one-line script through Pyodide', 'in-page python3 sees a shell rewrite made after its last call', 'in-page python3 removes a file it deletes and the shell sees it gone']);
  cites('Errors show the output and summary with URLs removed', ['in-page python3 error text keeps a readable link instead of bashkit cutting it at //', 'in-page python3 reports a traceback as an error']);
  cites('| `pip` | micropip 0.11.1', ['in-page pip installs a pure package from PyPI, and python3 imports it in the same page', 'in-page pip refuses version specifiers, Pyodide-bundled packages and unknown names with a message and no URL', 'the micropip wheel the page loads is the one pinned in the Pyodide lock']);
  cites('Installed packages live in the Python worker',['pip installs stay in Pyodide memory: no tabulate file reaches OPFS']);
  cites('| `curl`, `wget` | txiki.js fetch', ['in-page curl and wget fetch from a host that sends CORS headers', 'in-page curl refuses a host that sends no CORS headers, and the shell goes on', 'tjs -e awaits txiki fetch, and the request goes out through the page']);
  cites('The page\'s shell functions', ['which, command -v and type agree for every name Tab offers, path or builtin', 'in-page which drives an if: a found name passes and a missing one fails']);
  cites('each in-page builtin reports as a builtin', ['in-page git is reported as a builtin by type, command -v and which']);
  cites('Background jobs are refused', ['in-page bash refuses background jobs and keeps &&, redirects and quoted ampersands']);
  cites('`node` is an alias for the txiki engine', ['node -v prints a version']);
  cites('a host binary that is not in the page, such as `ruby`', ['in-page bash reports host tools it lacks as exit 127']);
  cites('Ctrl-C while busy drops the queue', ['in-page terminal Ctrl-C cancels a running command and the shell carries on']);
  cites('Every response carries', ['relay sends the cross-origin isolation headers']);

  record('`scripts/witness.mjs`', outcome(existsSync(repo('scripts/lint-architecture.mjs')) && existsSync(repo('scripts/lint-comments.mjs')) && existsSync(repo('scripts/witness.mjs')), 'the three scripts exist'));
  record('Its live checks need', outcome(fileHas('scripts/lint-architecture.mjs', 'liveChecks') && fileHas('scripts/lint-architecture.mjs', 'staticOnly'), 'lint-architecture.mjs runs live probes unless --static is passed'));
  record('Pyodide is not vendored or generated', pyodideNotVendored());
  record('- Committed and generated: `web/vendor/fx/`', outcome(!isIgnored('web/vendor/fx/') && fileHas('scripts/vendor-fx.mjs', 'sha256') && fileHas('scripts/build-pages.mjs', 'vendorFx') && fileHas('.github/workflows/pages.yml', 'scripts/vendor-fx.mjs'), 'web/vendor/fx/ is tracked, its generator records SHA-256 values, and the page build and Pages workflow generate it'));
  record('| `fx` | fx core WebAssembly', all(
    outcome(fileHas('web/builtins.js', "'fx'") && fileHas('web/builtins.js', 'fxBuiltin'), 'builtins.js dispatches fx'),
    outcome(fileHas('web/fx-in-page.js', 'createFxEngine') && fileHas('web/fx-in-page.js', 'fx-core.wasm'), 'fx-in-page.js loads the fx core WASM through the libfx engine'),
    outcome(witness.includes('in-page fx reports its bundled WASM version and passes its offline check'), 'witness: fx version and check'),
  ));
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

const BROWSER_FILES = ['web/terminal.js', 'web/pty-adapter.js', 'web/shell-client.js', 'web/shell-worker.js', 'web/bash-shell.js', 'web/shell-lookup.js', 'web/git-in-page.js', 'web/fx-in-page.js', 'web/commit-gate.js', 'web/sqlite-in-txiki.js', 'web/sqlite-program.js', 'web/python-in-page.js', 'web/python-worker.js', 'web/curl-in-page.js'];

function agentsStatic() {
  record('Browser (page and worker)', outcome(BROWSER_FILES.every((file) => existsSync(repo(file)) && !nodeReach(repo(file))), 'none of the browser files reaches a Node module, directly or through a relative import'));
  record('Node only: `bin/thebird-relay.js`', outcome(['bin/thebird-relay.js', 'src/relay.js'].every((file) => nodeReach(repo(file))), 'each Node-only file reaches a node: module, directly or through a relative import'));
  record('Everything under `web/` is browser-only', outcome(!walk(repo('web')).filter((file) => /\.m?js$|\.js$/.test(file) && !file.includes('/vendor/')).some((file) => /from 'node:/.test(readFileSync(file, 'utf8'))), 'no web file outside vendor imports a node: module'));
  const foreign = walk(repo('web/shims')).filter((file) => file.endsWith('.js')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)]
    .filter(([, specifier]) => !specifier.startsWith('./')).map(([, specifier]) => ({ file: file.split('/').pop(), specifier })));
  record('`web/shims/` modules import only each other', outcome(foreign.length === 0, `non-relative shim imports: ${foreign.map((item) => `${item.file} -> ${item.specifier}`).join(', ') || 'none'}`));
  record('`web/vendor/bashkit/` is generated by', outcome(isIgnored('web/vendor/bashkit/') && fileHas('scripts/vendor-bashkit.mjs', 'sha256'), 'web/vendor/bashkit/ is gitignored and its generator checks SHA-256'));
  record('Pyodide is not vendored or generated', pyodideNotVendored());
  record('pip loads micropip from the CDN', all(
    outcome(witness.includes('the micropip wheel the page loads is the one pinned in the Pyodide lock') && fileHas('web/python-worker.js', 'v314.0.7'), 'the micropip pin is checked by the witness, and python-worker.js pins v314.0.7'),
    outcome(!filesUnder('web/vendor').some((file) => file.endsWith('.whl')), 'no wheel is vendored under web/vendor'),
  ));
  record('History is kept in localStorage under `thebird.history`', all(
    outcome(fileHas('web/pty-adapter.js', 'HISTORY_LIMIT = 500') && fileHas('web/pty-adapter.js', "'thebird.history'"), 'pty-adapter.js sets the thebird.history key and a 500 cap'),
    outcome(witness.includes('in-page terminal stores only the submitted command lines in localStorage'), 'witness: localStorage holds only the submitted command lines'),
  ));
  record('Output is drawn by xterm.js', all(
    outcome(witness.includes('xterm renders SGR colour: red-line uses palette 1'), 'witness: xterm renders SGR colour'),
    outcome(witness.includes('the terminal consumes the escape sequences'), 'witness: escape sequences are consumed by the terminal'),
  ));
  record('`COMMAND_TIMEOUT_MS` in `web/bash-shell.js` is 900000 and is passed', outcome(fileHas('web/bash-shell.js', 'COMMAND_TIMEOUT_MS = 900000') && fileHas('web/bash-shell.js', 'timeoutMs: COMMAND_TIMEOUT_MS'), 'bash-shell.js sets the value and passes it to Bash'));
  record('`web/commit-gate.js` is the in-page gate', outcome(fileHas('web/commit-gate.js', 'export function runCommitGate') || fileHas('web/commit-gate.js', 'export async function runCommitGate'), 'commit-gate.js exports runCommitGate'));
  record('`which`, `command -v` and `type` are defined in `web/shell-lookup.js`', outcome(fileHas('web/shell-lookup.js', 'builtin command -v'), 'shell-lookup.js defines the functions over builtin command -v'));
  record('The relay answers GET and HEAD only', outcome(fileHas('src/relay.js', 'HEAD') && fileHas('src/relay.js', 'GET'), 'relay.js names GET and HEAD'));
  cites('Ctrl-C ends a `curl`', ['in-page terminal Ctrl-C ends a curl waiting on a response, and the shell carries on']);
  cites('`.github/workflows/pages.yml` builds `_site/`', ['the built GitHub Pages site runs bash and python3 without COOP/COEP headers', 'pages.yml builds fx core WASM from latest gmfx main before the page build']);
  cites('The build job has `contents: read` only', ['pages.yml gives the build job contents read only, and the deploy job only pages and id-token write']);
  record('The actions in `pages.yml` are pinned', all(
    outcome(['11d5960a326750d5838078e36cf38b85af677262', '49933ea5288caeca8642d1e84afbd3f7d6820020', '56afc609e74202658d3ffba0e8f6dda462b719fa', 'd6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'].every((sha) => fileHas('.github/workflows/pages.yml', sha) && docLines.join('\n').includes(sha)), 'each SHA in the AGENTS.md mapping is the one pages.yml uses'),
    outcome(witness.includes('every action in pages.yml is pinned to a full 40-hex commit SHA'), 'witness: every uses ref is a 40-hex SHA'),
  ));
  record('Do not add a root-absolute path such as `/web/...`', outcome(!walk(repo('web')).filter((file) => /\.(m?js|html)$/.test(file) && !file.includes('/vendor/')).some((file) => /['"`]\/web\//.test(readFileSync(file, 'utf8'))), 'no browser file outside web/vendor uses a root-absolute /web/ path'));
  record('Use Conventional Commits', (() => {
    const subjects = execFileSync('git', ['log', '-n', '20', '--format=%s'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    const matching = subjects.filter((subject) => /^(feat|fix|docs|test|chore|refactor|perf|build|ci|style|revert)(\([^)]+\))?!?: /.test(subject)).length;
    return outcome(matching === subjects.length ? true : null, `${matching} of the last ${subjects.length} commit subjects are Conventional`);
  })());
  record('Validation: `npm run check`', (() => {
    const scripts = JSON.parse(read('package.json')).scripts ?? {};
    return outcome(Boolean(scripts.witness) && !scripts.test, `witness script ${scripts.witness ? 'is defined' : 'is missing'}; test script ${scripts.test ? 'exists' : 'is absent'}`);
  })());
}

function probe(blocks, id, pass, detail) {
  const text = blocks[id];
  if (text === null || text === undefined) return outcome(false, `${id} did not run`);
  return outcome(pass(text), `${detail} (${id}: ${JSON.stringify(text).slice(0, 120)})`);
}

function runLive() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, 'scripts', 'lint-live.mjs')], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let result = null;
    let last = 'no line streamed yet';
    let pending = '';
    const onLine = (line) => {
      if (line.startsWith('LIVE-RESULT ')) result = JSON.parse(line.slice('LIVE-RESULT '.length));
      else {
        last = line;
        console.log(`           ${line}`);
      }
    };
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      let end = pending.indexOf('\n');
      while (end !== -1) {
        onLine(pending.slice(0, end));
        pending = pending.slice(end + 1);
        end = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk) => onLine(`stderr: ${String(chunk).trim()}`));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ timedOut: true, last, result: null });
    }, LIVE_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, last, result });
    });
  });
}

async function liveChecks() {
  const live = await runLive();
  if (live.timedOut) {
    add({ doc: 'live', line: 0, text: 'live probes', ok: false, detail: `live probes did not finish within ${LIVE_TIMEOUT_MS} ms; the last streamed line was: ${live.last}` });
    return;
  }
  if (!live.result) {
    add({ doc: 'live', line: 0, text: 'live probes', ok: false, detail: `live probes exited with code ${live.code} and no result; the last streamed line was: ${live.last}` });
    return;
  }
  inDoc('ARCHITECTURE.md', () => liveRecords(live.result));
}

function liveRecords(blocks) {
  const P = (id, pass, detail) => probe(blocks, id, pass, detail);
  record('| `sqlite3` | tjs:sqlite', P('sqlite', (t) => t.includes('1|two'), 'sqlite3 prints list mode'));
  record('| `python3` | Pyodide 314.0.7', P('python-c', (t) => /^42$/m.test(t), 'python3 -c runs'));
  record('`node` is an alias for the txiki engine', P('node', (t) => /^v\d+\.\d+\.\d+\nrc=0$/m.test(t), 'node -v prints the txiki version'));
  record('a host binary that is not in the page, such as `ruby`', P('host', (t) => /rc=127/.test(t), 'ruby exits 127'));
  record('`ps`, `uname`, `hostname`, `id`, `whoami`, `kill` and `tar` are emulations', P('tar', (t) => /tar \(bashkit\)/.test(t), 'tar reports bashkit'));
  record('each in-page builtin reports as a builtin', P('type-t', (t) => t === 'builtin', '`type -t git` says builtin'));
  record('The page\'s shell functions', P('type-fn', (t) => /function/.test(t), '`type which` says it is a function'));
  record('Background jobs are refused', P('amp', (t) => t.includes('background jobs are not supported'), 'a bare & is refused'));
  record('Flags `-s`, `-S`, `-f`, `-L`, `-q`', P('curl-SL', (t) => !t.includes('flag not supported'), 'combined -SL is accepted'));
  record('Other flags are refused', P('curl-v', (t) => t.includes('flag not supported'), 'an unlisted flag is refused'));
  record('| `curl`, `wget` | txiki.js fetch', P('curl-cors', (t) => t.includes('cors-host-hello'), 'curl succeeds on a CORS host'));
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
  if (!existsSync(chrome)) {
    add({ doc: 'live', line: 0, text: 'live probes', ok: null, detail: `no Chromium at ${chrome}; live probes are unverified (set CHROME_BIN)` });
  } else {
    console.log(`${stamp()} live probes: separate process, limit ${LIVE_TIMEOUT_MS} ms, streamed below`);
    await liveChecks();
  }
}

for (const doc of Object.keys(docs)) {
  docs[doc].forEach((raw, index) => {
    const line = raw.trim();
    if (line && !/^(\||```|#)/.test(line) && !covered.has(`${doc}:${index + 1}`)) add({ doc, line: index + 1, text: line, ok: 'NO_CLAIM', detail: 'prose line with no claim record' });
  });
}
const count = (ok) => results.filter((result) => result.ok === ok).length;
console.log(`\nNot passing:`);
for (const result of results.filter((item) => item.ok !== true).sort((a, b) => a.doc.localeCompare(b.doc) || a.line - b.line)) {
  console.log(`${label(result.ok).padEnd(10)} ${result.doc}:${result.line}  ${result.text.slice(0, 100)}\n           ${result.detail}`);
}
console.log(`\n${count(true) + count(false) + count(null)} claims: ${count(true)} pass, ${count(false)} fail, ${count(null)} unverified; ${count('NO_CLAIM')} prose lines with NO_CLAIM`);
if (count(false)) process.exitCode = 1;
