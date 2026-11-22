import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(join(root, 'scripts', 'reds.json'), 'utf8'));
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !table.some((red) => red.name === name));
if (unknown.length) {
  console.error('unknown red: ' + unknown.join(', '));
  process.exit(2);
}
let live = null;
const stopLive = () => {
  if (!live) return;
  if (live.child) try { process.kill(-live.child.pid, 'SIGKILL'); } catch {}
  writeFileSync(live.file, live.text);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopLive(); process.exit(130); });
const command = (red) => (red.command ? [red.command[0], red.command.slice(1)] : [process.execPath, [join(root, 'scripts', 'witness.mjs'), '--check=' + red.check]]);
const runWitness = (red) => new Promise((resolve) => {
  const [program, args] = command(red);
  live.child = spawn(program, args, { cwd: root, stdio: 'ignore', detached: true });
  const timer = setTimeout(() => process.kill(-live.child.pid, 'SIGKILL'), red.timeoutMs ?? 1500000);
  live.child.on('close', (code) => { clearTimeout(timer); resolve(code); });
});
let missed = 0;
for (const red of table.filter((entry) => wanted.length === 0 || wanted.includes(entry.name))) {
  const file = join(root, red.file);
  const text = readFileSync(file, 'utf8');
  const hits = text.split(red.anchor).length - 1;
  if (hits !== 1) {
    console.log('RED ' + red.name + ' ANCHOR ' + hits);
    missed++;
    continue;
  }
  live = { file, text };
  writeFileSync(file, text.replace(red.anchor, () => red.replace));
  const started = Date.now();
  const status = await runWitness(red);
  writeFileSync(file, text);
  live = null;
  const restored = readFileSync(file, 'utf8') === text;
  const caught = status !== 0 && status !== null;
  console.log('RED ' + red.name + ' ' + (caught ? 'CAUGHT' : 'MISSED') + ' rc=' + status + ' restored=' + restored + ' ' + ((Date.now() - started) / 1000).toFixed(0) + 's');
  if (!caught || !restored) missed++;
}
console.log(missed ? 'reds: ' + missed + ' missed' : 'reds: all caught');
process.exit(missed ? 1 : 0);
