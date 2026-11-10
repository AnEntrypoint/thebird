import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_HOST_TOOLS, PAGE_HOST_TOOL_NAMES } from '../web/fx-host-tools.js';
import { streamPlan } from '../scripts/fx-stub-gateway.mjs';

const userPrompt = (text) => [{ role: 'user', content: [{ type: 'text', text }] }];
const pageTools = PAGE_HOST_TOOLS.map(({ name, inputSchema }) => ({ name, inputSchema }));

test('the page advertises exactly bash and ask, each with an object input schema', () => {
  assert.deepEqual(PAGE_HOST_TOOL_NAMES, ['bash', 'ask']);
  for (const tool of PAGE_HOST_TOOLS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.execute, 'function');
  }
});

test('the stub emits a tool call for a listed and advertised tool', () => {
  const plan = streamPlan({ prompt: userPrompt('[tool:bash] [input:{"command":"echo approval"}]'), tools: pageTools });
  assert.equal(plan.finish, 'tool-calls');
  assert.deepEqual(plan.events.at(-1), { type: 'tool-call', toolCallId: 'call_stub_1', toolName: 'bash', input: { command: 'echo approval' } });
});

test('the stub rejects a tool name that is not in the page list', () => {
  const plan = streamPlan({ prompt: userPrompt('[tool:WebSearch] [input:{}]'), tools: pageTools });
  assert.equal(plan.finish, 'stop');
  assert.ok(plan.events.every((event) => event.type !== 'tool-call'));
  assert.match(plan.events[0].delta, /tool-not-advertised=WebSearch/);
});

test('the stub rejects an unlisted name even when the request advertises it', () => {
  const plan = streamPlan({ prompt: userPrompt('[tool:rm] [input:{}]'), tools: [{ name: 'rm' }] });
  assert.ok(plan.events.every((event) => event.type !== 'tool-call'));
  assert.match(plan.events[0].delta, /tool-not-advertised=rm/);
});

test('a page tool reports that it is unavailable instead of running', () => {
  for (const tool of PAGE_HOST_TOOLS) {
    assert.match(tool.execute(), /is not available on the thebird page yet/);
  }
});
