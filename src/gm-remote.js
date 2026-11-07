export async function remoteClient({ url, fetch: send = globalThis.fetch }) {
  const base = url.endsWith('/') ? url : url + '/';
  const metaResponse = await send(new URL('meta', base));
  if (!metaResponse.ok) throw new Error('relay meta failed with status ' + metaResponse.status);
  const meta = await metaResponse.json();

  const active = new Set();
  let nextId = 0;
  const post = (path, body) => send(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function call(name, args = {}) {
    const id = `${Date.now().toString(36)}-${nextId++}`;
    active.add(id);
    try {
      const response = await post('call', { verb: name, args, id });
      const body = await response.json();
      if (body.ok !== true) throw new Error(body.error || ('gm ' + name + ' failed'));
      return body.result;
    } finally {
      active.delete(id);
    }
  }

  async function cancel() {
    await Promise.all([...active].map((id) => post('cancel', { id }).catch(() => {})));
  }

  return {
    gmHome: meta.gmHome,
    workspace: meta.workspace,
    runDir: meta.runDir,
    call,
    verb: call,
    cancel,
    tools: () => {
      throw new Error('tools are not available through a remote client');
    },
    async close() {},
  };
}
