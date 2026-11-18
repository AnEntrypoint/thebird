import { fxTuiStatus, onFxTuiStatus } from './fx-tui.js';
import { isPushDue } from './state-push.js';

const STATE_URL = '/__thebird/state';
const PUSH_INTERVAL_MS = 500;
const FX_CARD_ID = 'fx-status';

export function observeRuns(client, now = () => Date.now()) {
  const current = { command: null, startedAt: null, exitCode: null, cwd: null };
  const finish = () => {
    current.command = null;
    current.startedAt = null;
  };
  const observed = {
    ...client,
    run(command) {
      current.command = command;
      current.startedAt = now();
      return client.run(command).then((result) => {
        current.exitCode = result?.exitCode ?? null;
        finish();
        return result;
      }, (error) => {
        current.exitCode = null;
        finish();
        throw error;
      });
    },
    cwd() {
      return client.cwd().then((cwd) => {
        current.cwd = cwd;
        return cwd;
      });
    },
  };
  return { client: observed, current };
}

const paneOf = (term) => {
  const buffer = term.buffer.active;
  const lines = [];
  for (let row = 0; row < term.rows; row++) lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
  return {
    cols: term.cols,
    rows: term.rows,
    cursor: { x: buffer.cursorX, y: buffer.baseY + buffer.cursorY - buffer.viewportY },
    lines,
  };
};

const runOf = (current, body) => ({
  busy: body.dataset.busy === 'true',
  command: current.command,
  cwd: current.cwd,
  lastExitCode: current.exitCode,
  startedAt: current.startedAt,
  engine: {
    shell: body.dataset.engine ?? null,
    boot: body.dataset.boot ?? null,
    tui: body.dataset.tui ?? null,
    renderer: body.dataset.renderer ?? null,
  },
});

const fxStatusText = (status) => {
  if (status.state === 'running') return `fx: running, model ${status.model ?? 'default'}, ${status.cols}x${status.rows}`;
  const lastExit = status.exitCode ?? null;
  return lastExit === null ? 'fx: idle' : `fx: idle (last exit ${lastExit})`;
};

const fxPayload = () => {
  const status = fxTuiStatus();
  return {
    bottomLine: status.state === 'running' ? fxStatusText(status) : null,
    activeRun: null,
    browser: null,
    updatedAt: status.updatedAt,
  };
};

export function startThebirdState({ term, current, body = document.body }) {
  let sent = null;
  let sentAt = 0;
  let timer = null;

  const stop = () => clearInterval(timer);

  const snapshot = () => ({ pane: paneOf(term), run: runOf(current, body), fx: fxPayload() });

  const push = () => {
    const json = JSON.stringify(snapshot());
    const now = Date.now();
    if (!isPushDue({ json, sent, sentAt, now })) return;
    sent = json;
    sentAt = now;
    fetch(STATE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json }).then((response) => {
      if (!response.ok) stop();
    }, stop);
  };

  const showFxStatus = (status) => {
    const features = globalThis.THEBIRD_FEATURES;
    const spec = { title: 'fx', status: fxStatusText(status) };
    if (features.list().some((feature) => feature.id === FX_CARD_ID)) features.update(FX_CARD_ID, spec);
    else features.register(FX_CARD_ID, spec, { source: 'thebird' });
  };

  showFxStatus(fxTuiStatus());
  onFxTuiStatus(showFxStatus);
  timer = setInterval(push, PUSH_INTERVAL_MS);
  push();
  return { push, stop };
}
