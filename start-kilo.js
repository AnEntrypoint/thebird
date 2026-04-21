#!/usr/bin/env node
// thebird — start local Kilo Code backend for docs/ page
// usage: node start-kilo.js [--port 4780] [--origin http://localhost:8787]
const { spawn } = require('child_process');
const os = require('os');
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const originIdx = args.indexOf('--origin');
const port = portIdx >= 0 ? args[portIdx + 1] : '4780';
const origin = originIdx >= 0 ? args[originIdx + 1] : 'http://localhost:8787';
const isWin = os.platform() === 'win32';
const kiloWin = process.env.USERPROFILE + '\\AppData\\Roaming\\npm\\node_modules\\@kilocode\\cli\\node_modules\\@kilocode\\cli-windows-x64\\bin\\kilo.exe';
const kiloUnix = 'kilo';
const bin = isWin && require('fs').existsSync(kiloWin) ? kiloWin : kiloUnix;
const child = spawn(bin, ['serve', '--port', port, '--hostname', '127.0.0.1', '--cors', origin], { stdio: 'inherit', env: process.env });
child.on('exit', c => process.exit(c || 0));
process.on('SIGINT', () => child.kill());
