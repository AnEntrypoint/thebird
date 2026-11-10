import { Terminal } from './vendor/xterm/xterm.mjs';
import { FitAddon } from './vendor/xterm/addon-fit.mjs';
import { WebglAddon } from './vendor/xterm/addon-webgl.mjs';
import { Unicode11Addon } from './vendor/xterm/addon-unicode11.mjs';
import { shellClient } from './shell-client.js';
import { createPtyAdapter } from './pty-adapter.js';
import { createSplash } from './splash.js';
import { runFxTui } from './fx-tui.js';

const params = new URLSearchParams(location.search);
const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
  fontSize: 14,
  scrollback: 10000,
  allowProposedApi: true,
  theme: { background: '#000000', foreground: '#e5e5e5', cursor: '#e5e5e5' },
});
const screenText = () => {
  const buffer = term.buffer.active;
  const lines = [];
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    const text = line.translateToString(!buffer.getLine(row + 1)?.isWrapped);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.join('\n').replace(/\n+$/, '');
};
const fit = new FitAddon();
term.loadAddon(fit);
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = '11';
term.open(document.getElementById('terminal'));
fit.fit();
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => webgl.dispose());
  term.loadAddon(webgl);
  document.body.dataset.renderer = 'webgl';
} catch {
  document.body.dataset.renderer = 'dom';
}

const client = shellClient({ commandTimeoutMs: params.get('commandTimeoutMs') ?? undefined });
const pty = createPtyAdapter({
  term,
  client,
  onBusy: (busy) => {
    if (busy) document.body.dataset.busy = 'true';
    else delete document.body.dataset.busy;
  },
});
globalThis.thebird = { term, pty, text: screenText };
client.onOutput((text) => pty.writeOutput(text));
const splash = createSplash(document.getElementById('splash'));
client.onPhase((phase, detail) => {
  if (phase === 'loading') splash.loading();
  else if (phase === 'failed') splash.failed(detail);
  else splash.done();
});
let takingOver = false;
client.onTakeover(async ({ id, fx }) => {
  takingOver = true;
  document.body.dataset.tui = 'fx';
  let code = 0;
  try {
    code = await runFxTui(term, fx);
  } catch (error) {
    term.write(`fx: ${error.message}\r\n`);
    code = 1;
  }
  takingOver = false;
  delete document.body.dataset.tui;
  client.finishTakeover(id, code);
});
term.onData((data) => {
  if (!takingOver) pty.onData(data);
});
term.onResize(({ cols }) => pty.resize(cols));
const terminalBox = document.getElementById('terminal');
new ResizeObserver(() => fit.fit()).observe(terminalBox);
terminalBox.addEventListener('paste', (event) => {
  event.preventDefault();
  event.stopPropagation();
  pty.paste(event.clipboardData?.getData('text/plain') ?? '');
}, { capture: true });
const touchScroll = { y: null, lines: 0 };
terminalBox.addEventListener('touchstart', (event) => {
  touchScroll.y = event.touches[0].clientY;
}, { passive: true });
terminalBox.addEventListener('touchmove', (event) => {
  if (touchScroll.y === null) return;
  event.preventDefault();
  const y = event.touches[0].clientY;
  const lineHeight = terminalBox.clientHeight / term.rows;
  touchScroll.lines += (touchScroll.y - y) / lineHeight;
  const whole = Math.trunc(touchScroll.lines);
  if (whole) term.scrollLines(whole);
  touchScroll.lines -= whole;
  touchScroll.y = y;
}, { passive: false });
terminalBox.addEventListener('touchend', () => {
  touchScroll.y = null;
  touchScroll.lines = 0;
});

splash.loading('loading the shell');
try {
  await client.ready;
  splash.done();
  document.body.dataset.engine = 'ready';
  await pty.refreshPrompt();
} catch (err) {
  splash.failed(err.message);
  document.body.dataset.engine = 'failed';
  pty.writeOutput(`engine error: ${err.message}\n`);
}
if (document.body.dataset.engine === 'ready') {
  for (const command of params.getAll('run')) pty.runLine(command);
}
await pty.whenIdle();
document.body.dataset.done = 'true';
term.focus();
