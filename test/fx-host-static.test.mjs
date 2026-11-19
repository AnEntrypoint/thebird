import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPageHostTools } from '../web/fx-host-tools.js';

const pagesOrigin = () => {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (init.method === 'POST') return new Response('Method Not Allowed', { status: 405 });
    return new Response('<!DOCTYPE html><title>404</title>', { status: 404, headers: { 'content-type': 'text/html' } });
  };
  return { calls, fetchStub };
};

const nodeOrigin = () => {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      const text = JSON.stringify({ apps: [{ id: 'node-app', port: 4001, state: 'running' }], called: body.params.name });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ name: 'thebird', transport: 'json-rpc-post' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchStub };
};

const withFetch = async (stub, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const snapshot = () => ({
  pane: { cols: 80, rows: 24, cursor: { x: 1, y: 2 }, lines: ['one', 'two', 'three'] },
  run: { busy: true, command: 'fx', cwd: '/workspace', lastExitCode: 0, startedAt: 1, engine: { shell: 'ready' } },
  fx: { bottomLine: 'fx: running' },
});

const toolsFor = (publish = async () => { throw new Error('publish must not run on a static page'); }) => Object.fromEntries(
  createPageHostTools({ localState: snapshot, publish }).map((tool) => [tool.name, tool]),
);

test('a static origin answers 405 to POST and 404 to GET: thebird_run and thebird_pane read the page itself, with no POST', async () => {
  const { calls, fetchStub } = pagesOrigin();
  const tools = toolsFor();
  await withFetch(fetchStub, async () => {
    const run = await tools.thebird_run.execute({});
    assert.equal(run.isError, undefined);
    const runValue = JSON.parse(run.content);
    assert.equal(runValue.command, 'fx');
    assert.equal(runValue.busy, true);
    assert.equal(runValue.current, true);
    assert.equal(runValue.stale, false);
    const pane = await tools.thebird_pane.execute({ lines: 2 });
    assert.equal(pane.isError, undefined);
    assert.deepEqual(JSON.parse(pane.content).lines, ['two', 'three']);
  });
  assert.deepEqual(calls.filter((call) => call.method === 'POST'), []);
});

test('a static origin fails thebird_ports, thebird_register and thebird_unregister by name, says the page is static, and never says npm run host', async () => {
  const { calls, fetchStub } = pagesOrigin();
  let published = false;
  const tools = toolsFor(async () => {
    published = true;
  });
  await withFetch(fetchStub, async () => {
    for (const [name, input] of [['thebird_ports', {}], ['thebird_register', { id: 'ha', dir: '/workspace/ha' }], ['thebird_register', { id: 'ha' }], ['thebird_unregister', { id: 'ha' }]]) {
      const reply = await tools[name].execute(input);
      assert.equal(reply.isError, true, name);
      assert.match(reply.content, new RegExp(`^${name} is unavailable on this static page: `), name);
      assert.doesNotMatch(reply.content, /npm run host/, name);
      assert.doesNotMatch(reply.content, /HTTP 405/, name);
    }
  });
  assert.equal(published, false);
  assert.deepEqual(calls.filter((call) => call.method === 'POST'), []);
});

test('a Node host at the origin answers the probe, so the thebird tools go to it over POST', async () => {
  const { calls, fetchStub } = nodeOrigin();
  const tools = toolsFor();
  await withFetch(fetchStub, async () => {
    const ports = await tools.thebird_ports.execute({});
    assert.equal(ports.isError, false);
    assert.equal(JSON.parse(ports.content).called, 'thebird_ports');
  });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});
