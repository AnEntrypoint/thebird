#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const kiloPort = get('--kilo-port', '4780');
const ocPort = get('--opencode-port', '4790');
const origin = get('--origin', 'http://localhost:8787');
const sandbox = path.resolve(get('--sandbox', '.sandbox'));
fs.mkdirSync(sandbox, { recursive: true });
try { fs.writeFileSync(path.join(sandbox, '.gitignore'), '*\n!.gitignore\n'); } catch (e) {}

const isWin = os.platform() === 'win32';
const kiloBin = isWin ? process.env.USERPROFILE + '\\AppData\\Roaming\\npm\\node_modules\\@kilocode\\cli\\node_modules\\@kilocode\\cli-windows-x64\\bin\\kilo.exe' : 'kilo';
const ocBin = isWin ? process.env.USERPROFILE + '\\AppData\\Roaming\\npm\\node_modules\\opencode-windows-x64\\bin\\opencode.exe' : 'opencode';

const procs = [];
const launch = (name, bin, port) => {
  if (!args.includes('--no-' + name) && fs.existsSync(bin)) {
    const p = spawn(bin, ['serve', '--port', port, '--hostname', '127.0.0.1', '--cors', origin], { stdio: 'inherit', env: process.env, cwd: sandbox });
    procs.push(p);
    console.log(`[${name}] serve --port ${port} pid ${p.pid}`);
  } else if (!fs.existsSync(bin)) console.log(`[${name}] skip (${bin} not found)`);
};
launch('kilo', kiloBin, kiloPort);
launch('opencode', ocBin, ocPort);

const stop = () => { for (const p of procs) { try { p.kill(); } catch (e) {} } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
Promise.all(procs.map(p => new Promise(r => p.on('exit', r)))).then(() => process.exit(0));
