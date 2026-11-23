import { Wasmer } from './sdk/dist/index.js';

const params = new URL(location.href).searchParams;
const packages = JSON.parse(params.get('packages'));
const steps = await (await fetch('steps.json')).json();
const fetchUrl = new URL('fetch.txt', location.href).href;

const timed = async (work) => {
  const started = performance.now();
  try {
    return { ...(await work()), ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { error: String(error?.message ?? error).slice(0, 400), ms: Math.round(performance.now() - started) };
  }
};

const runStep = (sandbox, step) => timed(async () => {
  const output = await sandbox.command('node', ['-e', step.code, ...(step.fetch ? [fetchUrl] : [])]).run();
  const out = output.text().trim();
  return { exitCode: output.exitCode, out: out.slice(-300), err: output.stderr.text().slice(-300), ok: output.exitCode === 0 && out.includes(step.expect) };
});

const runPackage = async (wasmer, name) => {
  const loaded = await timed(() => wasmer.sandboxes.create({ packages: [name], network: { mode: 'http' } }).then((sandbox) => ({ sandbox })));
  if (loaded.error) return { name, loadMs: loaded.ms, error: loaded.error, steps: [] };
  const results = [];
  for (const step of steps) results.push({ name: step.name, ...(await runStep(loaded.sandbox, step)) });
  return { name, loadMs: loaded.ms, steps: results };
};

const wasmer = new Wasmer();
const results = [];
for (const name of packages) results.push(await runPackage(wasmer, name));
await wasmer.close().catch(() => {});
document.body.dataset.result = JSON.stringify(results);
