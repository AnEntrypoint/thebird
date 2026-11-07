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

  const lines = (output) => output.split('\n').filter((line) => line && !line.startsWith('[gm:'));

  async function complete(prefix, { command = false } = {}) {
    if (command) {
      const quoted = `'${prefix.replaceAll("'", "'\\''")}'`;
      const { output } = await call('run_shell', { command: `compgen -c ${quoted} | sort -u | head -200` });
      return lines(output).sort();
    }
    const slash = prefix.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : prefix.slice(0, slash + 1);
    const base = prefix.slice(slash + 1);
    let listing;
    try {
      listing = await call('list_dir', { path: dirPart || '.', prefix: base, limit: 200 });
    } catch {
      return [];
    }
    return lines(listing.output)
      .filter((entry) => !entry.startsWith('.') || base.startsWith('.'))
      .map((entry) => dirPart + entry)
      .sort();
  }

  return {
    gmHome: meta.gmHome,
    workspace: meta.workspace,
    runDir: meta.runDir,
    call,
    verb: call,
    cancel,
    complete,
    cwd: async () => meta.workspace,
    tools: () => {
      throw new Error('tools are not available through a remote client');
    },
    async close() {},
  };
}
