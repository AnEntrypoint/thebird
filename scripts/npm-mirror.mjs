import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UPSTREAM = 'https://registry.npmjs.org';

export async function startNpmMirror({ dir = join(tmpdir(), 'thebird-npm-cache'), port = 0, upstream = UPSTREAM } = {}) {
  mkdirSync(dir, { recursive: true });
  let base = '';
  const cachePath = (key) => join(dir, createHash('sha256').update(key).digest('hex'));
  const stats = { hits: 0, misses: 0 };
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'accept, content-type');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    const key = `${upstream}${req.url}`;
    const file = cachePath(key);
    const tarball = req.url.endsWith('.tgz');
    try {
      if (!existsSync(file)) {
        stats.misses++;
        const response = await fetch(key);
        if (!response.ok) return res.writeHead(response.status).end();
        const body = Buffer.from(await response.arrayBuffer());
        writeFileSync(file, body);
        writeFileSync(`${file}.type`, response.headers.get('content-type') ?? 'application/json');
      } else {
        stats.hits++;
      }
      const type = readFileSync(`${file}.type`, 'utf8');
      const stored = readFileSync(file);
      const body = tarball ? stored : Buffer.from(stored.toString('utf8').replaceAll(upstream, base));
      res.writeHead(200, { 'content-type': type, 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`mirror: ${err.message}`);
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: base,
    stats,
    close: () => new Promise((ok) => {
      server.closeAllConnections();
      server.close(ok);
    }),
  };
}
