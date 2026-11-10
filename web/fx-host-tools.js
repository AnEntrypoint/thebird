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

export function initializeHostTools(instance) {
  const bytes = new TextEncoder().encode(pageHostToolsJson());
  const memory = instance.exports.memory;
  const ptr = memory.buffer.byteLength;
  memory.grow(Math.ceil(bytes.byteLength / 65536));
  new Uint8Array(memory.buffer, ptr, bytes.byteLength).set(bytes);
  const count = instance.exports.fx_terminal_initialize(ptr, bytes.byteLength);
  if (count < 0) throw new Error('fx_terminal_initialize rejected the host tools');
  globalThis.thebirdHostToolCount = count;
  return count;
}

export function pageHostToolsJson() {
  return JSON.stringify({
    tools: PAGE_HOST_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  });
}
