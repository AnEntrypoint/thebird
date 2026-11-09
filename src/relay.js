import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
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
  return null;
}

async function serve(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end('method not allowed');
  }
  const file = staticFile(new URL(req.url, 'http://relay').pathname);
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

export async function startRelay({ host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer((req, res) => {
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('cross-origin-embedder-policy', 'require-corp');
    serve(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err.message);
    });
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const { port: bound } = server.address();
  return {
    url: `http://${host}:${bound}/`,
    close: () => new Promise((ok) => {
      server.closeAllConnections();
      server.close(ok);
    }),
  };
}
