import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { once } from 'node:events';
import { parseSitePath, siteBase, proxyHttp, proxyUpgrade } from '../src/app-proxy.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closeServer = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });

const call = (port, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers }, async (res) => {
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
  });
  req.on('error', reject);
  req.end(body);
});

const streamTimeline = { secondWriteAt: 0 };

const upstream = createServer((req, res) => {
  if (req.url.startsWith('/hang')) return;
  if (req.url.startsWith('/stream')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write('data: one\n\n');
    setTimeout(() => {
      streamTimeline.secondWriteAt = Date.now();
      res.end('data: two\n\n');
    }, 100);
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      prefix: req.headers['x-forwarded-prefix'],
      host: req.headers.host,
      forwardedHost: req.headers['x-forwarded-host'],
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
});

upstream.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: test\r\nconnection: Upgrade\r\n\r\nseen:${req.url}:${req.headers['x-forwarded-prefix']}\n`);
  const echo = (chunk) => socket.write(`echo:${chunk}`);
  if (head.length) echo(head);
  socket.on('data', echo);
  socket.on('end', () => socket.end());
});

let upstreamPort;
let closedPort;
let proxy;
let proxyPort;

before(async () => {
  upstreamPort = await listen(upstream);
  const probe = createNetServer();
  closedPort = await listen(probe);
  await closeServer(probe);
  proxy = createServer((req, res) => {
    const site = parseSitePath(req.url.split('?')[0]);
    if (site?.id !== 'demo') { res.writeHead(404); return res.end('not found'); }
    const port = req.url.startsWith('/sites/demo/closed') ? closedPort : upstreamPort;
    proxyHttp(req, res, { port, basePath: siteBase('demo'), extraHeaders: { 'cross-origin-opener-policy': 'same-origin' } });
  });
  proxy.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, { port: upstreamPort, basePath: siteBase('demo') }));
  proxyPort = await listen(proxy);
});

after(async () => {
  await closeServer(proxy);
  await closeServer(upstream);
});

test('GET keeps the rest of the path and query and sets the prefix', async () => {
  const res = await call(proxyPort, '/sites/demo/a/b?x=1');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
  const seen = JSON.parse(res.text);
  assert.equal(seen.method, 'GET');
  assert.equal(seen.url, '/a/b?x=1');
  assert.equal(seen.prefix, '/sites/demo');
  assert.equal(seen.host, `127.0.0.1:${upstreamPort}`);
  assert.equal(seen.forwardedHost, `127.0.0.1:${proxyPort}`);
});

test('POST body arrives intact', async () => {
  const body = 'x'.repeat(200000) + 'end';
  const res = await call(proxyPort, '/sites/demo/submit', { method: 'POST', headers: { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) }, body });
  const seen = JSON.parse(res.text);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/submit');
  assert.equal(seen.body, body);
});

test('bare site path redirects with 308 to the trailing slash, keeping the query', async () => {
  const bare = await call(proxyPort, '/sites/demo');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.location, '/sites/demo/');
  const withQuery = await call(proxyPort, '/sites/demo?x=2');
  assert.equal(withQuery.status, 308);
  assert.equal(withQuery.headers.location, '/sites/demo/?x=2');
});

test('an event-stream reaches the client before the second chunk is written', async () => {
  streamTimeline.secondWriteAt = 0;
  const req = request({ host: '127.0.0.1', port: proxyPort, path: '/sites/demo/stream' });
  const res = await new Promise((resolve, reject) => { req.on('response', resolve); req.on('error', reject); req.end(); });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream');
  const seen = [];
  res.on('data', (chunk) => seen.push({ at: Date.now(), text: chunk.toString('utf8') }));
  await once(res, 'end');
  assert.ok(seen.length >= 2, `expected two chunks, got ${seen.length}`);
  assert.ok(streamTimeline.secondWriteAt > 0);
  assert.ok(seen[0].at < streamTimeline.secondWriteAt, 'first chunk arrived after the second was written');
  assert.match(seen[0].text, /data: one/);
  assert.equal(seen.map((s) => s.text).join(''), 'data: one\n\ndata: two\n\n');
});

test('a closed upstream port answers 502 app not reachable', async () => {
  const res = await call(proxyPort, '/sites/demo/closed/x');
  assert.equal(res.status, 502);
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(res.text, 'app not reachable');
});

test('an upstream that never answers gets 504 app timed out', { timeout: 40000 }, async () => {
  const res = await call(proxyPort, '/sites/demo/hang');
  assert.equal(res.status, 504);
  assert.equal(res.text, 'app timed out');
});

test('a WebSocket-style upgrade gets the 101 and the echoed bytes through the proxy', async () => {
  const sock = connect(proxyPort, '127.0.0.1');
  await once(sock, 'connect');
  let buffer = '';
  sock.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
  sock.on('error', () => {});
  sock.write('GET /sites/demo/ws?y=2 HTTP/1.1\r\nHost: localhost\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n');
  sock.write('hello');
  const deadline = Date.now() + 5000;
  while (!buffer.includes('echo:hello') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  sock.destroy();
  assert.match(buffer, /^HTTP\/1\.1 101 Switching Protocols/);
  assert.ok(buffer.includes('seen:/ws?y=2:/sites/demo'), buffer);
  assert.ok(buffer.includes('echo:hello'), buffer);
});

test('parseSitePath accepts valid ids and returns the remainder', () => {
  assert.deepEqual(parseSitePath('/sites/demo'), { id: 'demo', rest: '/' });
  assert.deepEqual(parseSitePath('/sites/demo/'), { id: 'demo', rest: '/' });
  assert.deepEqual(parseSitePath('/sites/demo/a/b'), { id: 'demo', rest: '/a/b' });
  assert.deepEqual(parseSitePath('/sites/my_app-1/x'), { id: 'my_app-1', rest: '/x' });
  assert.deepEqual(parseSitePath('/sites/%64emo/x'), { id: 'demo', rest: '/x' });
});

test('parseSitePath rejects paths without an id, invalid ids and other prefixes', () => {
  assert.equal(parseSitePath('/sites/'), null);
  assert.equal(parseSitePath('/sites'), null);
  assert.equal(parseSitePath('/sites/Demo'), null);
  assert.equal(parseSitePath('/sites/de.mo/x'), null);
  assert.equal(parseSitePath('/sites/%zz'), null);
  assert.equal(parseSitePath('/other/demo'), null);
  assert.equal(parseSitePath('/'), null);
});

test('siteBase builds the base path', () => {
  assert.equal(siteBase('demo'), '/sites/demo');
});
