#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerServer, unregisterServer, listServers, statusServers, registryScaffoldExists } from '../src/webserver-registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [action, name, ...rest] = process.argv.slice(2);
const option = (key, fallback) => { const index = rest.indexOf('--' + key); return index === -1 ? fallback : rest[index + 1]; };
if (action === 'register') {
  const entry = await registerServer(root, name, { title: option('title'), description: option('description') });
  console.log(JSON.stringify(entry));
} else if (action === 'unregister') {
  const removed = await unregisterServer(root, name, { removeFolder: rest.includes('--remove-folder') });
  console.log(JSON.stringify({ id: name, removed }));
} else if (action === 'list') {
  console.log(JSON.stringify(await listServers(root), null, 2));
} else if (action === 'status') {
  console.log(JSON.stringify(await statusServers(root), null, 2));
} else if (action === 'scaffold-check') {
  console.log(JSON.stringify({ id: name, ok: await registryScaffoldExists(root, name) }));
} else {
  console.error('usage: node bin/thebird-webserver.js register|unregister|list|status|scaffold-check <id> [--title TITLE] [--description TEXT] [--remove-folder]');
  process.exit(2);
}
