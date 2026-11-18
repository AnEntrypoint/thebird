import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createThebirdHandler, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_ROOT, resolveSiteRoot } from './web-host.js';
import { buildSite, siteProblem, startManagedHost, stopManagedHost } from './web-host-manager.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(repoRoot, 'web');
const sdkRoot = resolve(repoRoot, 'sdk');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function within(root, rel) {
  const target = resolve(root, rel);
  return target.startsWith(root + sep) ? target : null;
}

function staticFile(pathname) {
  if (pathname === '/') return join(webRoot, 'terminal.html');
  if (pathname.startsWith('/web/')) return within(webRoot, pathname.slice('/web/'.length));
  if (pathname.startsWith('/sdk/')) return within(sdkRoot, pathname.slice('/sdk/'.length));
  return null;
}

async function serve(handler, req, res) {
  const pathname = new URL(req.url, 'http://relay').pathname;
  if (await handler.route(req, res, pathname)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end('method not allowed');
  }
  const file = staticFile(pathname);
  if (!file) {
    res.writeHead(404);
    return res.end('not found');
  }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

async function ensureCanonicalHost(projectRoot, log) {
  const options = { projectRoot, host: DEFAULT_HOST, port: DEFAULT_PORT, root: DEFAULT_ROOT, isolated: true };
  if (await siteProblem(projectRoot, resolveSiteRoot(DEFAULT_ROOT, projectRoot))) {
    log('building the canonical site');
    await stopManagedHost(options);
    await buildSite(projectRoot);
  }
  const host = await startManagedHost(options);
  log(host.started ? `canonical host started on ${host.url} (pid ${host.pid})` : `canonical host already running on ${host.url}`);
}

export async function startRelay({ host = '127.0.0.1', port = 0, projectRoot = repoRoot, ensureHost = true, log = (line) => console.log(line) } = {}) {
  const handler = await createThebirdHandler({ projectRoot, isolated: true });
  const server = createServer((req, res) => {
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('cross-origin-embedder-policy', 'require-corp');
    serve(handler, req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err.message);
    });
  });
  server.on('upgrade', (req, socket, head) => {
    handler.upgrade(req, socket, head).catch(() => socket.destroy());
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const { port: bound } = server.address();
  if (ensureHost) {
    ensureCanonicalHost(projectRoot, log).catch((error) => log(`canonical host not started: ${error.message}`));
  }
  return {
    url: `http://${host}:${bound}/`,
    close: async () => {
      await handler.close();
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    },
  };
}
