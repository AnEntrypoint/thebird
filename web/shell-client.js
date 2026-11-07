export function shellClient({ url = new URL('./shell-worker.js', import.meta.url).href } = {}) {
  const worker = new Worker(url, { type: 'module' });
  const pending = new Map();
  let nextId = 1;
  let markReady;
  let markFailed;
  const ready = new Promise((ok, fail) => {
    markReady = ok;
    markFailed = fail;
  });

  let outputSink = () => {};
  worker.onmessage = ({ data }) => {
    if (data.output !== undefined) {
      outputSink(data.output);
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
    if (data.ok) waiter.ok(data.result);
    else waiter.fail(new Error(data.error));
  };
  worker.onerror = (event) => markFailed(new Error(event.message || 'shell worker failed to start'));

  function request(message) {
    const id = nextId++;
    return new Promise((ok, fail) => {
      pending.set(id, { ok, fail });
      worker.postMessage({ id, ...message });
    });
  }

  return {
    ready,
    run: (command) => request({ run: command }),
    complete: (prefix, { command = false } = {}) => request({ complete: prefix, command }),
    cwd: () => request({ query: 'cwd' }),
    cancel() {
      worker.postMessage({ cancel: true });
    },
    onOutput(sink) {
      outputSink = sink;
    },
    close() {
      worker.terminate();
    },
  };
}
