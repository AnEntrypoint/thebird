export function clientFrom(tools, { gmHome, workspace, runDir }, overrides = {}) {
  async function call(name, args = {}, options = {}) {
    if (name === 'job_start') return call('run_shell', { ...args, background: true }, options);
    if (overrides[name]) return overrides[name](args);
    const result = await tools.run(name, args, { signal: options.signal });
    if (result && result.ok === false) {
      throw new Error(result.error || result.refused || ('gm ' + name + ' failed'));
    }
    return result;
  }

  return {
    gmHome,
    workspace,
    runDir,
    call,
    verb: call,
    tools: () => tools,
    async close() {
      await tools.close('thebird-done');
    },
  };
}
