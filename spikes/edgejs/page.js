import { Wasmer } from './sdk/dist/index.js';

const program = String.raw`
const fs = require('node:fs');
fs.writeFileSync('/tmp/spike.txt', 'spike-fs-ok');
const back = fs.readFileSync('/tmp/spike.txt', 'utf8');
setTimeout(async () => {
  const res = await fetch(process.argv[1]);
  console.log(JSON.stringify({ back, timer: true, status: res.status, body: (await res.text()).trim() }));
}, 50);
`;

const runPackage = async (wasmer, name) => {
  const started = performance.now();
  try {
    const sandbox = await wasmer.sandboxes.create({ packages: [name], network: { mode: 'http' } });
    const loadMs = performance.now() - started;
    const output = await sandbox.command('node', ['-e', program, new URL('fetch.txt', location.href).href]).run();
    const text = output.text();
    const line = text.split('\n').find((row) => row.startsWith('{'));
    return { name, loadMs, runMs: performance.now() - started - loadMs, result: line ? JSON.parse(line) : null, text: text.slice(-400) };
  } catch (error) {
    return { name, loadMs: performance.now() - started, error: String(error?.message ?? error).slice(0, 400) };
  }
};

const packages = JSON.parse(new URL(location.href).searchParams.get('packages'));
const wasmer = new Wasmer();
const results = [];
for (const name of packages) results.push(await runPackage(wasmer, name));
await wasmer.close().catch(() => {});
document.body.dataset.result = JSON.stringify(results);
