const UNAVAILABLE = (tool) => `${tool} is not available on the thebird page yet`;

const failure = (content) => ({ content, isError: true });

const THEBIRD_MCP = '/__thebird/mcp/thebird';

const THEBIRD_REGISTRY = '/__thebird/registry';

const DEFAULT_PANE_LINES = 60;

const MAX_PANE_LINES = 500;

const APPS_CAPABILITY = 'listing apps and open ports from the Node app supervisor';

const PUBLISH_CAPABILITY = 'publishing or registering webservers, served under /sites/<id>/';

const UNREGISTER_CAPABILITY = 'removing a registered webserver from the Node registry';

const boundedLines = (lines) => {
  if (typeof lines !== 'number' || !Number.isFinite(lines)) return DEFAULT_PANE_LINES;
  return Math.min(MAX_PANE_LINES, Math.max(1, Math.trunc(lines)));
};

const staticFailure = (name, capability) => failure(`${name} is unavailable on this static page: ${capability} needs the thebird Node host, and no Node host answers at this origin.`);

const probeNodeHost = async () => {
  try {
    const response = await fetch(THEBIRD_MCP);
    return response.ok && (await response.json())?.name === 'thebird';
  } catch {
    return false;
  }
};

const callNodeThebird = async (name, args) => {
  let reply;
  try {
    const response = await fetch(THEBIRD_MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    if (!response.ok) return failure(`${name}: the thebird host at this origin answered HTTP ${response.status}`);
    reply = await response.json();
  } catch (error) {
    return failure(`${name}: the thebird host at this origin did not answer (${error?.message ?? String(error)})`);
  }
  if (reply?.error) return failure(`${name}: ${reply.error.message}`);
  const text = reply?.result?.content?.[0]?.text;
  if (typeof text !== 'string') return failure(`${name}: unexpected reply from the thebird host`);
  return { content: text, isError: reply.result.isError === true };
};

const callNodeRegistry = async (method, body) => {
  let reply;
  try {
    const response = await fetch(THEBIRD_REGISTRY, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return failure(`thebird registry: the host at this origin answered HTTP ${response.status}`);
    reply = await response.json();
  } catch (error) {
    return failure(`thebird registry: the host at this origin did not answer (${error?.message ?? String(error)})`);
  }
  return { content: JSON.stringify(reply) };
};

const pageRun = (host) => {
  const snapshot = host.localState?.();
  if (!snapshot) return failure('thebird_run: the page has no run state yet');
  return { content: JSON.stringify({ ...snapshot.run, updatedAt: Date.now(), current: true, ageMs: 0, stale: false, fx: snapshot.fx }) };
};

const pagePane = (host, input) => {
  const snapshot = host.localState?.();
  if (!snapshot) return failure('thebird_pane: the page has no terminal screen yet');
  const pane = snapshot.pane ?? {};
  const screen = Array.isArray(pane.lines) ? pane.lines.map(String) : [];
  return {
    content: JSON.stringify({
      updatedAt: Date.now(),
      current: true,
      ageMs: 0,
      stale: false,
      cols: pane.cols ?? null,
      rows: pane.rows ?? null,
      cursor: pane.cursor ?? null,
      lines: screen.slice(-boundedLines(input.lines)),
    }),
  };
};

const thebirdReach = () => {
  let probe = null;
  const nodePresent = () => {
    probe ??= probeNodeHost();
    return probe;
  };
  return {
    tool: (name, description, properties, page) => ({
      name,
      description,
      inputSchema: { type: 'object', properties, additionalProperties: false },
      execute: async (input) => ((await nodePresent()) ? callNodeThebird(name, input ?? {}) : page(input ?? {})),
    }),
    gate: async (name, capability, nodeRun) => ((await nodePresent()) ? nodeRun() : staticFailure(name, capability)),
  };
};

const registerWebserver = async (input, publish) => {
  if (input.dir === undefined) return callNodeRegistry('POST', input);
  if (typeof publish !== 'function') return failure(UNAVAILABLE('thebird_register with dir'));
  try {
    const { id, title, description, dir } = input;
    return { content: JSON.stringify(await publish({ id, title, description, dir })) };
  } catch (error) {
    return failure(`thebird_register: ${error?.message ?? String(error)}`);
  }
};

const thebirdRegisterTool = (host, reach) => ({
  name: 'thebird_register',
  description: 'Register a Node webserver with the thebird host. With dir (for example /workspace/ha), publish the folder at dir so the page is served at /sites/<id>/; without dir, only the registry entry is created.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, dir: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  writes: true,
  idempotent: false,
  execute: (input) => reach.gate('thebird_register', PUBLISH_CAPABILITY, () => registerWebserver(input ?? {}, host.publish)),
});

const thebirdUnregisterTool = (reach) => ({
  name: 'thebird_unregister',
  description: 'Remove a registered Node webserver from the thebird host registry.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  writes: true,
  idempotent: true,
  execute: (input) => reach.gate('thebird_unregister', UNREGISTER_CAPABILITY, () => callNodeRegistry('DELETE', input ?? {})),
});

const thebirdTools = (host) => {
  const reach = thebirdReach();
  return [
    reach.tool('thebird_pane', 'Read the last lines of the thebird terminal screen, read-only. Optional lines, up to 500.', { lines: { type: 'number' } }, (input) => pagePane(host, input)),
    reach.tool('thebird_run', 'Read the thebird run snapshot, read-only: busy state, current command, cwd, last exit code, engine states and fx status.', {}, () => pageRun(host)),
    reach.tool('thebird_ports', 'List the apps and open ports from the thebird Node app supervisor, read-only.', {}, () => staticFailure('thebird_ports', APPS_CAPABILITY)),
    thebirdRegisterTool(host, reach),
    thebirdUnregisterTool(reach),
  ];
};

export function createPageHostTools(host = {}) {
  return [
    {
      name: 'bash',
      description: 'Run a bash command in the thebird in-page shell and return its combined output.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
        additionalProperties: false,
      },
      writes: true,
      idempotent: false,
      execute(input) {
        if (typeof host.bash !== 'function') return failure(UNAVAILABLE('bash'));
        return Promise.resolve(host.bash(String(input?.command ?? ''))).then(
          (result) => ({ content: typeof result?.output === 'string' ? result.output : '', isError: result?.exitCode !== 0 }),
          (error) => failure(error?.message ?? String(error)),
        );
      },
    },
    {
      name: 'ask',
      description: 'Ask the user one question and wait for the answer.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
        additionalProperties: false,
      },
      execute(input) {
        if (typeof host.ask !== 'function') return failure(UNAVAILABLE('ask'));
        return Promise.resolve(host.ask(String(input?.question ?? ''))).then(
          (answer) => ({ content: String(answer ?? '') }),
          (error) => failure(error?.message ?? String(error)),
        );
      },
    },
    ...thebirdTools(host),
  ];
}

export const PAGE_HOST_TOOLS = createPageHostTools();

export const PAGE_HOST_TOOL_NAMES = PAGE_HOST_TOOLS.map((tool) => tool.name);

export function pageWorkspace(bash) {
  return {
    info: { version: 1, root: '/workspace', cwd: '/workspace', home: '/workspace', gitAvailable: false, ephemeral: true },
    permission: 'allow-sandboxed',
    exec: async ({ command }) => {
      const result = await bash(`(cd /workspace && ${command}\n)`);
      return { exitCode: result?.exitCode ?? 1, stdout: typeof result?.output === 'string' ? result.output : '', stderr: '' };
    },
  };
}

export function hostToolExecutor(tools) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return async (name, input) => {
    const tool = byName.get(name);
    if (!tool) return failure(`unknown host tool: ${name}`);
    try {
      return await tool.execute(input ?? {});
    } catch (error) {
      return failure(error?.message ?? String(error));
    }
  };
}

export function pageHostToolsJson(tools = PAGE_HOST_TOOLS) {
  return JSON.stringify({
    tools: tools.map(({ name, description, inputSchema, writes }) => ({ name, description, inputSchema, writes: writes === true })),
  });
}
