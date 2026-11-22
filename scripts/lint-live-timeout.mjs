import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'live-timeout-'));
const lint = spawn(process.execPath, [join(root, 'scripts', 'lint-architecture.mjs')], { cwd: root, env: { ...process.env, TMPDIR: scratch, THEBIRD_LIVE_TIMEOUT_MS: '8000' }, stdio: 'ignore' });
await new Promise((done) => lint.on('close', done));
await new Promise((done) => setTimeout(done, 8000));
const named = (await import('node:child_process')).spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(scratch));
const entries = readdirSync(scratch).filter((name) => name !== 'node-compile-cache');
rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ entries, processes: named.length }));
process.exit(entries.length === 0 && named.length === 0 ? 0 : 1);
