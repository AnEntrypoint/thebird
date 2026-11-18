import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRelay } from '../src/relay.js';

const withRelay = async (run) => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'thebird-relay-'));
  const relay = await startRelay({ host: '127.0.0.1', port: 0, projectRoot, ensureHost: false, log: () => {} });
  try {
    await run(relay.url);
  } finally {
    await relay.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
};

const post = (base, path, body) => fetch(new URL(path, base), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('the relay answers the page POSTs to the registry, the MCP route and the state route on its own origin', () => withRelay(async (base) => {
  const registered = await post(base, '/__thebird/registry', { id: 'relay-app' });
  assert.equal(registered.status, 200);
  assert.equal((await registered.json()).entry.id, 'relay-app');
  const rpc = await post(base, '/__thebird/mcp/thebird', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'thebird_ports', arguments: {} } });
  assert.equal(rpc.status, 200);
  assert.equal((await rpc.json()).result.isError ?? false, false);
  const state = await post(base, '/__thebird/state', { version: 1, pane: [] });
  assert.equal(state.status, 204);
}));

test('a published page is served at /sites/<id>/ and a path that leaves the folder is refused', () => withRelay(async (base) => {
  const html = '<!doctype html><button id="go">go</button>';
  const published = await post(base, '/__thebird/registry', {
    id: 'ha',
    title: 'ha',
    files: {
      'index.html': { encoding: 'utf8', data: html },
      'js/app.js': { encoding: 'base64', data: Buffer.from('console.log(1)').toString('base64') },
    },
  });
  assert.equal(published.status, 200);
  const page = await fetch(new URL('/sites/ha/', base));
  assert.equal(page.status, 200);
  assert.equal(await page.text(), html);
  const script = await fetch(new URL('/sites/ha/js/app.js', base));
  assert.equal(await script.text(), 'console.log(1)');
  const escape = await post(base, '/__thebird/registry', { id: 'bad', files: { '../x.html': { data: 'x' } } });
  assert.equal(escape.status, 400);
}));

test('a loopback port is reached through the page origin', () => withRelay(async (base) => {
  const upstream = createServer((req, res) => res.end('upstream ' + req.url));
  await new Promise((ok) => upstream.listen(0, '127.0.0.1', ok));
  try {
    const { port } = upstream.address();
    const reply = await fetch(new URL(`/__thebird/port/${port}/hello?x=1`, base));
    assert.equal(reply.status, 200);
    assert.equal(await reply.text(), 'upstream /hello?x=1');
  } finally {
    upstream.closeAllConnections();
    upstream.close();
  }
}));

test('the relay still returns 404 for a static path it does not serve', () => withRelay(async (base) => {
  assert.equal((await fetch(new URL('/no-such-file', base))).status, 404);
}));
