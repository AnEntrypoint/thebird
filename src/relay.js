import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGmClient } from './gm.js';
import { rewriteSpecifiers } from './shim-map.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = here;
const webRoot = resolve(here, '..', 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => ok(text));
    req.on('error', fail);
  });
}

function within(root, rel) {
  const target = resolve(root, rel);
  return target.startsWith(root + sep) ? target : null;
}

function staticFile(pathname) {
  if (pathname === '/') return join(webRoot, 'terminal.html');
  if (pathname.startsWith('/web/')) return within(webRoot, pathname.slice('/web/'.length));
  if (pathname.startsWith('/src/')) return within(srcRoot, pathname.slice('/src/'.length));
  return null;
}

async function serveStatic(pathname, res) {
  const file = staticFile(pathname);
  if (!file) {
    res.writeHead(404);
    return res.end('not found');
  }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

async function serveGm(pathname, res, gmHome) {
  const raw = pathname.startsWith('/gm-raw/');
  const file = within(resolve(gmHome, 'src'), pathname.slice(raw ? '/gm-raw/'.length : '/gm/'.length));
  if (!file || !['.mjs', '.js'].includes(extname(file))) {
    res.writeHead(404);
    return res.end('not found');
  }
  try {
    const source = await readFile(file, 'utf8');
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    res.end(raw ? source : rewriteSpecifiers(source));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

async function handle(req, res, gm) {
  const url = new URL(req.url, 'http://relay');
  if (req.method === 'GET' && (url.pathname.startsWith('/gm/') || url.pathname.startsWith('/gm-raw/'))) {
    return serveGm(url.pathname, res, gm.gmHome);
  }
  if (req.method === 'GET' && url.pathname === '/meta') {
    return sendJson(res, 200, { gmHome: gm.gmHome, workspace: gm.workspace, runDir: gm.runDir });
  }
  if (req.method === 'POST' && url.pathname === '/call') {
    let request;
    try {
      request = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, error: 'request body must be JSON' });
    }
    if (typeof request.verb !== 'string') return sendJson(res, 400, { ok: false, error: 'verb must be a string' });
    try {
      const result = await gm.call(request.verb, request.args ?? {});
      return sendJson(res, 200, { ok: true, result });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: err.message });
    }
  }
  if (req.method === 'GET') return serveStatic(url.pathname, res);
  return sendJson(res, 405, { ok: false, error: 'method not allowed' });
}

export async function startRelay({ host = '127.0.0.1', port = 0, workspace, gmHome } = {}) {
  const gm = await createGmClient({ workspace, gmHome });
  const server = createServer((req, res) => {
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('cross-origin-embedder-policy', 'require-corp');
    handle(req, res, gm).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: err.message });
    });
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const { port: bound } = server.address();
  return {
    url: `http://${host}:${bound}/`,
    async close() {
      await new Promise((ok) => server.close(ok));
      await gm.close();
    },
  };
}
