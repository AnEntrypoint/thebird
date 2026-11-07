export function workerClient({ url = '/web/gm-worker.js', raw = false } = {}) {
  const worker = new Worker(raw ? `${url}?gm=raw` : url, { type: 'module' });
  const pending = new Map();
  let nextId = 1;
  let markReady;
  let markFailed;
  const ready = new Promise((ok, fail) => {
    markReady = ok;
    markFailed = fail;
  });

  worker.onmessage = ({ data }) => {
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
  worker.onerror = (event) => markFailed(new Error(event.message || 'gm worker failed to start'));

  function request(message) {
    const id = nextId++;
    return new Promise((ok, fail) => {
      pending.set(id, { ok, fail });
      worker.postMessage({ id, ...message });
    });
  }

  function call(verb, args = {}) {
    return request({ verb, args });
  }

  return {
    ready,
    call,
    verb: call,
    gmHome: raw ? '/gm-raw' : '/gm',
    workspace: '/workspace',
    runDir: '/workspace/.thebird/run',
    tools: () => {
      throw new Error('tools are not available through a worker client');
    },
    cancel() {
      worker.postMessage({ cancel: true });
    },
    complete: (prefix) => request({ complete: prefix }),
    async close() {
      worker.terminate();
    },
  };
}
