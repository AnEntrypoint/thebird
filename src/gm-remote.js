export async function remoteClient({ url, fetch: send = globalThis.fetch }) {
  const base = url.endsWith('/') ? url : url + '/';
  const metaResponse = await send(new URL('meta', base));
  if (!metaResponse.ok) throw new Error('relay meta failed with status ' + metaResponse.status);
  const meta = await metaResponse.json();

  async function call(name, args = {}) {
    const response = await send(new URL('call', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verb: name, args }),
    });
    const body = await response.json();
    if (body.ok !== true) throw new Error(body.error || ('gm ' + name + ' failed'));
    return body.result;
  }

  return {
    gmHome: meta.gmHome,
    workspace: meta.workspace,
    runDir: meta.runDir,
    call,
    verb: call,
    tools: () => {
      throw new Error('tools are not available through a remote client');
    },
    async close() {},
  };
}
