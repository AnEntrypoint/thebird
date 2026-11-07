import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay } from '../src/relay.js';
import { runTerminal } from './browser-driver.mjs';
import { vendorBashkit } from './vendor-bashkit.mjs';
import { vendorPyodide } from './vendor-pyodide.mjs';
import { buildPages } from './build-pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const relay = await startRelay({});
check('relay serves the browser terminal page', (await fetch(relay.url)).status === 200);
const isolated = await fetch(relay.url);
check('relay sends the cross-origin isolation headers', isolated.headers.get('cross-origin-opener-policy') === 'same-origin' && isolated.headers.get('cross-origin-embedder-policy') === 'require-corp');
check('relay serves web files', (await fetch(relay.url + 'web/terminal.js')).status === 200 && (await fetch(relay.url + 'web/shell-worker.js')).status === 200);
check('relay refuses paths outside web', (await fetch(relay.url + 'web//etc/passwd')).status === 404 && (await fetch(relay.url + 'package.json')).status === 404 && (await fetch(relay.url + 'src/relay.js')).status === 404);
check('relay serves only GET and HEAD', (await fetch(relay.url, { method: 'POST', body: '{}' })).status === 405 && (await fetch(relay.url + 'web/terminal.js', { method: 'PUT' })).status === 405);

const { AnsiParser } = await import('../web/ansi.js');
const ansiParser = new AnsiParser();
const parsedWhole = ansiParser.push('\u001b[1;31mred\u001b[0m plain \u001b]0;title\u0007ok');
check('ansi parser keeps the text of escape sequences out of plain output', parsedWhole.map((segment) => segment.text).join('') === 'red plain ok' && parsedWhole[0].classes === 'fg-1 bold', JSON.stringify(parsedWhole));
const split = new AnsiParser();
const firstHalf = split.push('a\u001b[3');
const secondHalf = split.push('1;48;5;4mred\u001b[0m');
check('ansi parser carries a sequence split across chunks, and 256-colour indexes map to the palette', firstHalf.map((segment) => segment.text).join('') === 'a' && secondHalf.length === 1 && secondHalf[0].text === 'red' && secondHalf[0].classes === 'fg-1 bg-4', JSON.stringify([firstHalf, secondHalf]));

const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
if (existsSync(chrome)) {
  if (!existsSync(join(root, 'web', 'vendor', 'bashkit', 'bashkit_wasm_bg.wasm'))) await vendorBashkit();
  if (!existsSync(join(root, 'web', 'vendor', 'pyodide', 'pyodide.asm.wasm'))) await vendorPyodide();
  const profile = mkdtempSync(join(tmpdir(), 'thebird-profile-'));
  const terminal = (pairs, options = {}) => runTerminal({ chrome, profile, url: relay.url + '?' + new URLSearchParams(pairs).toString(), ...options });

  const hello = await terminal([['run', 'echo hello-ok'], ['run', 'sleep 40; echo slept-40']]);
  check('browser terminal runs a bash line in headless Chromium', hello.engine === 'ready' && hello.out.includes('hello-ok'));
  check('in-page bash runs a 40-second sleep without a timeout', /^slept-40$/m.test(hello.out), hello.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const SITE_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' };
  const pagesDir = await buildPages(mkdtempSync(join(tmpdir(), 'thebird-site-')));
  const pagesServer = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const rest = pathname.startsWith('/thebird/') ? pathname.slice('/thebird/'.length) || 'index.html' : null;
    const file = rest === null ? null : join(pagesDir, rest);
    if (!file || !file.startsWith(pagesDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': SITE_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => pagesServer.listen(0, '127.0.0.1', resolve));
  const pagesUrl = `http://127.0.0.1:${pagesServer.address().port}/thebird/`;
  const pagesResponse = await fetch(pagesUrl);
  const site = await runTerminal({ chrome, profile, url: pagesUrl + '?' + new URLSearchParams([['run', 'echo pages-ok'], ['run', 'python3 -c "print(6*7)"']]).toString(), timeoutMs: 180000 });
  pagesServer.close();
  rmSync(pagesDir, { recursive: true, force: true });
  check('the built GitHub Pages site runs bash and python3 without COOP/COEP headers', site.engine === 'ready' && /^pages-ok$/m.test(site.out) && /^42$/m.test(site.out) && pagesResponse.headers.get('cross-origin-opener-policy') === null && pagesResponse.headers.get('cross-origin-embedder-policy') === null, site.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const after = await terminal([['run', 'mkdir -p notes && echo opfs-hello > notes/a.txt'], ['run', 'ls notes']]);
  check('in-page bash writes and lists files over OPFS', after.engine === 'ready' && /^a\.txt$/m.test(after.out), after.out.split('\n').slice(0, 3).join(' / ').slice(0, 140));
  const reloaded = await terminal([['run', 'cat notes/a.txt']]);
  check('the OPFS file survives a browser restart', reloaded.engine === 'ready' && reloaded.out.includes('opfs-hello'));
  const script = await terminal([['run', 'cat notes/a.txt | tr a-z A-Z > notes/upper.txt && cat notes/upper.txt']]);
  check('in-page bash runs a script over the OPFS tree', script.out.includes('OPFS-HELLO'), script.out.split('\n').slice(-2).join(' / ').slice(0, 120));
  const links = await terminal([['run', 'mkdir -p notes/links && echo link-target > notes/links/target.txt && ln -s target.txt notes/links/alias.txt && readlink notes/links/alias.txt && cat notes/links/alias.txt && test -f notes/links/alias.txt && echo stat-follows && echo via-link > notes/links/alias.txt && cat notes/links/target.txt']]);
  check('in-page ln -s makes a link that readlink reports, and a read and a stat follow it', /^target\.txt$/m.test(links.out) && /^link-target$/m.test(links.out) && /^stat-follows$/m.test(links.out) && /^via-link$/m.test(links.out), links.out.split('\n').slice(-4).join(' / ').slice(0, 160));
  const kept = await terminal([['run', 'readlink notes/links/alias.txt && cat notes/links/alias.txt && ls -l notes/links && rm notes/links/alias.txt && test -L notes/links/alias.txt || echo link-removed && cat notes/links/target.txt']]);
  check('in-page symlinks survive a browser restart, ls -l shows them, and rm removes only the link', /^target\.txt$/m.test(kept.out) && /^via-link$/m.test(kept.out) && /alias\.txt -> target\.txt/.test(kept.out) && /^link-removed$/m.test(kept.out) && kept.out.split('\n').filter((line) => line === 'via-link').length === 2, kept.out.split('\n').slice(-4).join(' / ').slice(0, 160));
  const ansiCommand = "printf '\\033[31mred-line\\033[0m\\n\\033[1;4;42mstyled-line\\033[0m\\n'";
  const ansiPlain = await terminal([['run', ansiCommand]]);
  const plainLines = ansiPlain.out.split('\n').filter((line) => !line.startsWith('thebird> '));
  check('ANSI off by default: escape sequences are stripped and the text copies as plain', plainLines.includes('red-line') && plainLines.includes('styled-line') && !plainLines.some((line) => line.includes('[31m') || line.includes('[0m')) && !ansiPlain.out.includes('\u001b') && ansiPlain.spans.length === 0, plainLines.slice(0, 3).join(' / ').slice(0, 160));
  const ansiColour = await terminal([['ansi', 'color'], ['run', ansiCommand]]);
  const coloured = (cls, text) => ansiColour.spans.some((span) => span.cls === cls && span.text === text);
  check('?ansi=color renders SGR colour and style as classed spans, and the copied text stays plain', coloured('fg-1', 'red-line') && coloured('bg-2 bold underline', 'styled-line') && !ansiColour.out.split('\n').filter((line) => !line.startsWith('thebird> ')).some((line) => line.includes('[31m')) && ansiColour.spans.length >= 2, JSON.stringify(ansiColour.spans).slice(0, 160));
  const host = await terminal([['run', 'node -v']]);
  check('in-page bash reports host tools it lacks as exit 127', host.out.includes('node: command not found'));

  const corsHost = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('cors-host-hello\n'); });
  const plainHost = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('plain-host-hello\n'); });
  for (const server of [corsHost, plainHost]) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const corsPort = corsHost.address().port;
  const plainPort = plainHost.address().port;
  const fetched = await terminal([
    ['run', `curl -s http://127.0.0.1:${corsPort}/hello`],
    ['run', `wget -O notes/fetched.txt http://127.0.0.1:${corsPort}/hello`],
    ['run', 'cat notes/fetched.txt'],
  ]);
  check('in-page curl and wget fetch from a host that sends CORS headers', fetched.out.split('\n').filter((line) => line === 'cors-host-hello').length >= 2, fetched.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const refused = await terminal([
    ['run', `curl -s http://127.0.0.1:${plainPort}/hello`],
    ['run', 'echo after-refusal'],
  ]);
  check('in-page curl refuses a host that sends no CORS headers, and the shell goes on', refused.out.includes(`could not fetch from 127.0.0.1:${plainPort}`) && refused.out.includes('CORS') && /^after-refusal$/m.test(refused.out) && !/^plain-host-hello$/m.test(refused.out), refused.out.split('\n').find((line) => line.includes('could not fetch'))?.slice(0, 160) ?? 'no refusal line');
  for (const server of [corsHost, plainHost]) server.close();

  const status = await terminal([['run', 'false'], ['run', 'echo rc=$?'], ['run', '(exit 3)'], ['run', 'echo rc=$?'], ['run', 'true'], ['run', 'echo rc=$?']]);
  const statuses = status.out.match(/^rc=\d+$/gm) ?? [];
  check('in-page bash keeps $? across terminal lines', statuses.join(' ') === 'rc=1 rc=3 rc=0', statuses.join(' ') || status.out.slice(0, 140));
  const version = await terminal([['run', 'git --version']]);
  check('in-page git --version names the in-page library, not a host git', /^git version \S+ \(in-page, isomorphic-git\)$/m.test(version.out), version.out.split('\n').find((line) => line.startsWith('git')) ?? version.out.slice(0, 140));
  const repo = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', 'git init'],
    ['run', 'echo one > notes/a.txt'],
    ['run', 'echo readme > README.md'],
    ['run', 'echo agents > AGENTS.md'],
    ['run', 'echo arch > ARCHITECTURE.md'],
    ['run', 'git add notes/a.txt README.md AGENTS.md ARCHITECTURE.md'],
    ['run', 'git commit -m first'],
    ['run', 'echo design > DESIGN.md'],
    ['run', 'git add DESIGN.md'],
    ['run', 'git commit -m first'],
    ['run', 'git log'],
  ]);
  check('in-page git commit without DESIGN.md is refused and names it', repo.out.includes('commit refused by the in-page gate') && repo.out.includes('DESIGN.md is not in the commit'), repo.out.split('\n').find((line) => line.includes('DESIGN.md is not in the commit'))?.slice(0, 160) ?? 'no refusal line');
  check('in-page git inits and stages over OPFS', repo.engine === 'ready' && repo.out.includes('initialized empty repository') && repo.out.includes('staged 1 path'), repo.out.split('\n').slice(0, 3).join(' / ').slice(0, 140));
  const committedSha = repo.out.match(/committed ([0-9a-f]{7})/)?.[1];
  const headSha = repo.out.match(/^([0-9a-f]{7}) first$/m)?.[1];
  check('in-page git commit runs the gate and sets HEAD', repo.out.includes('gate smoke:') && repo.out.includes('gate syntax:') && committedSha !== undefined && committedSha === headSha, `committed ${committedSha} / log HEAD ${headSha}`);
  const branchOne = await terminal([
    ['run', 'git branch'],
    ['run', 'git branch feature-x'],
    ['run', 'git checkout feature-x'],
    ['run', 'git status'],
    ['run', 'echo branch-change > notes/a.txt'],
    ['run', 'git add notes/a.txt'],
    ['run', 'git commit -m branch-change'],
    ['run', 'git branch'],
  ]);
  const original = branchOne.out.match(/^\* (\S+)$/m)?.[1];
  check('in-page git lists branches, creates one and switches to it', original !== undefined && branchOne.out.includes('created branch feature-x') && branchOne.out.includes('switched to feature-x') && /^## feature-x$/m.test(branchOne.out) && /^\* feature-x$/m.test(branchOne.out), `original ${original}`);
  const branchTwo = await terminal([
    ['run', `git checkout ${original ?? 'missing'}`],
    ['run', 'cat notes/a.txt'],
    ['run', 'git status'],
    ['run', 'git checkout no-such-branch'],
    ['run', 'git branch'],
  ]);
  check('in-page git checkout restores the working tree of the branch it returns to', original !== undefined && branchTwo.out.includes(`switched to ${original}`) && /^one$/m.test(branchTwo.out) && !/^branch-change$/m.test(branchTwo.out) && new RegExp(`^\\* ${original}$`, 'm').test(branchTwo.out), branchTwo.out.split('\n').slice(0, 4).join(' / ').slice(0, 160));
  check('in-page git checkout refuses an unknown branch and leaves HEAD where it was', /^git: Could not find .*no-such-branch/m.test(branchTwo.out) && !branchTwo.out.includes('switched to no-such-branch') && new RegExp(`^\\* ${original}$`, 'm').test(branchTwo.out), branchTwo.out.split('\n').find((line) => line.includes('no-such-branch') && !line.startsWith('thebird>'))?.slice(0, 160) ?? 'no refusal line');
  const broken = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', 'git init'],
    ['run', 'echo "const =" > notes/bad.js'],
    ['run', 'echo café > notes/u.txt'],
    ['run', 'git add notes/bad.js notes/u.txt'],
    ['run', 'git commit -m broken'],
  ]);
  check('in-page git commit refuses broken syntax and non-ASCII and names both', broken.out.includes('commit refused by the in-page gate') && broken.out.includes('syntax:') && broken.out.includes('ascii:'), broken.out.split('\n').find((line) => line.includes('refused by the in-page gate'))?.slice(0, 160) ?? 'no refusal line');
  const background = await terminal([
    ['run', 'echo refused-line & echo should-not-run'],
    ['run', 'echo and-ok && echo and-ok2'],
    ['run', 'echo redir-ok 2>&1'],
    ['run', 'echo "quoted & kept"'],
  ]);
  check('in-page bash refuses background jobs and keeps &&, redirects and quoted ampersands', background.out.includes('background jobs are not supported') && !/^should-not-run$/m.test(background.out) && /^and-ok2$/m.test(background.out) && /^redir-ok$/m.test(background.out) && /^quoted & kept$/m.test(background.out), background.out.split('\n').find((line) => line.includes('background jobs')) ?? 'no refusal line');
  const recalled = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const value = () => evaluate("document.getElementById('line').value");
      await type('echo first-typed');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'");
      await type('echo second-typed');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'");
      await press('ArrowUp');
      recalled.up1 = await value();
      await press('ArrowUp');
      recalled.up2 = await value();
      await press('ArrowDown');
      recalled.down1 = await value();
      await press('ArrowDown');
      recalled.down2 = await value();
    },
  });
  check('in-page terminal recalls submitted commands with the up and down arrows', recalled.up1 === 'echo second-typed' && recalled.up2 === 'echo first-typed' && recalled.down1 === 'echo second-typed' && recalled.down2 === '', JSON.stringify(recalled));
  const cancelled = {};
  const interrupted = await terminal([], {
    interact: async ({ type, press, waitFor }) => {
      await type('for i in $(seq 1 200); do sleep 0.1; done');
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'");
      const started = Date.now();
      await press('c', { ctrl: true });
      await waitFor("document.body.dataset.busy !== 'true'", 40000);
      cancelled.elapsed = Date.now() - started;
      await type('echo after-cancel');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'");
    },
  });
  check('in-page terminal Ctrl-C cancels a running command and the shell carries on', interrupted.out.includes('^C') && cancelled.elapsed < 10000 && /^after-cancel$/m.test(interrupted.out), `cancel took ${cancelled.elapsed} ms`);
  const completed = {};
  const listed = await terminal([
    ['run', 'mkdir -p notes/tab'],
    ['run', 'echo alpha > notes/tab/alpha.txt'],
    ['run', 'echo beta > notes/tab/beta.txt'],
  ], {
    interact: async ({ type, press, evaluate }) => {
      const value = () => evaluate("document.getElementById('line').value");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 800));
      await type('cat notes/fetc');
      await press('Tab');
      await settle();
      completed.unique = await value();
      await evaluate("document.getElementById('line').value = ''");
      await type('ls no');
      await press('Tab');
      await settle();
      completed.directory = await value();
      await evaluate("document.getElementById('line').value = ''");
      await type('cat notes/tab/');
      await press('Tab');
      await settle();
      completed.listed = await value();
    },
  });
  check('in-page terminal completes a unique file name with Tab and adds a space', completed.unique === 'cat notes/fetched.txt ', JSON.stringify(completed.unique));
  check('in-page terminal completes a directory with a trailing slash', completed.directory === 'ls notes/', JSON.stringify(completed.directory));
  check('in-page terminal lists several matches when Tab cannot finish a name', /notes\/tab\/alpha\.txt {2}notes\/tab\/beta\.txt/.test(listed.out) && completed.listed === 'cat notes/tab/', JSON.stringify(completed.listed));
  const moved = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const value = () => evaluate("document.getElementById('line').value");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
      await type('cd notes');
      await press('Enter');
      await waitFor("document.getElementById('prompt').textContent === 'thebird /workspace/notes> '", 20000);
      moved.prompt = await evaluate("document.getElementById('prompt').textContent");
      await type('pwd');
      await press('Enter');
      await settle();
      moved.out = await evaluate("document.getElementById('out').textContent");
      await type('cat fetc');
      await press('Tab');
      await settle();
      moved.completed = await value();
    },
  });
  check('in-page prompt shows the working directory after cd', moved.prompt === 'thebird /workspace/notes> ', JSON.stringify(moved.prompt));
  check('in-page cd persists to the next command and Tab completes relative to it', /^\/workspace\/notes$/m.test(moved.out) && moved.completed === 'cat fetched.txt ', JSON.stringify(moved.completed));
  const queued = await terminal([], {
    interact: async ({ type, press, waitFor }) => {
      await type('for i in $(seq 1 20); do sleep 0.1; done');
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'", 20000);
      await type('echo queued-one');
      await press('Enter');
      await type('echo queued-two');
      await press('Enter');
      await waitFor("document.getElementById('out').textContent.includes('queued-two')", 40000);
    },
  });
  const firstQueued = queued.out.indexOf('\nqueued-one\n');
  check('in-page terminal runs lines typed during a command in order, not as busy errors', firstQueued !== -1 && queued.out.indexOf('\nqueued-two\n') > firstQueued && !queued.out.includes('busy'), queued.out.split('\n').filter((line) => line.startsWith('queued')).join(' / '));
  const dropped = await terminal([], {
    interact: async ({ type, press, waitFor }) => {
      await type('for i in $(seq 1 100); do sleep 0.1; done');
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'", 20000);
      await type('echo dropped-line');
      await press('Enter');
      await press('c', { ctrl: true });
      await waitFor("document.body.dataset.busy !== 'true'", 40000);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    },
  });
  check('in-page terminal Ctrl-C drops lines queued behind the cancelled command', !/^dropped-line$/m.test(dropped.out) && dropped.out.includes('^C'), dropped.out.split('\n').filter((line) => line === '^C' || line.includes('dropped')).join(' / ').slice(0, 140));
  let heldRequests = 0;
  const holdServer = createServer(() => { heldRequests++; });
  await new Promise((resolve) => holdServer.listen(0, '127.0.0.1', resolve));
  const held = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      await type(`curl -s http://127.0.0.1:${holdServer.address().port}/held`);
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'", 20000);
      const reachedBy = Date.now() + 20000;
      while (heldRequests === 0 && Date.now() < reachedBy) await new Promise((resolve) => setTimeout(resolve, 100));
      await press('c', { ctrl: true });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      held.busy = await evaluate("document.body.dataset.busy");
      held.echoed = (await evaluate("document.getElementById('out').textContent")).includes('^C');
    },
  });
  holdServer.closeAllConnections();
  holdServer.close();
  check('in-page terminal Ctrl-C does not end a curl waiting on a response, and the page stays busy', held.busy === 'true' && held.echoed && heldRequests > 0, `busy=${held.busy} ^C echoed=${held.echoed} requests reaching the held server=${heldRequests}`);
  const editing = {};
  await terminal([['run', 'echo before-clear']], {
    interact: async ({ type, press, evaluate }) => {
      const value = () => evaluate("document.getElementById('line').value");
      const caret = () => evaluate("document.getElementById('line').selectionStart");
      await type('echo discarded');
      await press('u', { ctrl: true });
      editing.cleared = await value();
      await type('echo caret');
      await press('a', { ctrl: true });
      editing.start = await caret();
      await press('e', { ctrl: true });
      editing.end = await caret();
      editing.endLength = (await value()).length;
      await evaluate("document.getElementById('line').value = ''");
      await press('l', { ctrl: true });
      editing.afterClear = await evaluate("document.getElementById('out').textContent");
    },
  });
  check('in-page terminal Ctrl-U clears the line, and Ctrl-A and Ctrl-E move the caret to its ends', editing.cleared === '' && editing.start === 0 && editing.end === editing.endLength && editing.endLength > 0, JSON.stringify({ cleared: editing.cleared, start: editing.start, end: editing.end, endLength: editing.endLength }));
  check('in-page terminal Ctrl-L clears the output', editing.afterClear === '', JSON.stringify(editing.afterClear.slice(0, 80)));
  const streaming = {};
  const ticks = await terminal([], {
    interact: async ({ type, press, waitFor, evaluate }) => {
      await type('for i in 1 2 3 4 5; do echo tick$i; sleep 0.4; done');
      await press('Enter');
      await waitFor("document.getElementById('out').textContent.includes('tick1')", 20000);
      streaming.busy = await evaluate("document.body.dataset.busy === 'true'");
      streaming.beforeLast = await evaluate("!document.getElementById('out').textContent.includes('tick5')");
      await waitFor("document.body.dataset.busy !== 'true'", 40000);
    },
  });
  const seen = ticks.out.match(/^tick[1-5]$/gm) ?? [];
  check('in-page terminal shows shell output while the command is still running', streaming.busy === true && streaming.beforeLast === true, JSON.stringify(streaming));
  check('in-page terminal prints each streamed line once, in order', seen.join(' ') === 'tick1 tick2 tick3 tick4 tick5', seen.join(' '));
  const storedBefore = {};
  await terminal([], {
    interact: async ({ type, press, waitFor, evaluate }) => {
      await type('echo kept-line');
      await press('Enter');
      await waitFor("/^kept-line$/m.test(document.getElementById('out').textContent)", 20000);
      storedBefore.raw = await evaluate("localStorage.getItem('thebird.history')");
    },
  });
  let storedLines = null;
  try {
    storedLines = JSON.parse(storedBefore.raw);
  } catch {
    storedLines = null;
  }
  check('in-page terminal stores only the submitted command lines in localStorage', Array.isArray(storedLines) && storedLines.at(-1) === 'echo kept-line' && storedLines.every((line) => typeof line === 'string' && !line.includes('\n')), JSON.stringify(storedBefore.raw?.slice(-120)));
  let recalledAfterReload;
  const reopenedHistory = await terminal([], {
    interact: async ({ press, evaluate }) => {
      await press('ArrowUp');
      recalledAfterReload = await evaluate("document.getElementById('line').value");
    },
  });
  check('in-page terminal recalls a submitted command after the page reloads', recalledAfterReload === 'echo kept-line' && reopenedHistory.out === '', JSON.stringify(recalledAfterReload));
  const commandTab = {};
  await terminal([], {
    interact: async ({ type, press, evaluate }) => {
      const value = () => evaluate("document.getElementById('line').value");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
      await type('pyth');
      await press('Tab');
      await settle();
      commandTab.python = await value();
      await evaluate("document.getElementById('line').value = ''");
      await type('sqli');
      await press('Tab');
      await settle();
      commandTab.sqlite = await value();
    },
  });
  check('in-page terminal completes a command name in command position with Tab', commandTab.python === 'python3 ' && commandTab.sqlite === 'sqlite3 ', JSON.stringify(commandTab));
  const completedRuns = await terminal([['run', 'mkdir -p notes'], ['run', 'sqlite3 notes/cmd.db "select 2+3"']]);
  check('a command completed by name really runs in-page', /^5$/m.test(completedRuns.out), completedRuns.out.split('\n').slice(-2).join(' / ').slice(0, 120));
  const listing = await terminal([], {
    interact: async ({ press }) => {
      await press('Tab');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    },
  });
  const offeredLine = listing.out.split('\n').filter((line) => line.includes('python3') && line.includes('sqlite3') && line.includes('  ')).pop() ?? '';
  const offered = offeredLine.split('  ').map((name) => name.trim()).filter(Boolean);
  const commandTable = await terminal([['run', `for n in ${offered.map((name) => `'${name}'`).join(' ')}; do command -v "$n" >/dev/null || echo missing-$n; done; echo all-checked`]]);
  check('every name Tab offers in command position resolves in-page, and the custom builtins are among them', offered.length > 200 && ['git', 'sqlite3', 'python3', 'curl', 'wget'].every((name) => offered.includes(name)) && /^all-checked$/m.test(commandTable.out) && !/^missing-/m.test(commandTable.out), `${offered.length} names; ` + commandTable.out.split('\n').filter((line) => /^(all-checked|missing)/.test(line)).join(' / ').slice(0, 160));
  const lookup = await terminal([['run', 'if which jq; then echo if-jq-found; fi; if which nosuch; then echo bad-nosuch; else echo if-nosuch-missing; fi; type git; type -t git; command -v git; which git']]);
  check('in-page which drives an if: a found name passes and a missing one fails', /^if-jq-found$/m.test(lookup.out) && /^if-nosuch-missing$/m.test(lookup.out) && !/^bad-nosuch$/m.test(lookup.out), lookup.out.split('\n').slice(-6).join(' / ').slice(0, 160));
  check('in-page git is reported as a builtin by type, command -v and which', /^git is a shell builtin$/m.test(lookup.out) && /^builtin$/m.test(lookup.out) && lookup.out.split('\n').filter((line) => line === 'git').length === 2, lookup.out.split('\n').slice(-5).join(' / ').slice(0, 160));
  const lookupChunks = [];
  for (let i = 0; i < offered.length; i += 40) lookupChunks.push(offered.slice(i, i + 40));
  const lookupTable = await terminal(lookupChunks.map((chunk) => ['run', `for n in ${chunk.map((name) => `'${name}'`).join(' ')}; do a=$(command -v "$n"); w=$(which "$n"); k=$(type -t "$n"); [ "$a" = "$w" ] || echo mismatch-which-$n; case "$a" in /*) [ "$k" = file ] || echo mismatch-kind-$n ;; *) case "$k" in builtin|keyword|function) ;; *) echo mismatch-kind-$n ;; esac ;; esac; done; echo lookup-chunk-done`]));
  const chunksDone = lookupTable.out.split('\n').filter((line) => line === 'lookup-chunk-done').length;
  check('which, command -v and type agree for every name Tab offers, path or builtin', chunksDone === lookupChunks.length && !/^mismatch-/m.test(lookupTable.out), `${chunksDone}/${lookupChunks.length} chunks; ` + lookupTable.out.split('\n').filter((line) => /^mismatch-/.test(line)).slice(0, 4).join(' / ').slice(0, 160));
  const emulated = await terminal([['run', 'uname -s'], ['run', 'echo plain-line'], ['run', 'whoami'], ['run', 'tar --version']]);
  const notes = emulated.out.split('in-page emulations').length - 1;
  check('in-page uname, whoami and tar are labelled as emulations, and plain commands are not', notes === 3 && /^Linux$/m.test(emulated.out) && /^plain-line$/m.test(emulated.out) && /^tar \(bashkit\) /m.test(emulated.out), `notes ${notes}`);
  const sqlite = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', 'sqlite3 notes/app.db "create table t(x)"'],
    ['run', 'sqlite3 notes/app.db "insert into t values (1),(2),(3)"'],
    ['run', 'sqlite3 notes/app.db "select sum(x) from t"'],
  ]);
  check('in-page sqlite3 creates a database and answers a query through sql.js', sqlite.engine === 'ready' && /^6$/m.test(sqlite.out), sqlite.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const reopened = await terminal([['run', 'sqlite3 notes/app.db "select count(*) from t"']]);
  check('in-page sqlite3 database survives a browser restart', /^3$/m.test(reopened.out), reopened.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const python = await terminal([
    ['run', 'python3 -c "print(6*7)"'],
    ['run', 'python3 -c "1/0"'],
    ['run', 'echo py-hello > notes/in.txt'],
    ['run', `echo "open('notes/out.txt','w').write(open('notes/in.txt').read().upper())" > notes/script.py`],
    ['run', 'python3 notes/script.py'],
    ['run', 'cat notes/out.txt'],
  ]);
  check('in-page python3 runs a one-line script through Pyodide', python.engine === 'ready' && /^42$/m.test(python.out), python.out.split('\n').slice(0, 2).join(' / ').slice(0, 140));
  const linkError = await terminal([['run', `python3 -c "raise ValueError('see https://example.org/docs')"`]]);
  check('in-page python3 error text keeps a readable link instead of bashkit cutting it at //', !linkError.out.includes('<path>') && /ValueError: see example\.org\/docs$/m.test(linkError.out), linkError.out.split('\n').find((line) => line.includes('ValueError')) ?? 'no error line');
  check('in-page python3 reports a traceback as an error', python.out.includes('ZeroDivisionError'), python.out.split('\n').find((line) => line.includes('ZeroDivisionError'))?.slice(0, 140) ?? 'no traceback');
  const pipLock = JSON.parse(readFileSync(join(root, 'web', 'vendor', 'pyodide', 'pyodide-lock.json'), 'utf8'));
  check('the micropip wheel the page loads is the one pinned in the Pyodide lock', readFileSync(join(root, 'web', 'python-in-page.js'), 'utf8').includes(`'${pipLock.packages.micropip.file_name}'`), pipLock.packages.micropip.file_name);
  const pipInstall = await terminal([
    ['run', 'pip install tabulate && python3 -c "import tabulate; print(tabulate.__version__)"'],
    ['run', 'pip install tabulate==0.9.0'],
    ['run', 'pip install six'],
    ['run', 'pip install definitely-not-a-real-package-xyz'],
  ]);
  const pipInstalled = /^installed tabulate \S+$/m.test(pipInstall.out) && /^\d+\.\d+\.\d+$/m.test(pipInstall.out);
  check('in-page pip installs a pure package from PyPI, and python3 imports it in the same page', pipInstalled, pipInstalled ? 'tabulate installed and imported' : 'full pip output: ' + pipInstall.out.split('\n').filter((line) => line.trim()).join(' | ').slice(0, 900));
  const pipFiles = await terminal([['run', 'find /workspace -iname "*tabulate*" | wc -l']]);
  check('pip installs stay in Pyodide memory: no tabulate file reaches OPFS', /^0$/m.test(pipFiles.out), pipFiles.out.split('\n').slice(-2).join(' / ').slice(0, 120));
  check('in-page pip refuses version specifiers, Pyodide-bundled packages and unknown names with a message and no URL', pipInstall.out.includes('version specifiers and URLs are not supported') && pipInstall.out.includes('part of the Pyodide package set') && pipInstall.out.includes("Can't fetch metadata for 'definitely-not-a-real-package-xyz'") && !/https?:\/\//.test(pipInstall.out.split('\n').filter((line) => line.startsWith('pip')).join('\n')), pipInstall.out.split('\n').filter((line) => line.startsWith('pip')).join(' / ').slice(0, 200));
  check('in-page python3 reads and writes files on the OPFS tree', /^PY-HELLO$/m.test(python.out), python.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const pythonReopened = await terminal([['run', 'cat notes/out.txt'], ['run', `python3 -c "print(open('notes/out.txt').read().strip())"`]]);
  check('in-page python3 files survive a browser restart', pythonReopened.out.split('\n').filter((line) => line === 'PY-HELLO').length >= 2, pythonReopened.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const incremental = await terminal([
    ['run', 'echo one > notes/inc.txt'],
    ['run', `python3 -c "print(open('notes/inc.txt').read().strip())"`],
    ['run', 'echo two > notes/inc.txt'],
    ['run', `python3 -c "print(open('notes/inc.txt').read().strip())"`],
    ['run', `python3 -c "import os; os.remove('notes/inc.txt')"`],
    ['run', `python3 -c "import os; print(os.path.exists('notes/inc.txt'))"`],
    ['run', 'echo three > notes/inc.txt'],
    ['run', `python3 -c "print(open('notes/inc.txt').read().strip())"`],
  ]);
  const incLines = incremental.out.split('\n');
  check('in-page python3 sees a shell rewrite made after its last call', incLines.includes('one') && incLines.includes('two') && incLines.indexOf('two') > incLines.indexOf('one'), incLines.filter((line) => /^(one|two|three|True|False)$/.test(line)).join(' / '));
  check('in-page python3 removes a file it deletes and the shell sees it gone', incLines.includes('False') && incLines.includes('three'), incLines.filter((line) => /^(one|two|three|True|False)$/.test(line)).join(' / '));
  const warmCalls = Array.from({ length: 30 }, () => 'python3 -c "print(1)"').join('; ');
  const timed = await terminal([
    ['run', 'mkdir -p notes/bulk'],
    ['run', `python3 -c "[open('notes/bulk/f%d.txt' % i, 'w').write('x' * 200) for i in range(300)]"`],
    ['run', `python3 -c "print(0)"; t0=$(date +%s%N); ${warmCalls}; t1=$(date +%s%N); echo $(( (t1 - t0) / 1000000 ))`],
  ]);
  const totalMs = Number(timed.out.split('\n').filter((line) => /^\d+$/.test(line)).pop());
  check('python3 warm calls are timed in-page over 300 files and average under 5 ms', Number.isFinite(totalMs) && totalMs > 0 && totalMs / 30 < 5, `${totalMs} ms for 30 calls`);
  console.log(`python3 sync timing: 300 files, ${(totalMs / 30).toFixed(1)} ms per warm call (30 calls in-page)`);
  const expiry = await terminal([['run', 'for i in 1 2 3 4 5 6; do sleep 55; echo tick$i; done; echo late-finish']], { timeoutMs: 900000 });
  check('a command past 300 s is cut at the limit with the expiry message', expiry.out.includes('error: resource limit exceeded: execution timeout (300s)') && /^tick5$/m.test(expiry.out) && !/^late-finish$/m.test(expiry.out), expiry.out.split('\n').slice(-2).join(' / ').slice(0, 160));
  rmSync(profile, { recursive: true, force: true });
} else {
  console.log('SKIP browser checks — no Chromium at ' + chrome + ' (set CHROME_BIN)');
}

const seeded = await import('../web/shims/fs.js');
const watcher = seeded.watch();
const chained = watcher.on('change', () => {}) === watcher && watcher.once('change', () => {}) === watcher;
check('fs.watch returns an inert handle: close is a no-op and on/once return the handle', typeof watcher.close === 'function' && chained && watcher.close() === undefined);
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

const architecture = spawnSync(process.execPath, [join(root, 'scripts', 'lint-architecture.mjs'), '--static'], { cwd: root, encoding: 'utf8', timeout: 120000 });
const architectureFailures = architecture.stdout.split('\n').filter((line) => line.startsWith('FAIL')).length;
check('ARCHITECTURE.md and AGENTS.md claims have no contradictions with the code', architecture.status === 0 && architectureFailures === 0, architectureFailures ? `${architectureFailures} claim(s) fail; run node scripts/lint-architecture.mjs` : architecture.stdout.split('\n').at(-2) ?? '');
const comments = spawnSync(process.execPath, [join(root, 'scripts', 'lint-comments.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000 });
check('repo-owned code has no comments (scripts/lint-comments.mjs)', comments.status === 0 && /repo-owned files checked: 0 comments;/.test(comments.stdout), comments.stdout.split('\n').filter((line) => line.startsWith('FAIL')).slice(0, 3).join('; ') || comments.stdout.trim().split('\n').at(-1));
const vendoredLines = comments.stdout.split('\n').filter((line) => line.startsWith('VENDORED'));
check('every vendored bundle with comments has a provenance witness (licence grant and upstream name)', comments.status === 0 && vendoredLines.length > 0 && vendoredLines.every((line) => line.includes('(MIT grant), upstream named')) && !comments.stdout.includes('FAIL'), vendoredLines.map((line) => line.split(':')[0].replace('VENDORED ', '')).join(', ') || 'no vendored bundle reported');
const workflow = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
const scopesIn = (text, indent) => Object.fromEntries([...text.matchAll(new RegExp(`^ {${indent}}([a-z-]+): (read|write)$`, 'gm'))].map((m) => [m[1], m[2]]));
const jobsSection = workflow.slice(workflow.indexOf('\njobs:') + 1);
const jobHeaders = [...jobsSection.matchAll(/^ {2}([a-z]+):\n/gm)];
const jobBlocks = Object.fromEntries(jobHeaders.map((m, i) => [m[1], jobsSection.slice(m.index + m[0].length, jobHeaders[i + 1]?.index ?? jobsSection.length)]));
const topScopes = scopesIn(workflow.slice(0, workflow.indexOf('\njobs:')), 2);
const buildScopes = scopesIn(jobBlocks.build ?? '', 6);
const deployScopes = scopesIn(jobBlocks.deploy ?? '', 6);
const sortedScopes = (scopes) => JSON.stringify(Object.entries(scopes).sort());
const usesRefs = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
check('every action in pages.yml is pinned to a full 40-hex commit SHA', usesRefs.length > 0 && usesRefs.every((ref) => /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(ref)), usesRefs.join(' '));
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
const pinnedUses = (text) => [...text.matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map((m) => ({ action: m[1], sha: m[2] }));
const recordedPins = (text) => [...text.matchAll(/(actions\/[\w.-]+) `([0-9a-f]{40})` \((v\d+)\)/g)].map((m) => ({ action: m[1], sha: m[2], version: m[3] }));
const pinMismatches = (workflowText, agentsText) => {
  const pins = pinnedUses(workflowText);
  const rows = recordedPins(agentsText);
  const found = [];
  if (pins.length === 0 || rows.length !== pins.length) found.push(`count pinned=${pins.length} recorded=${rows.length}`);
  for (const pin of pins) if (!rows.some((row) => row.action === pin.action && row.sha === pin.sha)) found.push(`${pin.action}@${pin.sha.slice(0, 7)} is not recorded in AGENTS.md`);
  for (const row of rows) if (!pins.some((pin) => pin.action === row.action && pin.sha === row.sha)) found.push(`${row.action} ${row.sha.slice(0, 7)} (${row.version}) is not used in pages.yml`);
  return found;
};
const localMismatches = pinMismatches(workflow, agents);
check('pages.yml SHAs match the AGENTS.md Hosting mapping (local, no network)', localMismatches.length === 0, localMismatches.length ? `mismatch: ${localMismatches.join('; ')}` : `${pinnedUses(workflow).length} pins match`);
const firstRow = recordedPins(agents)[0];
const flipped = (sha) => (sha[0] === '0' ? '1' : '0') + sha.slice(1);
const desyncedMapping = agents.replace(firstRow.sha, flipped(firstRow.sha));
const desyncedWorkflow = workflow.replace(firstRow.sha, flipped(firstRow.sha));
const caughtMapping = pinMismatches(workflow, desyncedMapping);
const caughtWorkflow = pinMismatches(desyncedWorkflow, agents);
check('negative witness: a desynced SHA in either the mapping or pages.yml is caught by the local check', desyncedMapping !== agents && desyncedWorkflow !== workflow && caughtMapping.length > 0 && caughtWorkflow.length > 0, `mapping caught: ${caughtMapping[0] ?? 'none'} | workflow caught: ${caughtWorkflow[0] ?? 'none'}`);
const lookupTag = (action, version) => {
  let reason = 'gh did not run';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = spawnSync('gh', ['api', `repos/${action}/git/ref/tags/${version}`, '-q', '.object.sha'], { encoding: 'utf8', timeout: 30000 });
    if (out.status === 0) return { resolved: out.stdout.trim() };
    reason = (out.stderr || out.error?.message || 'gh failed').trim().split('\n')[0];
    if (/HTTP 404/.test(reason)) return { missing: reason };
  }
  return { unavailable: reason };
};
const remote = recordedPins(agents).map((row) => ({ ...row, ...lookupTag(row.action, row.version) }));
const moved = remote.filter((row) => row.resolved && row.resolved !== row.sha);
const missingTags = remote.filter((row) => row.missing);
const unavailable = remote.filter((row) => row.unavailable);
if (moved.length || missingTags.length) {
  check('every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)', false, `drift: ${[...moved.map((row) => `${row.action}@${row.version} is ${row.resolved.slice(0, 7)}, pinned ${row.sha.slice(0, 7)}`), ...missingTags.map((row) => `${row.action}@${row.version} ${row.missing}`)].join('; ')}`);
} else if (unavailable.length) {
  console.log(`UNVERIFIED every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh): network-unavailable — ${unavailable[0].unavailable}`);
} else {
  check('every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)', true, remote.map((row) => `${row.action}@${row.version}=${row.resolved.slice(0, 7)}`).join(' '));
}
check('pages.yml gives the build job contents read only, and the deploy job only pages and id-token write', sortedScopes(topScopes) === sortedScopes({ contents: 'read' }) && sortedScopes(buildScopes) === sortedScopes({ contents: 'read' }) && sortedScopes(deployScopes) === sortedScopes({ pages: 'write', 'id-token': 'write' }), `top=${JSON.stringify(topScopes)} build=${JSON.stringify(buildScopes)} deploy=${JSON.stringify(deployScopes)}`);
await relay.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
