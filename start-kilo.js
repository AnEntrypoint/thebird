#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const kiloPort = get('--port', '4780');
const fsPort = get('--fs-port', '4781');
const origin = get('--origin', 'http://localhost:8787');
const sandbox = path.resolve(get('--sandbox', '.sandbox'));
fs.mkdirSync(sandbox, { recursive: true });
const kiloWin = process.env.USERPROFILE + '\\AppData\\Roaming\\npm\\node_modules\\@kilocode\\cli\\node_modules\\@kilocode\\cli-windows-x64\\bin\\kilo.exe';
const bin = os.platform() === 'win32' && fs.existsSync(kiloWin) ? kiloWin : 'kilo';
const kilo = spawn(bin, ['serve', '--port', kiloPort, '--hostname', '127.0.0.1', '--cors', origin], { stdio: 'inherit', env: process.env, cwd: sandbox });
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const srv = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const rel = decodeURIComponent(req.url.replace(/^\/+/, '').split('?')[0]);
  if (rel === '__list') {
    const out = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(sandbox, full).replace(/\\/g, '/'));
    }};
    try { walk(sandbox); } catch (e) {}
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  const full = path.resolve(path.join(sandbox, rel));
  if (!full.startsWith(sandbox)) { res.writeHead(403, cors); res.end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, cors); res.end('not found'); return; }
    const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain' }[path.extname(rel)] || 'application/octet-stream';
    res.writeHead(200, { ...cors, 'Content-Type': ct });
    res.end(data);
  });
});
srv.listen(fsPort, '127.0.0.1', () => console.log('[fs-bridge] sandbox=' + sandbox + ' serving http://127.0.0.1:' + fsPort));
kilo.on('exit', c => { srv.close(); process.exit(c || 0); });
process.on('SIGINT', () => { kilo.kill(); srv.close(); });
