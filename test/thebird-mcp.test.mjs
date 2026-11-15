import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createThebirdMcp } from '../src/thebird-mcp.js';

const serve = async (options) => {
  const mcp = createThebirdMcp(options);
  const server = createServer((req, res) => {
    mcp.handle(req, res, new URL(req.url, 'http://127.0.0.1').pathname).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
};

const post = (base, path, body, headers = { 'content-type': 'application/json' }) => fetch(base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

const rpc = (base, message) => post(base, '/__thebird/mcp/thebird', message).then((response) => response.json());

const call = (base, name, args = {}) => rpc(base, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

const toolValue = (reply) => JSON.parse(reply.result.content[0].text);

const pane = (lines) => ({ cols: 80, rows: 24, cursor: { x: 2, y: 1 }, lines });

test('a state snapshot is stored and thebird_pane returns its trailing lines', async () => {
  const { base, close } = await serve({ now: () => 1000 });
  try {
    const stored = await post(base, '/__thebird/state', { pane: pane(['one', 'two', 'three']), run: { busy: false }, other: 'dropped' });
    assert.equal(stored.status, 204);
    const reply = await call(base, 'thebird_pane', { lines: 2 });
    assert.equal(reply.jsonrpc, '2.0');
    assert.equal(reply.id, 1);
    assert.equal(reply.result.isError, undefined);
    const value = toolValue(reply);
    assert.deepEqual(value.lines, ['two', 'three']);
    assert.equal(value.cols, 80);
    assert.equal(value.rows, 24);
    assert.deepEqual(value.cursor, { x: 2, y: 1 });
    assert.equal(value.updatedAt, 1000);
    assert.equal(value.stale, false);
  } finally {
    await close();
  }
});

test('thebird_pane caps the requested lines at 500 and defaults to 60', async () => {
  const { base, close } = await serve({ now: () => 1000 });
  try {
    const lines = Array.from({ length: 700 }, (_, index) => 'line ' + index);
    await post(base, '/__thebird/state', { pane: pane(lines) });
    assert.equal(toolValue(await call(base, 'thebird_pane', { lines: 9000 })).lines.length, 500);
    assert.equal(toolValue(await call(base, 'thebird_pane')).lines.length, 60);
  } finally {
    await close();
  }
});

test('the snapshot goes stale once now advances past staleMs', async () => {
  let clock = 1000;
  const { base, close } = await serve({ now: () => clock, staleMs: 5000 });
  try {
    await post(base, '/__thebird/state', { pane: pane(['hello']), run: { busy: true, command: 'sleep 9' } });
    assert.equal(toolValue(await call(base, 'thebird_pane')).stale, false);
    assert.equal(toolValue(await call(base, 'thebird_run')).stale, false);
    clock = 7000;
    const paneValue = toolValue(await call(base, 'thebird_pane'));
    assert.equal(paneValue.stale, true);
    assert.deepEqual(paneValue.lines, ['hello']);
    const run = toolValue(await call(base, 'thebird_run'));
    assert.equal(run.stale, true);
    assert.equal(run.busy, true);
    assert.equal(run.command, 'sleep 9');
  } finally {
    await close();
  }
});

test('before any snapshot the pane is stale and empty, and the run is stale', async () => {
  const { base, close } = await serve({ now: () => 1000 });
  try {
    assert.deepEqual(toolValue(await call(base, 'thebird_pane')), { stale: true, lines: [] });
    assert.deepEqual(toolValue(await call(base, 'thebird_run')), { updatedAt: null, stale: true });
  } finally {
    await close();
  }
});

test('thebird_run merges the run snapshot and includes fx when present', async () => {
  const { base, close } = await serve({ now: () => 1000 });
  try {
    await post(base, '/__thebird/state', { run: { busy: false, cwd: '/workspace', lastExitCode: 0 }, fx: { state: 'running', model: 'm1' } });
    assert.deepEqual(toolValue(await call(base, 'thebird_run')), { busy: false, cwd: '/workspace', lastExitCode: 0, updatedAt: 1000, stale: false, fx: { state: 'running', model: 'm1' } });
  } finally {
    await close();
  }
});

test('thebird_run passes the fx payload through unchanged, nulls included', async () => {
  const { base, close } = await serve({ now: () => 1000 });
  try {
    const fx = { bottomLine: null, activeRun: null, browser: null, updatedAt: '2026-11-15T10:00:00.000Z' };
    await post(base, '/__thebird/state', { run: { busy: false }, fx });
    assert.deepEqual(toolValue(await call(base, 'thebird_run')).fx, fx);
    await post(base, '/__thebird/state', { run: { busy: false }, fx: null });
    assert.equal(toolValue(await call(base, 'thebird_run')).fx, null);
  } finally {
    await close();
  }
});

test('thebird_ports reports the supervisor status, and an empty list without one', async () => {
  const fixed = [{ id: 'web', port: 4001, state: 'running' }, { id: 'api', port: 4002, state: 'stopped' }];
  const withSupervisor = await serve({ supervisor: { status: () => fixed } });
  try {
    assert.deepEqual(toolValue(await call(withSupervisor.base, 'thebird_ports')), { apps: fixed });
  } finally {
    await withSupervisor.close();
  }
  const bare = await serve({});
  try {
    assert.deepEqual(toolValue(await call(bare.base, 'thebird_ports')), { apps: [] });
  } finally {
    await bare.close();
  }
});

test('a tool whose handler throws answers with isError true', async () => {
  const { base, close } = await serve({ supervisor: { status: () => { throw new Error('supervisor down'); } } });
  try {
    const reply = await call(base, 'thebird_ports');
    assert.equal(reply.result.isError, true);
    assert.deepEqual(toolValue(reply), { error: 'supervisor down' });
  } finally {
    await close();
  }
});

test('the JSON-RPC handshake, tool list and notifications', async () => {
  const { base, close } = await serve({});
  try {
    const init = await rpc(base, { jsonrpc: '2.0', id: 'a', method: 'initialize', params: {} });
    assert.deepEqual(init.result, { protocolVersion: '2024-11-05', serverInfo: { name: 'thebird', version: '0.2.0' }, capabilities: { tools: {} } });
    const list = await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.result.tools.map((tool) => tool.name), ['thebird_pane', 'thebird_run', 'thebird_ports']);
    const note = await post(base, '/__thebird/mcp/thebird', { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    assert.equal(await note.text(), '');
  } finally {
    await close();
  }
});

test('JSON-RPC errors: parse error, unknown method, unknown tool', async () => {
  const { base, close } = await serve({});
  try {
    const parse = await post(base, '/__thebird/mcp/thebird', '{not json');
    assert.equal((await parse.json()).error.code, -32700);
    const unknown = await rpc(base, { jsonrpc: '2.0', id: 7, method: 'resources/read' });
    assert.equal(unknown.id, 7);
    assert.equal(unknown.error.code, -32601);
    const tool = await rpc(base, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'thebird_shell' } });
    assert.equal(tool.error.code, -32602);
  } finally {
    await close();
  }
});

test('an oversized state body is refused with 413', async () => {
  const { base, close } = await serve({});
  try {
    const big = JSON.stringify({ pane: { lines: ['x'.repeat(300 * 1024)] } });
    const response = await post(base, '/__thebird/state', big);
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const after = await call(base, 'thebird_pane');
    assert.deepEqual(toolValue(after), { stale: true, lines: [] });
  } finally {
    await close();
  }
});

test('the descriptor is served on GET and every JSON reply is no-store', async () => {
  const { base, close } = await serve({});
  try {
    const response = await fetch(base + '/__thebird/mcp/thebird');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const descriptor = await response.json();
    assert.equal(descriptor.name, 'thebird');
    assert.equal(descriptor.transport, 'json-rpc-post');
    assert.equal(descriptor.endpoint, '/__thebird/mcp/thebird');
    assert.deepEqual(descriptor.tools.map((tool) => tool.name), ['thebird_pane', 'thebird_run', 'thebird_ports']);
  } finally {
    await close();
  }
});
