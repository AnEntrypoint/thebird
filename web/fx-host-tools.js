const UNAVAILABLE = (tool) => `${tool} is not available on the thebird page yet`;

export const PAGE_HOST_TOOLS = [
  {
    name: 'bash',
    description: 'Run a bash command in the thebird shell.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
    writes: true,
    execute: () => UNAVAILABLE('bash'),
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
    execute: () => UNAVAILABLE('ask'),
  },
];

export const PAGE_HOST_TOOL_NAMES = PAGE_HOST_TOOLS.map((tool) => tool.name);

export function pageHostToolsJson() {
  return JSON.stringify({
    tools: PAGE_HOST_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  });
}
