import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay } from '../src/relay.js';
import { runTerminal, withTimeout } from './browser-driver.mjs';
import { digest, openCheckpoint, PAUSED } from './witness-checkpoint.mjs';
import { vendorBashkit } from './vendor-bashkit.mjs';
import { vendorFx } from './vendor-fx.mjs';
import { vendorGm } from './vendor-gm.mjs';
import { vendorFloosie } from './vendor-floosie.mjs';
import { buildPages } from './build-pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COLD_START_MS = 900000;
const checkpoint = process.env.THEBIRD_WITNESS_CHECKPOINT ? openCheckpoint({ dir: resolve(process.env.THEBIRD_WITNESS_CHECKPOINT), root }) : null;
const recorded = checkpoint?.state.checks ?? [];
let checkCount = 0;
let callPassed = 0;
let callFailed = 0;
let failures = recorded.filter((entry) => !entry.ok).length;

function check(name, ok, detail = '') {
  const passed = Boolean(ok);
  const index = checkCount++;
  if (index < recorded.length) {
    if (recorded[index].name !== name || recorded[index].ok !== passed) {
      failures++;
      console.log(`FAIL replay diverged at check ${index + 1}: ${name}`);
    }
    return;
  }
  recorded.push({ name, ok: passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (passed) callPassed++;
  else {
    callFailed++;
    failures++;
  }
}
const portOf = (name) => checkpoint?.state.ports[name] ?? 0;
const rememberPort = (name, port) => {
  if (checkpoint) checkpoint.state.ports[name] = port;
};

const relay = await startRelay({ port: portOf('relay') });
rememberPort('relay', Number(new URL(relay.url).port));
check('relay serves the browser terminal page', (await fetch(relay.url)).status === 200);
const isolated = await fetch(relay.url);
check('relay sends the cross-origin isolation headers', isolated.headers.get('cross-origin-opener-policy') === 'same-origin' && isolated.headers.get('cross-origin-embedder-policy') === 'require-corp');
check('relay serves web files', (await fetch(relay.url + 'web/terminal.js')).status === 200 && (await fetch(relay.url + 'web/shell-worker.js')).status === 200);
check('relay refuses paths outside web', (await fetch(relay.url + 'web//etc/passwd')).status === 404 && (await fetch(relay.url + 'package.json')).status === 404 && (await fetch(relay.url + 'src/relay.js')).status === 404);
check('relay serves only GET and HEAD', (await fetch(relay.url, { method: 'POST', body: '{}' })).status === 405 && (await fetch(relay.url + 'web/terminal.js', { method: 'PUT' })).status === 405);

const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
if (existsSync(chrome)) {
  if (!existsSync(join(root, 'web', 'vendor', 'bashkit', 'bashkit_wasm_bg.wasm'))) await vendorBashkit();
  if (!existsSync(join(root, 'web', 'vendor', 'fx', 'fx-core.wasm'))) await vendorFx();
  if (!existsSync(join(root, 'web', 'vendor', 'gm', 'gm-core.wasm'))) await vendorGm();
  if (!existsSync(join(root, 'web', 'vendor', 'floosie', 'browser.js'))) await vendorFloosie();
  const profile = checkpoint ? checkpoint.profile : mkdtempSync(join(tmpdir(), 'thebird-profile-'));
  if (checkpoint) mkdirSync(profile, { recursive: true });
  const recordedRun = async (material, options) => {
    if (!checkpoint) return runTerminal({ chrome, profile, ...options });
    const index = checkpoint.state.terminals;
    const key = digest(JSON.stringify(material));
    const file = checkpoint.terminalFile(index);
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.key !== key) throw new Error(`checkpoint terminal ${index} does not match this witness`);
      return runTerminal({ replay: saved, interact: options.interact, timeoutMs: options.timeoutMs });
    }
    if (checkpoint.overBudget()) {
      checkpoint.save();
      console.log(`CALL ${checkpoint.state.calls} PAUSED before terminal ${index}: checks this call PASS ${callPassed} FAIL ${callFailed}`);
      process.exit(PAUSED);
    }
    const trace = [];
    const state = await runTerminal({ chrome, profile, ...options, trace });
    writeFileSync(file, `${JSON.stringify({ key, trace, state })}\n`);
    checkpoint.state.terminals = index + 1;
    checkpoint.save();
    return state;
  };
  const terminal = (pairs, options = {}) => {
    const { params = [], interact, ...rest } = options;
    const url = relay.url + '?' + new URLSearchParams([...pairs, ...params]).toString();
    return recordedRun({ url, pairs, params, ...rest }, { chrome, profile, url, timeoutMs: COLD_START_MS, interact, ...rest });
  };

  const hello = await terminal([['run', 'echo hello-ok'], ['run', 'sleep 40; echo slept-40'], ['run', 'playwriter --version'], ['run', 'which playwriter; command -v playwriter; type playwriter'], ['run', "playwriter frobnicate; echo after-frobnicate"]]);
  check('browser terminal runs a bash line in headless Chromium', hello.engine === 'ready' && hello.out.includes('hello-ok'));
  check('in-page bash runs a 40-second sleep without a timeout', /^slept-40$/m.test(hello.out), hello.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const helloLines = hello.out.split('\n');
  check('playwriter answers --version, and which, command -v and type agree that it is a shell builtin', helloLines.includes('birdman playwriter 0.1.0') && helloLines.filter((line) => line === 'playwriter').length >= 2 && helloLines.includes('playwriter is a shell builtin'), helloLines.filter((line) => /playwriter/.test(line)).join(' / ').slice(0, 140));
  check('playwriter names an unknown command and the shell goes on', hello.out.includes("playwriter: unknown command 'frobnicate'") && helloLines.includes('after-frobnicate'), helloLines.slice(-3).join(' / ').slice(0, 140));
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
  await new Promise((resolve) => pagesServer.listen(portOf('pages'), '127.0.0.1', resolve));
  rememberPort('pages', pagesServer.address().port);
  const pagesUrl = `http://127.0.0.1:${pagesServer.address().port}/thebird/`;
  const pagesResponse = await fetch(pagesUrl);
  const siteUrl = pagesUrl + '?' + new URLSearchParams([['run', 'echo pages-ok'], ['run', 'python3 -c "print(6*7)"'], ['run', 'qjs -e "console.log(1)"'], ['run', 'fx --version'], ['run', 'fx check'], ['run', 'which fx'], ['run', 'type -t fx'], ['run', 'gm --version'], ['run', 'gm check'], ['run', 'gm serve'], ['run', 'which gm'], ['run', 'type -t gm'], ['run', 'gm attach'], ['run', `gm stdio '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}'`], ['run', `gm stdio '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`], ['run', `gm stdio '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_code","arguments":{"body":"return 6*7;"}}}'`], ['run', `gm stdio '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"finish","arguments":{"witness":"browser hub check"}}}'`]]).toString();
  const site = await recordedRun({ url: siteUrl }, { chrome, profile, url: siteUrl, timeoutMs: COLD_START_MS });
  pagesServer.close();
  const quickjsArtifactGone = !existsSync(join(pagesDir, 'web', 'vendor', 'quickjs'));
  const fxArtifact = join(pagesDir, 'web', 'vendor', 'fx', 'fx-core.wasm');
  const fxArtifactShipped = existsSync(fxArtifact);
  const gmArtifact = join(pagesDir, 'web', 'vendor', 'gm', 'gm-core.wasm');
  const gmArtifactShipped = existsSync(gmArtifact);
  const floosieArtifact = join(pagesDir, 'web', 'vendor', 'floosie', 'browser.js');
  const floosieArtifactShipped = existsSync(floosieArtifact);
  const siteIndex = readFileSync(join(pagesDir, 'index.html'), 'utf8');
  const siteBundle = join(pagesDir, 'web', 'terminal.bundle.js');
  const bundleText = existsSync(siteBundle) ? readFileSync(siteBundle, 'utf8') : '';
  const moduleScripts = siteIndex.match(/<script type="module" src="[^"]+"/g) ?? [];
  check('the built page loads one bundled script that has no relative module imports, and runs', moduleScripts.length === 1 && moduleScripts[0].includes('web/terminal.bundle.js') && bundleText.length > 0 && !/^import\s.*from\s+['"]\.{1,2}\//m.test(bundleText), `${moduleScripts.join(' ')}; bundle ${bundleText.length} bytes`);
  rmSync(pagesDir, { recursive: true, force: true });
  check('the built site runs qjs -e through the txiki engine, and ships no quickjs artifact', quickjsArtifactGone && /^1$/m.test(site.out) && /^pages-ok$/m.test(site.out), site.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  check('in-page fx reports its bundled WASM version and passes its offline check', site.engine === 'ready' && /^fx-core\.wasm [0-9a-f]{12} libfx SDK 2$/m.test(site.out) && /^fx ready: JSPI (available|missing); core application\/wasm$/m.test(site.out) && /^fx$/m.test(site.out) && /^builtin$/m.test(site.out) && fxArtifactShipped, site.out.split('\n').slice(-8).join(' / ').slice(0, 220));
  check('in-page gm reports its bundled WASM version, passes its offline check and serves MCP methods', site.engine === 'ready' && /^gm-core\.wasm [0-9a-f]{12} C\+\+ core ABI 2$/m.test(site.out) && /^gm ready: core [0-9a-f]{12}; JSON and sha256 answered$/m.test(site.out) && /^gm MCP 2025-11-25: initialize, ping, tools\/list/m.test(site.out) && /"protocolVersion":"2025-11-25"/.test(site.out) && /value\\":42/.test(site.out) && /finished\\":true/.test(site.out) && /floosie hub: gm/.test(site.out) && floosieArtifactShipped && /^gm$/m.test(site.out) && /^builtin$/m.test(site.out) && gmArtifactShipped, site.out.split('\n').slice(-12).join(' / ').slice(0, 260));
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
  const styled = {};
  await terminal([['run', ansiCommand]], {
    interact: async ({ evaluate, waitFor }) => {
      await waitFor("globalThis.thebird.text().includes('styled-line')", 20000);
      const styleOf = (line) => evaluate(`(() => { const buffer = globalThis.thebird.term.buffer.active; for (let row = 0; row < buffer.length; row++) { const current = buffer.getLine(row); if (current.translateToString(true) === ${JSON.stringify(line)}) { const cell = current.getCell(0); return { fg: cell.getFgColor(), palette: cell.isFgPalette(), bg: cell.getBgColor(), bgPalette: cell.isBgPalette(), bold: Boolean(cell.isBold()), underline: Boolean(cell.isUnderline()) }; } } return null; })()`);
      styled.red = await styleOf('red-line');
      styled.styled = await styleOf('styled-line');
      styled.text = await evaluate('globalThis.thebird.text()');
    },
  });
  check('xterm renders SGR colour: red-line uses palette 1, styled-line is bold, underlined and on palette 2', styled.red?.palette === true && styled.red.fg === 1 && styled.styled?.bold === true && styled.styled.underline === true && styled.styled.bgPalette === true && styled.styled.bg === 2, JSON.stringify(styled));
  check('the terminal consumes the escape sequences, so the text carries none of them', /^red-line$/m.test(styled.text) && /^styled-line$/m.test(styled.text) && !styled.text.split('\n').filter((line) => !line.startsWith('thebird ')).some((line) => line.includes('[31m')), JSON.stringify(styled.text?.slice(0, 80)));
  const vt = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const typed = async (command) => {
        await type(command);
        await press('Enter');
        await waitFor("document.body.dataset.busy !== 'true'", 40000);
        await new Promise((resolve) => setTimeout(resolve, 300));
      };
      const lines = () => evaluate("globalThis.thebird.text().split('\\n').filter((line) => !line.startsWith('thebird '))");
      await typed("printf 'AAAA\\033[2DBB\\n'");
      vt.moved = (await lines()).includes('AABB');
      await typed("printf 'junk-row\\n\\033[2J\\033[Hclean-row\\n'");
      const cleared = await evaluate("(() => { const buffer = globalThis.thebird.term.buffer.active; return buffer.getLine(buffer.viewportY).translateToString(true); })()");
      vt.cleared = cleared === 'clean-row' && !(await lines()).includes('junk-row');
      await typed("printf '\\033[?1049halt-row\\n'");
      vt.alternate = await evaluate('globalThis.thebird.term.buffer.active.type');
      await typed("printf '\\033[?1049l'");
      vt.normal = await evaluate('globalThis.thebird.term.buffer.active.type');
      vt.altGone = !(await lines()).includes('alt-row');
      await typed("printf 'w%.0s' $(seq 1 200); echo");
      vt.wrapped = await evaluate("(() => { const buffer = globalThis.thebird.term.buffer.active; let rows = 0; for (let row = 0; row < buffer.length; row++) if (buffer.getLine(row).isWrapped) rows++; return rows; })()");
      vt.longLine = (await lines()).includes('w'.repeat(200));
      await evaluate('globalThis.thebird.term.resize(60, 20)');
      await typed('echo cols-$COLUMNS-lines-$LINES');
      vt.size = (await lines()).find((line) => line.startsWith('cols-'));
    },
  });
  check('xterm moves the cursor and clears the screen on the escape sequences', vt.moved === true && vt.cleared === true, JSON.stringify(vt));
  check('xterm enters and leaves the alternate screen, and the normal screen does not keep its text', vt.alternate === 'alternate' && vt.normal === 'normal' && vt.altGone === true, JSON.stringify(vt));
  check('a 200-character line wraps across rows and reads back as one line', vt.wrapped >= 2 && vt.longLine === true, JSON.stringify(vt));
  check('a terminal resize reaches the shell as COLUMNS and LINES', vt.size === 'cols-60-lines-20', JSON.stringify(vt.size));
  const scroll = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      await type('seq 1 300');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'", 40000);
      scroll.history = await evaluate('globalThis.thebird.term.buffer.active.baseY');
      await evaluate('globalThis.thebird.term.scrollLines(-50)');
      scroll.viewportUp = await evaluate('globalThis.thebird.term.buffer.active.viewportY');
      await press('l', { ctrl: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      scroll.historyAfterClear = await evaluate('globalThis.thebird.term.buffer.active.baseY');
      scroll.lineOneKept = await evaluate("globalThis.thebird.text().split('\\n').includes('1')");
    },
  });
  check('scrollback keeps history: wheel-style scrolling moves the viewport up, and Ctrl-L keeps the history and line 1', scroll.history > 0 && scroll.viewportUp < scroll.history && scroll.historyAfterClear > 0 && scroll.lineOneKept === true, JSON.stringify(scroll));
  const resized = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const fits = () => evaluate("(() => { const box = document.getElementById('terminal').getBoundingClientRect(); const screen = document.querySelector('.xterm-screen').getBoundingClientRect(); return { right: screen.right <= box.right + 0.5, bottom: screen.bottom <= box.bottom + 0.5 }; })()");
      resized.wide = await evaluate('globalThis.thebird.term.cols');
      resized.wideFit = await fits();
      await evaluate("document.getElementById('terminal').style.width = 'calc(50% - 8px)'");
      await new Promise((resolve) => setTimeout(resolve, 800));
      resized.narrow = await evaluate('globalThis.thebird.term.cols');
      resized.narrowFit = await fits();
      await type('echo cols-$COLUMNS');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'", 40000);
      resized.shellCols = await evaluate("globalThis.thebird.text().split('\\n').find((line) => line.startsWith('cols-'))");
    },
  });
  check('a container resize with no window resize changes the columns, the screen fits the box, and the shell sees the new COLUMNS', resized.narrow < resized.wide && resized.wideFit.right && resized.wideFit.bottom && resized.narrowFit.right && resized.narrowFit.bottom && resized.shellCols === 'cols-' + resized.narrow, JSON.stringify(resized));
  const palette = {};
  await terminal([
    ['run', "printf '\\033[38;5;196mX196\\033[0m\\n'"],
    ['run', "printf '\\033[38;2;255;0;0mRGB255\\033[0m\\n'"],
    ['run', "printf 'no-newline-yet'"],
    ['run', 'echo after-no-newline'],
  ], {
    interact: async ({ evaluate, waitFor }) => {
      await waitFor("globalThis.thebird.text().includes('after-no-newline')", 40000);
      const styleOf = (line) => evaluate(`(() => { const buffer = globalThis.thebird.term.buffer.active; for (let row = 0; row < buffer.length; row++) { const current = buffer.getLine(row); if (current.translateToString(true) === ${JSON.stringify(line)}) { const cell = current.getCell(0); return { fg: cell.getFgColor(), palette: Boolean(cell.isFgPalette()), rgb: Boolean(cell.isFgRGB()) }; } } return null; })()`);
      palette.x196 = await styleOf('X196');
      palette.rgb = await styleOf('RGB255');
      palette.lines = await evaluate("globalThis.thebird.text().split('\\n')");
    },
  });
  const noNewlineAt = palette.lines.indexOf('no-newline-yet');
  const alone = await terminal([['run', "printf 'alone-no-newline'"]]);
  const aloneLines = alone.out.split('\n');
  const aloneAt = aloneLines.indexOf('alone-no-newline');
  check('colour: a 256-colour index and a truecolour value reach the cell, and queued output starts its own row after unterminated output', palette.x196?.fg === 196 && palette.x196.palette === true && palette.rgb?.rgb === true && palette.rgb.fg === 0xff0000 && noNewlineAt !== -1 && palette.lines[noNewlineAt + 1] === 'after-no-newline', JSON.stringify({ x196: palette.x196, rgb: palette.rgb, around: palette.lines.slice(Math.max(noNewlineAt, 0), noNewlineAt + 3) }));
  check('colour: unterminated output is followed by the prompt on its own row', aloneAt !== -1 && aloneLines[aloneAt + 1]?.startsWith('thebird '), JSON.stringify(aloneLines.slice(-3)));
  const wideText = String.fromCodePoint(0x6c49, 0x5b57, 0x1f600) + 'x';
  const wide = {};
  await terminal([['run', "printf '" + wideText + "\\n'"]], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      await waitFor(`globalThis.thebird.text().split(String.fromCharCode(10)).includes(${JSON.stringify(wideText)})`, 40000);
      wide.cells = await evaluate(`(() => { const buffer = globalThis.thebird.term.buffer.active; const target = ${JSON.stringify(wideText)}; for (let row = 0; row < buffer.length; row++) { const line = buffer.getLine(row); if (line.translateToString(true) === target) { return [0, 2, 4, 6].map((col) => line.getCell(col).getWidth()); } } return null; })()`);
      await type(String.fromCodePoint(0x6c49, 0x5b57));
      await new Promise((resolve) => setTimeout(resolve, 300));
      wide.cursorAfterCjk = await evaluate('globalThis.thebird.term.buffer.active.cursorX');
      await type(String.fromCodePoint(0x1f600));
      await new Promise((resolve) => setTimeout(resolve, 300));
      wide.cursorAfterEmoji = await evaluate('globalThis.thebird.term.buffer.active.cursorX');
      wide.promptLength = await evaluate('globalThis.thebird.pty.state().prompt.length');
      await press('u', { ctrl: true });
    },
  });
  check('wide characters take two cells in the shell output, and the input cursor moves by the cell width of typed CJK and emoji', JSON.stringify(wide.cells) === '[2,2,2,1]' && wide.cursorAfterCjk === wide.promptLength + 4 && wide.cursorAfterEmoji === wide.promptLength + 6, JSON.stringify(wide));
  const pasted = {};
  await terminal([], {
    interact: async ({ evaluate, press }) => {
      await evaluate(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify('one\ntwo\nthree')}); document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      pasted.state = await evaluate('globalThis.thebird.pty.state()');
      pasted.output = await evaluate("globalThis.thebird.text().split('\\n').filter((line) => line.trim() !== '' && !line.startsWith('thebird '))");
      await press('u', { ctrl: true });
    },
  });
  check('a multi-line paste goes into the input line with each newline as a space, queues nothing and runs nothing', pasted.state?.line === 'one two three' && pasted.state.queued === 0 && pasted.output?.length === 0, JSON.stringify({ line: pasted.state?.line, queued: pasted.state?.queued, output: pasted.output }));
  const host = await terminal([['run', 'ruby -v']]);
  check('in-page bash reports host tools it lacks as exit 127', host.out.includes('ruby: command not found'));
  const PROMPT = 'thebird /workspace> ';
  const PROMPT_COUNT = "(() => { const b = globalThis.thebird.term.buffer.active; let n = 0; for (let i = 0; i < b.length; i++) if (b.getLine(i).translateToString(true).startsWith('thebird /workspace>')) n++; return n; })()";
  const NODE_COMMANDS = ['which node', 'command -v node', 'type node', 'node -v', 'node node-marker.js', 'node -e "console.log(typeof process, process.version)"', 'node node-check.js hello'];
  const nodeOutputs = [];
  const txikiShell = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const run = async (command) => {
        const before = await evaluate(PROMPT_COUNT);
        await type(command);
        await press('Enter');
        await waitFor(`${PROMPT_COUNT} > ${before}`, 120000);
        const lines = (await evaluate('globalThis.thebird.text()')).split('\n');
        const start = lines.lastIndexOf((PROMPT + command).trimEnd());
        const end = lines.findIndex((line, index) => index > start && line.startsWith(PROMPT));
        nodeOutputs.push({ command, output: lines.slice(start + 1, end).filter((line) => line.trim()).join('\n') });
      };
      await run(`echo 'console.log("txiki-runtime", tjs.version)' > node-marker.js`);
      await run(`echo 'const fs = require("fs"); console.log("args", process.argv.slice(2).join(" ")); console.log("read", fs.readFileSync("node-check.js", "utf8").includes("readFileSync"));' > node-check.js`);
      for (const command of NODE_COMMANDS) await run(command);
      await evaluate(`(async () => {
        const shell = await import(new URL('web/shell-in-txiki.js', location.href).href);
        const first = await shell.runShellInTxiki('mkdir -p notes/txiki && cd notes/txiki && x=7 && echo first-$x', { cwd: '/workspace' });
        const second = await shell.runShellInTxiki('echo second-$x; pwd', { cwd: '/workspace', saved: first.saved });
        const pipVersion = await shell.runShellInTxiki('pip --version; echo rc=$?', { cwd: '/workspace' });
        const pipBare = await shell.runShellInTxiki('pip; echo rc=$?', { cwd: '/workspace' });
        const pipUnknown = await shell.runShellInTxiki('pip frobnicate; echo rc=$?', { cwd: '/workspace' });
        const sqlite = await shell.runShellInTxiki('mkdir -p txiki-sql && cd txiki-sql && sqlite3 x.db "select 1"; echo rc=$?', { cwd: '/workspace' });
        const curl = await shell.runShellInTxiki('curl http://127.0.0.1:1/; echo after-curl-rc=$?', { cwd: '/workspace' });
        const pyController = new AbortController();
        const pyStarted = performance.now();
        setTimeout(() => pyController.abort(), 500);
        const pyAbort = await shell.runShellInTxiki('python3 -c "import time; time.sleep(30)"', { cwd: '/workspace', signal: pyController.signal }).then((r) => ({ status: 'resolved ' + r.exitCode }),(err) => ({ status: String(err.message) })).then((r) => ({ ...r, elapsed: Math.round(performance.now() - pyStarted) }));
        const engineRun = await (await import(new URL('web/txiki-in-page.js', location.href).href)).runTjs('console.log([typeof TextEncoder, typeof TextDecoder, typeof [].findLastIndex, JSON.stringify(String.fromCharCode(1)).length].join(" "))', '/workspace');
        globalThis.__txikiShellRuns = {
          sqlite: { stdout: sqlite.stdout, stderr: sqlite.stderr, exitCode: sqlite.exitCode },
          curl: { stdout: curl.stdout, stderr: curl.stderr, exitCode: curl.exitCode },
          pyAbort,
          engine: engineRun.output,
          first: { stdout: first.stdout, exitCode: first.exitCode },
          second: { stdout: second.stdout, exitCode: second.exitCode },
          pipVersion: { stdout: pipVersion.stdout, stderr: pipVersion.stderr, exitCode: pipVersion.exitCode },
          pipBare: { stdout: pipBare.stdout, stderr: pipBare.stderr, exitCode: pipBare.exitCode },
          pipUnknown: { stdout: pipUnknown.stdout, stderr: pipUnknown.stderr, exitCode: pipUnknown.exitCode },
        };
      })().catch((err) => { globalThis.__txikiShellRuns = { error: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__txikiShellRuns !== undefined', 300000);
      txikiShell.runs = JSON.parse(await evaluate('JSON.stringify(globalThis.__txikiShellRuns)'));
    },
  });
  const nodeOutput = (command) => nodeOutputs.find((entry) => entry.command === command)?.output ?? null;
  check('which node names node', nodeOutput('which node') === 'node', JSON.stringify(nodeOutput('which node')));
  check('command -v node names node', nodeOutput('command -v node') === 'node', JSON.stringify(nodeOutput('command -v node')));
  check('type node reports node as a shell builtin', nodeOutput('type node') === 'node is a shell builtin', JSON.stringify(nodeOutput('type node')));
  check('node -v prints a version', /^v\d+\.\d+\.\d+$/.test(nodeOutput('node -v') ?? ''), JSON.stringify(nodeOutput('node -v')));
  check('node <script> runs through the txiki engine and prints its marker', /^txiki-runtime \d+\.\d+\.\d+$/.test(nodeOutput('node node-marker.js') ?? ''), JSON.stringify(nodeOutput('node node-marker.js')));
  check('node -e exposes typeof process and process.version', /^object v\d+\.\d+\.\d+$/.test(nodeOutput('node -e "console.log(typeof process, process.version)"') ?? ''), JSON.stringify(nodeOutput('node -e "console.log(typeof process, process.version)"')));
  check('a node script reads process.argv and fs.readFileSync', nodeOutput('node node-check.js hello') === 'args hello\nread true', JSON.stringify(nodeOutput('node node-check.js hello')));
  check('the txiki shell runs a script on the engine, and the saved state carries the directory and variables to the next run', txikiShell.runs?.first?.stdout === 'first-7\n' && txikiShell.runs?.second?.stdout === 'second-7\n/workspace/notes/txiki\n', JSON.stringify(txikiShell.runs));
  const txikiPip = txikiShell.runs?.pipVersion ?? {};
  check('the txiki shell answers pip --version from the page micropip, with no stderr and exit 0', /^pip \d+\.\d+\.\d+ \(micropip, in-page\)\nrc=0\n$/.test(txikiPip.stdout ?? '') && txikiPip.stderr === '', JSON.stringify(txikiPip));
  const txikiBare = txikiShell.runs?.pipBare ?? {};
  check('the txiki shell prints bare pip usage on stderr and exits 2', txikiBare.stdout === 'rc=2\n' && txikiBare.stderr.startsWith('pip: usage: pip install <package>...\n'), JSON.stringify(txikiBare));
  const txikiUnknown = txikiShell.runs?.pipUnknown ?? {};
  check("the txiki shell names an unknown pip command on stderr and exits 2", txikiUnknown.stdout === 'rc=2\n' && txikiUnknown.stderr.startsWith("pip: unknown command 'frobnicate'\n"), JSON.stringify(txikiUnknown));
  const txikiRuns = txikiShell.runs ?? {};
  check('sqlite3 inside the txiki shell prints 1 for select 1 and exits 0', txikiRuns.sqlite?.stdout === '1\nrc=0\n' && txikiRuns.sqlite?.stderr === '', JSON.stringify(txikiRuns.sqlite));
  check('curl to a refused port inside the txiki shell writes an error to stderr, and the next command still runs', (txikiRuns.curl?.stderr ?? '') !== '' && /^after-curl-rc=[1-9]\d*$/m.test(txikiRuns.curl?.stdout ?? ''), JSON.stringify(txikiRuns.curl));
  check('a python3 sleep is aborted at 500 ms inside the txiki shell and rejects with status 130 in under 5 s', txikiRuns.pyAbort?.status?.includes('status 130') === true && txikiRuns.pyAbort?.elapsed < 5000, JSON.stringify(txikiRuns.pyAbort));
  check('the txiki engine has TextEncoder, TextDecoder and findLastIndex, and JSON escapes the marker byte', txikiRuns.engine === 'function function function 8\n', JSON.stringify(txikiRuns.engine));
  const loops = {};
  await terminal([], {
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const txiki = await import(new URL('web/txiki-in-page.js', location.href).href);
        const qjs = await import(new URL('web/qjs-in-txiki.js', location.href).href);
        const timed = async (run) => {
          const started = performance.now();
          try {
            return { ...(await run()), error: null, elapsed: performance.now() - started };
          } catch (err) {
            return { error: String(err.message ?? err), elapsed: performance.now() - started };
          }
        };
        const aborted = () => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 500);
          return txiki.runTjs('setTimeout(() => {}, 60000);', '/workspace', { signal: controller.signal });
        };
        globalThis.__loopRuns = {
          spinning: await timed(() => txiki.runTjs('while (true) {}', '/workspace', { timeoutMs: 1000 })),
          waiting: await timed(() => txiki.runTjs('setTimeout(() => {}, 60000);', '/workspace', { timeoutMs: 1000 })),
          aborted: await timed(aborted),
          tjs: await timed(() => txiki.tjsBuiltin(['-e', 'while (true) {}'], '/workspace', { timeoutMs: 1000 })),
          qjs: await timed(() => qjs.qjsBuiltin(['-e', 'while (true) {}'], { timeoutMs: 1000 })),
        };
      })().catch((err) => { globalThis.__loopRuns = { failed: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__loopRuns !== undefined', 120000);
      loops.runs = JSON.parse(await evaluate('JSON.stringify(globalThis.__loopRuns)'));
    },
  });
  check('a synchronous loop in tjs -e is cut at the timeout with status 124 and no uncaught line', loops.runs?.spinning?.status === 124 && !/Uncaught/.test(loops.runs.spinning.output ?? '') && loops.runs.spinning.elapsed < 5000, JSON.stringify(loops.runs?.spinning));
  check('a pending timer does not hold the engine past the timeout: status 124 well before the 60 s timer', loops.runs?.waiting?.status === 124 && loops.runs.waiting.elapsed < 5000, JSON.stringify(loops.runs?.waiting));
  check('an abort cancels a waiting engine run at the next tick and reports status 130', loops.runs?.aborted?.status === 130 && loops.runs.aborted.elapsed < 5000, JSON.stringify(loops.runs?.aborted));
  check('tjs and qjs report the timeout as a timeout error', loops.runs?.tjs?.error === 'timeout: command timed out' && loops.runs?.qjs?.error === 'timeout: command timed out', JSON.stringify({ tjs: loops.runs?.tjs?.error, qjs: loops.runs?.qjs?.error }));
  const spinning = {};
  const spun = await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      await type('mkdir -p loop-check && cd loop-check');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'");
      await type('node -e "while (true) {}"');
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const started = Date.now();
      await press('c', { ctrl: true });
      await waitFor("document.body.dataset.busy !== 'true'", 40000);
      spinning.elapsed = Date.now() - started;
      spinning.isolated = await evaluate('self.crossOriginIsolated');
      await type('echo status=$?; pwd');
      await press('Enter');
      await waitFor("document.body.dataset.busy !== 'true'");
    },
  });
  check('Ctrl-C stops a node loop that never yields: the command reports cancelled, exits 130 and returns within 10 s', spun.out.includes('^C') && /^cancelled$/m.test(spun.out) && /^status=130$/m.test(spun.out) && spinning.elapsed < 10000, `cancel took ${spinning.elapsed} ms; ${spun.out.split('\n').slice(-4).join(' / ')}`);
  check('after Ctrl-C on a cross-origin isolated page the shell keeps its directory; without isolation it restarts at /workspace', spinning.isolated ? /^\/workspace\/loop-check$/m.test(spun.out) : /^\/workspace$/m.test(spun.out), `isolated=${spinning.isolated}; ${spun.out.split('\n').slice(-2).join(' / ')}`);
  const nestedRuns = {};
  await terminal([], {
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const shell = await import(new URL('web/shell-in-txiki.js', location.href).href);
        try {
          const run = await shell.runShellInTxiki('git init nest-check >/dev/null && echo git-ok && node -e "console.log(2 + 2)" && qjs -e "1 + 2" && python3 -c "print(7 * 6)" && echo done', { cwd: '/workspace', timeoutMs: 240000 });
          globalThis.__nestedRun = { stdout: run.stdout, exitCode: run.exitCode, stderr: run.stderr };
        } catch (err) {
          globalThis.__nestedRun = { error: String(err.message ?? err) };
        }
      })()`);
      await waitFor('globalThis.__nestedRun !== undefined', 300000);
      nestedRuns.run = JSON.parse(await evaluate('JSON.stringify(globalThis.__nestedRun)'));
    },
  });
  check('the txiki shell serves git, node, qjs and python3 from inside itself: each nested builtin runs on its own engine instance and returns its output', nestedRuns.run?.stdout === 'git-ok\n4\n3\n42\ndone\n' && nestedRuns.run?.exitCode === 0, JSON.stringify(nestedRuns.run));

  const corsHost = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('cors-host-hello\n'); });
  const plainHost = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('plain-host-hello\n'); });
  for (const [name, server] of [['cors', corsHost], ['plain', plainHost]]) {
    await new Promise((resolve) => server.listen(portOf(name), '127.0.0.1', resolve));
    rememberPort(name, server.address().port);
  }
  const corsPort = corsHost.address().port;
  const plainPort = plainHost.address().port;
  const fetched = await terminal([
    ['run', `curl -s http://127.0.0.1:${corsPort}/hello`],
    ['run', `wget -O notes/fetched.txt http://127.0.0.1:${corsPort}/hello`],
    ['run', 'cat notes/fetched.txt'],
    ['run', `wget -O /dev/null http://127.0.0.1:${corsPort}/hello && echo devnull-wget-ok`],
  ]);
  check('in-page curl and wget fetch from a host that sends CORS headers', fetched.out.split('\n').filter((line) => line === 'cors-host-hello').length >= 2, fetched.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  check('wget -O /dev/null fetches from a CORS host and discards the body without an error', /^devnull-wget-ok$/m.test(fetched.out) && !/ENOENT/.test(fetched.out), fetched.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const tjsFetch = await terminal([['run', `tjs -e "const r = await fetch('http://127.0.0.1:${corsPort}/hello'); console.log('tjs-fetch', r.status, (await r.text()).trim());"`]]);
  check('tjs -e awaits txiki fetch, and the request goes out through the page', /^tjs-fetch 200 cors-host-hello$/m.test(tjsFetch.out), tjsFetch.out.split('\n').slice(-2).join(' / ').slice(0, 140));
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
    ['run', 'git commit -m nothing-staged'],
    ['run', 'git branch'],
  ]);
  check('git commit with nothing staged is refused by the gate', branchOne.out.includes('commit refused by the in-page gate') && branchOne.out.includes('staged: nothing staged'), branchOne.out.split('\n').find((line) => line.includes('nothing staged'))?.slice(0, 160) ?? 'no refusal line');
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
  const remote = await terminal([['run', 'git clone https://example.com/thebird.git']]);
  check('in-page git clone is refused before any request is made', remote.out.includes('git clone: remote access is refused in the in-page shell before any request is made'), remote.out.split('\n').find((line) => line.startsWith('git')) ?? remote.out.slice(0, 140));
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
      const value = () => evaluate("globalThis.thebird.pty.state().line");
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
      const value = () => evaluate("globalThis.thebird.pty.state().line");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 800));
      await type('cat notes/fetc');
      await press('Tab');
      await settle();
      completed.unique = await value();
      await press('u', { ctrl: true });
      await type('ls note');
      await press('Tab');
      await settle();
      completed.directory = await value();
      await press('u', { ctrl: true });
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
      const value = () => evaluate("globalThis.thebird.pty.state().line");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
      await type('cd notes');
      await press('Enter');
      await waitFor("globalThis.thebird.pty.state().prompt === 'thebird /workspace/notes> '", 20000);
      moved.prompt = await evaluate("globalThis.thebird.pty.state().prompt");
      await type('pwd');
      await press('Enter');
      await settle();
      moved.out = await evaluate("globalThis.thebird.text()");
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
      await waitFor("/^queued-two$/m.test(globalThis.thebird.text())", 40000);
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
  await new Promise((resolve) => holdServer.listen(portOf('hold'), '127.0.0.1', resolve));
  rememberPort('hold', holdServer.address().port);
  const held = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor, note, pause }) => {
      await type(`curl -s http://127.0.0.1:${holdServer.address().port}/held`);
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'", 20000);
      for (let poll = 0; poll < 200 && (await note('held-requests', () => heldRequests)) === 0; poll++) await pause();
      const pressed = await note('pressed-at', () => Date.now());
      await press('c', { ctrl: true });
      await waitFor("!document.body.dataset.busy", 10000);
      held.elapsed = await note('cancel-elapsed', () => Date.now() - pressed);
      held.requests = await note('held-requests-at-cancel', () => heldRequests);
      await type('echo after-held-cancel');
      await press('Enter');
      await waitFor("/^after-held-cancel$/m.test(globalThis.thebird.text())", 20000);
      held.echoed = (await evaluate("globalThis.thebird.text()")).includes('^C');
      held.out = await evaluate("globalThis.thebird.text()");
    },
  });
  holdServer.closeAllConnections();
  holdServer.close();
  check('in-page terminal Ctrl-C ends a curl waiting on a response, and the shell carries on', held.requests > 0 && held.echoed && held.elapsed < 10000 && held.out.includes('cancelled') && /^after-held-cancel$/m.test(held.out), `requests reaching the held server=${held.requests} ^C echoed=${held.echoed} cancel took ${held.elapsed} ms`);
  const quickjs = await terminal([['run', 'qjs -e "console.log(6*7)"'], ['run', 'qjs -e "throw new TypeError(\'boom\')"'], ['run', 'which qjs']]);
  check('in-page qjs runs quickjs-ng through the txiki engine, prints console output, and reports an uncaught error', quickjs.engine === 'ready' && /^42$/m.test(quickjs.out) && quickjs.out.includes('Uncaught TypeError: boom') && /^qjs$/m.test(quickjs.out), quickjs.out.split('\n').slice(-4).join(' / ').slice(0, 160));
  const editing = {};
  await terminal([['run', 'echo before-clear']], {
    interact: async ({ type, press, evaluate }) => {
      const value = () => evaluate("globalThis.thebird.pty.state().line");
      const caret = () => evaluate("globalThis.thebird.pty.state().cursor");
      await type('echo discarded');
      await press('u', { ctrl: true });
      editing.cleared = await value();
      await type('echo caret');
      await press('a', { ctrl: true });
      editing.start = await caret();
      await press('e', { ctrl: true });
      editing.end = await caret();
      editing.endLength = (await value()).length;
      await press('u', { ctrl: true });
      await press('l', { ctrl: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      editing.afterClear = await evaluate("globalThis.thebird.text()");
    },
  });
  check('in-page terminal Ctrl-U clears the line, and Ctrl-A and Ctrl-E move the caret to its ends', editing.cleared === '' && editing.start === 0 && editing.end === editing.endLength && editing.endLength > 0, JSON.stringify({ cleared: editing.cleared, start: editing.start, end: editing.end, endLength: editing.endLength }));
  check('in-page terminal Ctrl-L clears the output', editing.afterClear === 'thebird /workspace> ', JSON.stringify(editing.afterClear.slice(0, 80)));
  const streaming = {};
  const ticks = await terminal([], {
    interact: async ({ type, press, waitFor, evaluate }) => {
      await type('for i in 1 2 3 4 5; do echo tick$i; sleep 0.4; done');
      await press('Enter');
      await waitFor("globalThis.thebird.text().includes('tick1')", 20000);
      streaming.busy = await evaluate("document.body.dataset.busy === 'true'");
      streaming.beforeLast = await evaluate("!globalThis.thebird.text().includes('tick5')");
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
      await waitFor("/^kept-line$/m.test(globalThis.thebird.text())", 20000);
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
      recalledAfterReload = await evaluate("globalThis.thebird.pty.state().line");
    },
  });
  check('in-page terminal recalls a submitted command after the page reloads', recalledAfterReload === 'echo kept-line' && !/^kept-line$/m.test(reopenedHistory.out), JSON.stringify(recalledAfterReload));
  const commandTab = {};
  await terminal([], {
    interact: async ({ type, press, evaluate }) => {
      const value = () => evaluate("globalThis.thebird.pty.state().line");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
      await type('pyth');
      await press('Tab');
      await settle();
      commandTab.python = await value();
      await press('u', { ctrl: true });
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
  check('in-page sqlite3 creates a database and answers a query through tjs:sqlite', sqlite.engine === 'ready' && /^6$/m.test(sqlite.out), sqlite.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const tjsSum = await terminal([['run', `tjs -e "import { Database } from 'tjs:sqlite'; const db = new Database('notes/app.db'); console.log(db.prepare('select sum(x) as total from t').all()[0].total); db.close();"`]]);
  check('in-page tjs -e opens a tjs:sqlite database and sums it', /^6$/m.test(tjsSum.out), tjsSum.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const reopened = await terminal([['run', 'sqlite3 notes/app.db "select count(*) from t"']]);
  check('in-page sqlite3 database survives a browser restart', /^3$/m.test(reopened.out), reopened.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const rowStatements = "drop table if exists people; create table people(id integer primary key, name text, score real); insert into people(name, score) values ('ann', 1.5), ('bo', null), ('cy', 3); select id, name, score from people order by id; select sum(score) as total, count(*) as n from people; select name from people where name like 'b%'";
  const { DatabaseSync } = await import('node:sqlite');
  const reference = new DatabaseSync(':memory:');
  const referenceRows = rowStatements.split(';').map((sql) => sql.trim()).filter(Boolean).flatMap((sql) => reference.prepare(sql).all().map((row) => Object.values(row).map((value) => (value === null ? '' : String(value))).join('|')));
  reference.close();
  const expectedRows = referenceRows.join('\n');
  const rowsRun = await terminal([['run', `sqlite3 notes/rows.db "${rowStatements}"`]]);
  check('in-page sqlite3 returns the same rows as a reference SQLite for the same statements', expectedRows.length > 0 && rowsRun.out.includes(expectedRows), `expected ${JSON.stringify(expectedRows)} / got ${JSON.stringify(rowsRun.out.split('\n').slice(-6).join(' / ').slice(0, 220))}`);
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
  const splashRun = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      await evaluate(`(() => { globalThis.__splashModes = []; const splash = document.getElementById('splash'); new MutationObserver(() => globalThis.__splashModes.push(splash.dataset.mode ?? 'none')).observe(splash, { attributes: true, childList: true, subtree: true }); return true; })()`);
      await type('python3 -c "print(6*7)"');
      await press('Enter');
      await waitFor("/^42$/m.test(globalThis.thebird.text())", 240000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      splashRun.modes = await evaluate('[...new Set(globalThis.__splashModes)]');
      splashRun.hidden = await evaluate("document.getElementById('splash').hidden");
    },
  });
  check('the cold python3 call shows the tte-js splash while the bundle loads, then hides it', splashRun.modes?.includes('effect') && !splashRun.modes.includes('text') && splashRun.hidden === true, JSON.stringify(splashRun));
  const bundleFailed = {};
  await terminal([], {
    blockUrls: ['https://anentrypoint.github.io/pyodide-minimal/*'],
    interact: async ({ type, press, evaluate, waitFor }) => {
      await type('python3 -c "print(1)"');
      await press('Enter');
      await waitFor("(() => { const splash = document.getElementById('splash'); return !splash.hidden && splash.dataset.mode === 'text'; })()", 240000);
      bundleFailed.splash = await evaluate("document.getElementById('splash').textContent");
      bundleFailed.out = await evaluate("globalThis.thebird.text()");
    },
  });
  check('a Python bundle that fails to download shows its error as plain text in the splash and in python3 output', bundleFailed.splash === 'Failed to fetch' && bundleFailed.out.includes('python3: Failed to fetch'), JSON.stringify(bundleFailed.splash));
  const PYODIDE_LOCK_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json';
  const PYODIDE_LOCK_SHA256 = '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010';
  const pyodideLockBytes = Buffer.from(await fetch(PYODIDE_LOCK_URL, { signal: AbortSignal.timeout(60000) }).then((response) => response.arrayBuffer()).catch(() => new ArrayBuffer(0)));
  const pyodideLockDigest = createHash('sha256').update(pyodideLockBytes).digest('hex');
  const pyodideLock = pyodideLockDigest === PYODIDE_LOCK_SHA256 ? JSON.parse(pyodideLockBytes.toString('utf8')) : null;
  check('the micropip wheel the page loads is the one pinned in the Pyodide lock', pyodideLock !== null && readFileSync(join(root, 'web', 'python-worker.js'), 'utf8').includes(`'${pyodideLock.packages.micropip.file_name}'`), pyodideLock ? pyodideLock.packages.micropip.file_name : `lock sha256 ${pyodideLockDigest} from ${PYODIDE_LOCK_URL} is not the pinned ${PYODIDE_LOCK_SHA256}`);
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
  const pipCli = await terminal([
    ['run', 'pip --version'],
    ['run', 'pip -V'],
    ['run', 'pip --help; echo help-rc=$?'],
    ['run', 'pip; echo bare-rc=$?'],
    ['run', 'pip frobnicate; echo unknown-rc=$?'],
    ['run', 'pip install; echo install-rc=$?'],
  ]);
  const pipVersions = pipCli.out.split('\n').filter((line) => /^pip \d+\.\d+\.\d+ \(micropip, in-page\)$/.test(line));
  check('pip --version and pip -V print the micropip version the page loads', pipVersions.length === 2, pipVersions.join(' / ') || pipCli.out.split('\n').slice(-4).join(' / ').slice(0, 160));
  check('pip --help prints usage and exits 0', /^usage: pip install <package>\.\.\.$/m.test(pipCli.out) && /^help-rc=0$/m.test(pipCli.out), pipCli.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  check('bare pip, an unknown pip command and pip install with no names exit 2 with a message', /^bare-rc=2$/m.test(pipCli.out) && /^unknown-rc=2$/m.test(pipCli.out) && /^install-rc=2$/m.test(pipCli.out) && pipCli.out.includes("pip: unknown command 'frobnicate'") && pipCli.out.includes('pip: install needs at least one package name'), pipCli.out.split('\n').filter((line) => /^(pip|bare|unknown|install)/.test(line)).join(' / ').slice(0, 220));
  const pipQuiet = await terminal([['run', 'pip 2>/dev/null; echo quiet-rc=$?']]);
  const pipHelpStdout = await terminal([['run', 'pip --help 2>/dev/null; echo help-stdout-rc=$?']]);
  check('a bare pip prints its usage to stderr only, and exits 2', /^quiet-rc=2$/m.test(pipQuiet.out) && !pipQuiet.out.includes('usage:'), pipQuiet.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  check('pip --help prints its usage to stdout, so it survives 2>/dev/null', /^help-stdout-rc=0$/m.test(pipHelpStdout.out) && pipHelpStdout.out.includes('usage: pip install'), pipHelpStdout.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  const splashProbe = {};
  await terminal([], {
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const { createSplash } = await import(new URL('web/splash.js', location.href).href);
        const el = document.createElement('div');
        document.body.append(el);
        const splash = createSplash(el);
        splash.loading('loading the shell');
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const probe = { mode: el.dataset.mode, text: el.textContent, canvases: el.querySelectorAll('canvas').length };
        splash.done();
        el.remove();
        globalThis.__splashProbe = probe;
      })().catch((err) => { globalThis.__splashProbe = { error: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__splashProbe !== undefined', 60000);
      splashProbe.probe = JSON.parse(await evaluate('JSON.stringify(globalThis.__splashProbe)'));
      splashProbe.boot = await evaluate("globalThis.thebird.text().includes('loading the shell')");
      splashProbe.hidden = await evaluate("document.getElementById('splash').hidden");
    },
  });
  check('the boot splash is a tte-js effect on a canvas, and the loading text is never printed to the terminal', splashProbe.probe?.mode === 'effect' && splashProbe.probe.text === '' && splashProbe.probe.canvases === 1 && splashProbe.boot === false, JSON.stringify(splashProbe));
  check('the boot splash is hidden once the engine is ready', splashProbe.hidden === true, JSON.stringify(splashProbe.hidden));
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
    ['run', `python3 -c "import sqlite3; c = sqlite3.connect('notes/inc.db'); c.execute('create table t (x)'); c.execute('insert into t values (5)'); c.commit(); c.close()"`],
    ['run', 'sqlite3 notes/inc.db "select x from t"'],
  ]);
  const incLines = incremental.out.split('\n');
  check('in-page python3 sees a shell rewrite made after its last call', incLines.includes('one') && incLines.includes('two') && incLines.indexOf('two') > incLines.indexOf('one'), incLines.filter((line) => /^(one|two|three|True|False)$/.test(line)).join(' / '));
  check('in-page python3 removes a file it deletes and the shell sees it gone', incLines.includes('False') && incLines.includes('three'), incLines.filter((line) => /^(one|two|three|True|False)$/.test(line)).join(' / '));
  check('in-page python3 writes a sqlite3 database through the write journal, and the shell reads its row', incLines.includes('5'), incLines.slice(-4).join(' / ').slice(0, 160));
  const warmCalls = Array.from({ length: 30 }, () => 'python3 -c "print(1)"').join('; ');
  const timed = await terminal([
    ['run', 'mkdir -p notes/bulk'],
    ['run', `python3 -c "[open('notes/bulk/f%d.txt' % i, 'w').write('x' * 200) for i in range(300)]"`],
    ['run', `python3 -c "print(0)"; t0=$(date +%s%N); ${warmCalls}; t1=$(date +%s%N); echo $(( (t1 - t0) / 1000000 ))`],
  ]);
  const totalMs = Number(timed.out.split('\n').filter((line) => /^\d+$/.test(line)).pop());
  check('python3 warm calls are timed in-page over 300 files and average under 5 ms', Number.isFinite(totalMs) && totalMs > 0 && totalMs / 30 < 5, `${totalMs} ms for 30 calls`);
  console.log(`python3 sync timing: 300 files, ${(totalMs / 30).toFixed(1)} ms per warm call (30 calls in-page)`);
  const EXPIRY_WINDOW_MS = 10000;
  const expiry = await terminal([['run', 'for i in $(seq 1 30); do sleep 1; echo tick$i; done; echo late-finish']], { params: [['commandTimeoutMs', String(EXPIRY_WINDOW_MS)]] });
  const expiryTicks = [...expiry.out.matchAll(/^tick(\d+)$/gm)].map((match) => Number(match[1]));
  check('a command past the expiry window is cut at the window with the expiry message, and the lines after it do not run', expiry.out.includes(`error: resource limit exceeded: execution timeout (${EXPIRY_WINDOW_MS / 1000}s)`) && expiryTicks.length >= 5 && expiryTicks.length < 30 && !/^late-finish$/m.test(expiry.out), `${expiryTicks.length} ticks; ` + expiry.out.split('\n').slice(-2).join(' / ').slice(0, 120));
  rmSync(profile, { recursive: true, force: true });
} else {
  console.log('SKIP browser checks — no Chromium at ' + chrome + ' (set CHROME_BIN)');
}

const seeded = await import('../web/shims/fs.js');
const watcher = seeded.watch();
const chained = watcher.on('change', () => {}) === watcher && watcher.once('change', () => {}) === watcher;
check('fs.watch returns an inert handle: close is a no-op and on/once return the handle', typeof watcher.close === 'function' && chained && watcher.close() === undefined);
const sqliteRetired = !existsSync(join(root, 'web', 'sqlite-in-page.js')) && existsSync(join(root, 'web', 'sqlite-program.js')) && readFileSync(join(root, 'web', 'builtins.js'), 'utf8').includes("from './sqlite-in-txiki.js'");
check('sqlite3 runs a static txiki program, and web/sqlite-in-page.js is retired', sqliteRetired, existsSync(join(root, 'web', 'sqlite-in-page.js')) ? 'web/sqlite-in-page.js is still present' : sqliteRetired ? 'builtins.js imports web/sqlite-in-txiki.js, which runs web/sqlite-program.js' : 'web/sqlite-program.js is missing or builtins.js still imports the old file');
const qjsRetired = !existsSync(join(root, 'web', 'quickjs-in-page.js')) && !existsSync(join(root, 'web', 'vendor', 'quickjs')) && existsSync(join(root, 'web', 'qjs-program.js')) && readFileSync(join(root, 'web', 'builtins.js'), 'utf8').includes("from './qjs-in-txiki.js'");
check('qjs runs as a static txiki program, and the quickjs-ng wasm and its build are retired', qjsRetired, existsSync(join(root, 'web', 'quickjs-in-page.js')) ? 'web/quickjs-in-page.js is still present' : existsSync(join(root, 'web', 'vendor', 'quickjs')) ? 'web/vendor/quickjs is still present' : qjsRetired ? 'builtins.js imports web/qjs-in-txiki.js, which runs web/qjs-program.js' : 'web/qjs-program.js is missing or builtins.js still imports the old file');
const architecture = spawnSync(process.execPath, [join(root, 'scripts', 'lint-architecture.mjs'), '--static'], { cwd: root, encoding: 'utf8', timeout: 120000 });
const architectureFailures = architecture.stdout.split('\n').filter((line) => line.startsWith('FAIL')).length;
check('ARCHITECTURE.md and AGENTS.md claims have no contradictions with the code', architecture.status === 0 && architectureFailures === 0, architectureFailures ? `${architectureFailures} claim(s) fail; run node scripts/lint-architecture.mjs` : architecture.stdout.split('\n').at(-2) ?? '');
const comments = spawnSync(process.execPath, [join(root, 'scripts', 'lint-comments.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000 });
check('repo-owned code has no comments (scripts/lint-comments.mjs)', comments.status === 0 && /repo-owned files checked: 0 comments;/.test(comments.stdout), comments.stdout.split('\n').filter((line) => line.startsWith('FAIL')).slice(0, 3).join('; ') || comments.stdout.trim().split('\n').at(-1));
const vendoredLines = comments.stdout.split('\n').filter((line) => line.startsWith('VENDORED'));
check('every vendored bundle with comments has a provenance witness (upstream name)', comments.status === 0 && vendoredLines.length > 0 && vendoredLines.every((line) => line.includes('named (third-party, not edited)') || /listed in web\/vendor\/(fx|floosie)\/manifest\.json \(third-party, not edited\)/.test(line)) && !comments.stdout.includes('FAIL'), vendoredLines.map((line) => line.split(':')[0].replace('VENDORED ', '')).join(', ') || 'no vendored bundle reported');
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
const desyncFirstPin = (text) => text.replace(/(actions\/[\w.-]+ `)([0-9a-f])/, (match, head, first) => head + (first === '0' ? '1' : '0'));
const desyncFixture = process.env.THEBIRD_WITNESS_FIXTURE === 'desynced-mapping';
const mappingUnderTest = desyncFixture ? desyncFirstPin(agents) : agents;
const pinnedUses = (text) => [...text.matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map((m) => ({ action: m[1], sha: m[2] }));
const recordedPins = (text) => [...text.matchAll(/(actions\/[\w.-]+) `([0-9a-f]{40})` \((v\d+)\)/g)].map((m) => ({ action: m[1], sha: m[2], version: m[3] }));
const pinMismatches = (workflowText, agentsText) => {
  const pins = pinnedUses(workflowText);
  const rows = recordedPins(agentsText);
  const found = [];
  for (const pin of pins) if (!rows.some((row) => row.action === pin.action && row.sha === pin.sha)) found.push(`${pin.action}@${pin.sha.slice(0, 7)} is not recorded in AGENTS.md`);
  for (const row of rows) if (!pins.some((pin) => pin.action === row.action && pin.sha === row.sha)) found.push(`${row.action} ${row.sha.slice(0, 7)} (${row.version}) is not used in pages.yml`);
  const distinctPins = [...new Map(pins.map((pin) => [`${pin.action}@${pin.sha}`, pin])).values()];
  if (rows.length !== distinctPins.length) found.push(`count pinned=${distinctPins.length} recorded=${rows.length}`);
  return found;
};
const localMismatches = pinMismatches(workflow, mappingUnderTest);
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
const driftVerdict = (workflowText, agentsText, lookup) => {
  const local = pinMismatches(workflowText, agentsText);
  if (local.length) return { status: 'FAIL', detail: `local mismatch: ${local.join('; ')}` };
  const remote = recordedPins(agentsText).map((row) => ({ ...row, ...lookup(row.action, row.version) }));
  const moved = remote.filter((row) => row.resolved && row.resolved !== row.sha);
  const missingTags = remote.filter((row) => row.missing);
  if (moved.length || missingTags.length) return { status: 'FAIL', detail: `drift: ${[...moved.map((row) => `${row.action}@${row.version} is ${row.resolved.slice(0, 7)}, pinned ${row.sha.slice(0, 7)}`), ...missingTags.map((row) => `${row.action}@${row.version} ${row.missing}`)].join('; ')}` };
  const unavailable = remote.filter((row) => row.unavailable);
  if (unavailable.length) return { status: 'UNVERIFIED', detail: `network-unavailable — ${unavailable[0].unavailable}` };
  return { status: 'PASS', detail: remote.map((row) => `${row.action}@${row.version}=${row.resolved.slice(0, 7)}`).join(' ') };
};
const offlineLookup = (action, version) => {
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    return lookupTag(action, version);
  } finally {
    process.env.PATH = saved;
  }
};
const verdict = driftVerdict(workflow, mappingUnderTest, desyncFixture ? offlineLookup : lookupTag);
if (verdict.status === 'FAIL') check('every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)', false, verdict.detail);
else if (verdict.status === 'UNVERIFIED') console.log(`UNVERIFIED every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh): ${verdict.detail}`);
else check('every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)', true, verdict.detail);
const offlineProbe = offlineLookup(firstRow.action, firstRow.version);
const maskedDrift = driftVerdict(workflow, desyncedMapping, offlineLookup);
check('network-unavailable cannot mask drift: with gh unavailable and a desynced mapping SHA, the verdict is FAIL', Boolean(offlineProbe.unavailable) && maskedDrift.status === 'FAIL', `gh=${offlineProbe.unavailable ?? 'available'} verdict=${maskedDrift.status} ${maskedDrift.detail}`);
const offlineMatch = driftVerdict(workflow, agents, offlineLookup);
check('gh unavailable with every pin matching gives UNVERIFIED and no FAIL', Boolean(offlineProbe.unavailable) && offlineMatch.status === 'UNVERIFIED', `verdict=${offlineMatch.status} ${offlineMatch.detail}`);
check('negative control: a tag that resolves to another SHA is a FAIL when gh is available', driftVerdict(workflow, agents, () => ({ resolved: flipped(firstRow.sha) })).status === 'FAIL', 'a moved tag is reported as drift');
check('negative control: a desynced mapping SHA is a FAIL when gh is available', driftVerdict(workflow, desyncedMapping, () => ({ resolved: firstRow.sha })).status === 'FAIL', 'the local mismatch is not hidden by a matching remote');
check('pages.yml gives the build job contents read only, and the deploy job only pages and id-token write', sortedScopes(topScopes) === sortedScopes({ contents: 'read' }) && sortedScopes(buildScopes) === sortedScopes({ contents: 'read' }) && sortedScopes(deployScopes) === sortedScopes({ pages: 'write', 'id-token': 'write' }), `top=${JSON.stringify(topScopes)} build=${JSON.stringify(buildScopes)} deploy=${JSON.stringify(deployScopes)}`);
check('pages.yml builds floosie browser bundle from latest floosie main before the page build', /repository: AnEntrypoint\/floosie/.test(workflow) && /path: floosie/.test(workflow) && /FLOOSIE_REPO: \$\{\{ github\.workspace \}\}\/floosie/.test(workflow) && workflow.indexOf('node scripts/vendor-floosie.mjs') < workflow.indexOf('node scripts/build-pages.mjs') && /test -s web\/vendor\/floosie\/browser\.js/.test(workflow), 'floosie checkout, FLOOSIE_REPO, vendor script, asset check and build order');
check('pages.yml builds gm core WASM from latest gm main before the page build', /repository: AnEntrypoint\/gm\b/.test(workflow) && /path: gm\b/.test(workflow) && /GM_REPO: \$\{\{ github\.workspace \}\}\/gm\b/.test(workflow) && workflow.indexOf('node scripts/vendor-gm.mjs') < workflow.indexOf('node scripts/build-pages.mjs') && /test -s web\/vendor\/gm\/gm-core\.wasm/.test(workflow), 'gm checkout, GM_REPO, vendor script, asset check and build order');
check('pages.yml builds fx core WASM from latest gmfx main before the page build', /repository: AnEntrypoint\/gmfx/.test(workflow) && /ref: main/.test(workflow) && /path: gmfx/.test(workflow) && /FX_REPO: \$\{\{ github\.workspace \}\}\/gmfx/.test(workflow) && workflow.indexOf('node scripts/vendor-fx.mjs') < workflow.indexOf('node scripts/build-pages.mjs') && /test -s web\/vendor\/fx\/fx-core\.wasm/.test(workflow), 'gmfx checkout, FX_REPO, vendor script, asset check and build order');
check('the desynced-mapping fixture is used only when THEBIRD_WITNESS_FIXTURE is set', desyncFixture ? mappingUnderTest !== agents : mappingUnderTest === agents, `fixture=${desyncFixture}`);
const birdmanManifest = JSON.parse(readFileSync(join(root, 'web', 'vendor', 'birdman', 'manifest.json'), 'utf8'));
const birdmanDigest = createHash('sha256').update(readFileSync(join(root, 'web', 'vendor', 'birdman', 'client.js'))).digest('hex');
check('the vendored birdman client matches its manifest sha256, and the playwriter builtin imports that client', birdmanDigest === birdmanManifest.client.sha256 && readFileSync(join(root, 'web', 'playwriter-in-page.js'), 'utf8').includes("from './vendor/birdman/client.js'"), `sha256=${birdmanDigest.slice(0, 12)}`);
const hungCall = await withTimeout(new Promise(() => {}), 50, 'Runtime.evaluate').then(() => 'answered', (err) => err.message);
check('a DevTools call that never answers aborts with a timeout instead of stalling', hungCall === 'Runtime.evaluate did not answer within 50 ms', hungCall);
const promptCall = await withTimeout(Promise.resolve('answered'), 50, 'Runtime.evaluate');
check('a DevTools call that answers in time is returned unchanged (negative control)', promptCall === 'answered', promptCall);
const bashShellSource = readFileSync(join(root, 'web', 'bash-shell.js'), 'utf8');
const shellWorkerSource = readFileSync(join(root, 'web', 'shell-worker.js'), 'utf8');
check('the component ships the 900 s command expiry window, and the page can shorten it only through commandTimeoutMs', /^const COMMAND_TIMEOUT_MS = 900000;$/m.test(bashShellSource) && bashShellSource.includes('commandTimeoutMs = COMMAND_TIMEOUT_MS') && shellWorkerSource.includes('commandTimeoutMs: windowFromUrl(self.location.search)'), 'web/bash-shell.js and web/shell-worker.js');
await relay.close();
if (checkpoint) console.log(`checkpoint ${process.env.THEBIRD_WITNESS_CHECKPOINT}: call ${checkpoint.state.calls}, ${checkpoint.state.terminals} browser runs recorded`);
console.log(`witness totals: PASS ${recorded.filter((entry) => entry.ok).length} FAIL ${recorded.filter((entry) => !entry.ok).length}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
