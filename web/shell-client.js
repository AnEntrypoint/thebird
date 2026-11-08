const CANCEL_GRACE_MS = 1500;

export function shellClient({ url = new URL('./shell-worker.js', import.meta.url).href } = {}) {
  const cancelFlag = globalThis.crossOriginIsolated ? new SharedArrayBuffer(4) : null;
  const cancelWord = cancelFlag && new Int32Array(cancelFlag);
  const pending = new Map();
  let nextId = 1;
  let worker = null;
  let runId = null;
  let grace = null;
  let markReady;
  let markFailed;
  const ready = new Promise((ok, fail) => {
    markReady = ok;
    markFailed = fail;
  });

  let outputSink = () => {};
  let phaseSink = () => {};

  function onMessage({ data }) {
    if (data.output !== undefined) {
      outputSink(data.output);
      return;
    }
    if (data.phase !== undefined) {
      phaseSink(data.phase, data.detail);
      return;
    }
    if ('ready' in data) {
      if (data.ready) markReady();
      else markFailed(new Error(data.error));
      return;
    }
    const waiter = pending.get(data.id);
    pending.delete(data.id);
    if (!waiter) return;
    if (waiter.run) settleRun();
    if (data.ok) waiter.ok(data.result);
    else waiter.fail(new Error(data.error));
  }

  function settleRun() {
    runId = null;
    clearTimeout(grace);
    grace = null;
  }

  function spawn() {
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = onMessage;
    worker.onerror = (event) => markFailed(new Error(event.message || 'shell worker failed to start'));
    worker.postMessage({ init: { flag: cancelFlag } });
  }

  function replaceWorker() {
    const id = runId;
    grace = null;
    settleRun();
    worker.terminate();
    for (const [key, waiter] of pending) {
      pending.delete(key);
      if (key === id) waiter.ok({ ok: false, exitCode: 130, signal: null, output: 'cancelled\n' });
      else waiter.fail(new Error('the shell restarted'));
    }
    spawn();
    worker.postMessage({ id: 0, run: '(exit 130)' });
  }

  function request(message, run = false) {
    const id = nextId++;
    if (run) runId = id;
    return new Promise((ok, fail) => {
      pending.set(id, { ok, fail, run });
      worker.postMessage({ id, ...message });
    });
  }

  spawn();

  return {
    ready,
    run: (command) => request({ run: command }, true),
    complete: (prefix, { command = false } = {}) => request({ complete: prefix, command }),
    cwd: () => request({ query: 'cwd' }),
    cancel() {
      if (cancelWord) Atomics.store(cancelWord, 0, 1);
      worker.postMessage({ cancel: true });
      if (runId !== null && grace === null) grace = setTimeout(replaceWorker, CANCEL_GRACE_MS);
    },
    resize(cols, rows) {
      worker.postMessage({ resize: { cols, rows } });
    },
    onOutput(sink) {
      outputSink = sink;
    },
    onPhase(sink) {
      phaseSink = sink;
    },
    close() {
      clearTimeout(grace);
      worker.terminate();
    },
  };
}
