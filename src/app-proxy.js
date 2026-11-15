import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const SITE_ID = /^[a-z0-9_-]+$/;
const SITE_PATH = /^\/sites\/([^/]+)(\/.*)?$/;
const UPSTREAM_TIMEOUT_MS = 30000;
const BAD_GATEWAY = 'HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n';

const dropHop = (headers) => Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP.has(name)));
const splitUrl = (url) => { const at = url.indexOf('?'); return at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at)]; };
const targetPath = (url, basePath) => { const rest = url.slice(basePath.length); return rest.startsWith('/') ? rest : '/' + rest; };

export function siteBase(id) { return '/sites/' + id; }

export function parseSitePath(pathname) {
  const match = SITE_PATH.exec(pathname);
  if (!match) return null;
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return null; }
  return SITE_ID.test(id) ? { id, rest: match[2] ?? '/' } : null;
}

export function proxyHttp(req, res, { port, basePath, extraHeaders = {} }) {
  const [pathname, query] = splitUrl(req.url);
  if (pathname === basePath) {
    res.writeHead(308, { location: basePath + '/' + query });
    return res.end();
  }

  const headers = dropHop(req.headers);
  delete headers.host;
  headers.host = `127.0.0.1:${port}`;
  headers['x-forwarded-prefix'] = basePath;
  if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;

  let settled = false;
  const finish = () => { settled = true; clearTimeout(timer); };
  const fail = (status, body) => {
    if (settled) return;
    finish();
    upstream.destroy();
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
  };

  const upstream = httpRequest({ host: '127.0.0.1', port, method: req.method, path: targetPath(req.url, basePath), headers });
  const timer = setTimeout(() => fail(504, 'app timed out'), UPSTREAM_TIMEOUT_MS);

  upstream.on('error', () => fail(502, 'app not reachable'));
  upstream.on('response', (up) => {
    finish();
    res.writeHead(up.statusCode, { ...dropHop(up.headers), ...extraHeaders });
    up.on('error', () => res.destroy());
    up.on('aborted', () => res.destroy());
    up.pipe(res);
  });
  res.on('close', () => { finish(); upstream.destroy(); });
  req.pipe(upstream);
}

export function proxyUpgrade(req, socket, head, { port, basePath }) {
  const lines = [`${req.method} ${targetPath(req.url, basePath)} HTTP/1.1`, `host: 127.0.0.1:${port}`, `x-forwarded-prefix: ${basePath}`];
  if (req.headers.host) lines.push(`x-forwarded-host: ${req.headers.host}`);
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    const lower = name.toLowerCase();
    if (lower !== 'host' && lower !== 'x-forwarded-prefix' && lower !== 'x-forwarded-host') lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
  }

  const upstream = connect(port, '127.0.0.1');
  let connected = false;
  upstream.once('connect', () => {
    connected = true;
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => { if (connected) socket.destroy(); else socket.end(BAD_GATEWAY); });
  upstream.on('close', () => { if (connected) socket.destroy(); });
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
}
