const UNAVAILABLE = (tool) => `${tool} is not available on the thebird page yet`;

const failure = (content) => ({ content, isError: true });

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
  ];
}

export const PAGE_HOST_TOOLS = createPageHostTools();

export const PAGE_HOST_TOOL_NAMES = PAGE_HOST_TOOLS.map((tool) => tool.name);

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
