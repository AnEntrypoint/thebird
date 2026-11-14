#!/usr/bin/env node
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCraftApps, createSamples, craftStatus, craftRuntime, callCraft, appForFile, appForIntent, craftDescriptor, readCraftConfig } from '../src/craft-registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [action, value, ...rest] = process.argv.slice(2);
if (action === 'ensure') {
  const apps = await ensureCraftApps(root);
  console.log(JSON.stringify({ ok: true, registered: Object.keys(apps), lazy: true }));
} else if (action === 'sample' || action === 'samples') {
  console.log(JSON.stringify({ ok: true, samples: await createSamples(root) }, null, 2));
} else if (action === 'status') {
  console.log(JSON.stringify(await craftStatus(root), null, 2));
} else if (action === 'processes') {
  console.log(JSON.stringify(await craftRuntime(root), null, 2));
} else if (action === 'intent') {
  const app = appForIntent(rest.join(' ') || value);
  console.log(JSON.stringify({ ok: Boolean(app), app: app?.id ?? null, input: rest.join(' ') || value }));
} else if (action === 'app') {
  const app = appForFile(value);
  console.log(JSON.stringify({ ok: Boolean(app), app: app?.id ?? null, file: value }));
} else if (action === 'open' || action === 'call') {
  const app = appForFile(value) ?? (await readCraftConfig(root))[value];
  if (!app) { console.error('unknown craft app or file type: ' + value); process.exit(2); }
  const method = rest[0] ?? (action === 'open' ? 'open' : 'info');
  const params = { file: action === 'open' ? basename(value) : rest[1] };
  console.log(JSON.stringify(await callCraft(root, app.id, method, params), null, 2));
} else if (action === 'descriptor') {
  const apps = await readCraftConfig(root);
  const app = apps[value];
  if (!app) { console.error('unknown craft app: ' + value); process.exit(2); }
  console.log(JSON.stringify(await craftDescriptor(root, app), null, 2));
} else if (action === 'stop') {
  console.log(JSON.stringify({ ok: true, stopped: [], note: 'native CLI adapters exit after each task; no resident process to stop' }));
} else {
  console.error('usage: node bin/thebird-craft.js ensure|sample|status|processes|intent <text>|app <file>|open <file>|call <app> <method> [file]|descriptor <app>|stop [app]');
  process.exit(2);
}
