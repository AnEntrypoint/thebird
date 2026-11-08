import { Terminal } from './vendor/xterm/xterm.mjs';
import { FitAddon } from './vendor/xterm/addon-fit.mjs';
import { WebglAddon } from './vendor/xterm/addon-webgl.mjs';
import { shellClient } from './shell-client.js';
import { createPtyAdapter } from './pty-adapter.js';

const params = new URLSearchParams(location.search);
const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
  fontSize: 14,
  scrollback: 10000,
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

const client = shellClient();
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
term.onData((data) => pty.onData(data));
term.onResize(({ cols }) => pty.resize(cols));
new ResizeObserver(() => fit.fit()).observe(document.getElementById('terminal'));

pty.writeOutput('loading the shell\n');
try {
  await client.ready;
  document.body.dataset.engine = 'ready';
  await pty.refreshPrompt();
} catch (err) {
  document.body.dataset.engine = 'failed';
  pty.writeOutput(`engine error: ${err.message}\n`);
}
if (document.body.dataset.engine === 'ready') {
  for (const command of params.getAll('run')) pty.runLine(command);
}
await pty.whenIdle();
document.body.dataset.done = 'true';
term.focus();
