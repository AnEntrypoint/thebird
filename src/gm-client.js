export function clientFrom(tools, { gmHome, workspace, runDir }) {
  async function call(name, args = {}) {
    if (name === 'job_start') return call('run_shell', { ...args, background: true });
    const result = await tools.run(name, args);
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
