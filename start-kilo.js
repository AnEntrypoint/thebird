#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const kiloPort = get('--kilo-port', '4780');
const ocPort = get('--opencode-port', '4790');
const fsPort = get('--fs-port', '4781');
const origin = get('--origin', 'http://localhost:8787');
const sandbox = path.resolve(get('--sandbox', '.sandbox'));
fs.mkdirSync(sandbox, { recursive: true });
try { fs.writeFileSync(path.join(sandbox, '.gitignore'), '*\n!.gitignore\n'); } catch (e) {}

const isWin = os.platform() === 'win32';
const kiloBin = isWin ? process.env.USERPROFILE + '\\AppData\\Roaming\\npm\\node_modules\\@kilocode\\cli\\node_modules\\@kilocode\\cli-windows-x64\\bin\\kilo.exe' : 'kilo';
const ocBin = isWin ? process.env.USERPROFILE + '\\AppData\\Roaming\\npm\\node_modules\\opencode-windows-x64\\bin\\opencode.exe' : 'opencode';

const procs = [];
const launch = (name, bin, port) => {
  if (args.includes('--no-' + name)) return;
  if (!fs.existsSync(bin)) { console.log(`[${name}] skip (${bin} not found)`); return; }
  const p = spawn(bin, ['serve', '--port', port, '--hostname', '127.0.0.1', '--cors', origin], { stdio: 'inherit', env: process.env, cwd: sandbox });
  procs.push(p);
  console.log(`[${name}] serve --port ${port} pid ${p.pid}`);
};
launch('kilo', kiloBin, kiloPort);
launch('opencode', ocBin, ocPort);

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
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }
  const full = path.resolve(path.join(sandbox, rel));
  if (!full.startsWith(sandbox)) { res.writeHead(403, cors); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, cors); res.end(); return; }
    const ct = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.md':'text/plain','.txt':'text/plain' }[path.extname(rel)] || 'application/octet-stream';
    res.writeHead(200, { ...cors, 'Content-Type': ct }); res.end(data);
  });
});
srv.listen(fsPort, '127.0.0.1', () => console.log(`[fs-bridge] sandbox=${sandbox} serving http://127.0.0.1:${fsPort}`));

const stop = () => { try { srv.close(); } catch (e) {} for (const p of procs) { try { p.kill(); } catch (e) {} } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
