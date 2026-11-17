const UNAVAILABLE = (tool) => `${tool} is not available on the thebird page yet`;

const failure = (content) => ({ content, isError: true });

const THEBIRD_MCP = '/__thebird/mcp/thebird';

const THEBIRD_REGISTRY = '/__thebird/registry';

const callThebird = async (name, args) => {
  let reply;
  try {
    const response = await fetch(THEBIRD_MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    if (!response.ok) return failure(`${name}: thebird host unavailable (HTTP ${response.status}); run thebird with npm run host`);
    reply = await response.json();
  } catch (error) {
    return failure(`${name}: thebird host unavailable (${error?.message ?? String(error)}); run thebird with npm run host`);
  }
  if (reply?.error) return failure(`${name}: ${reply.error.message}`);
  const text = reply?.result?.content?.[0]?.text;
  if (typeof text !== 'string') return failure(`${name}: unexpected reply from the thebird host`);
  return { content: text, isError: reply.result.isError === true };
};

const thebirdTool = (name, description, properties) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, additionalProperties: false },
  execute: (input) => callThebird(name, input ?? {}),
});

const callRegistry = async (method, body) => {
  let reply;
  try {
    const response = await fetch(THEBIRD_REGISTRY, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return failure(`thebird registry: HTTP ${response.status}; run thebird with npm run host`);
    reply = await response.json();
  } catch (error) {
    return failure(`thebird registry: ${error?.message ?? String(error)}; run thebird with npm run host`);
  }
  return { content: JSON.stringify(reply) };
};

const thebirdRegistryTool = (name, description, method, properties, required) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  writes: true,
  idempotent: method === 'DELETE',
  execute: (input) => callRegistry(method, input ?? {}),
});

const THEBIRD_TOOLS = [
  thebirdTool('thebird_pane', 'Read the last lines of the thebird terminal screen, read-only. Optional lines, up to 500.', { lines: { type: 'number' } }),
  thebirdTool('thebird_run', 'Read the thebird run snapshot, read-only: busy state, current command, cwd, last exit code, engine states and fx status.', {}),
  thebirdTool('thebird_ports', 'List the apps and open ports from the thebird Node app supervisor, read-only.', {}),
  thebirdRegistryTool(
    'thebird_register',
    'Register a Node webserver with the thebird host, creating its folder under .thebird/webservers.',
    'POST',
    { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
    ['id'],
  ),
  thebirdRegistryTool('thebird_unregister', 'Remove a registered Node webserver from the thebird host registry.', 'DELETE', { id: { type: 'string' } }, ['id']),
];

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
    ...THEBIRD_TOOLS,
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
