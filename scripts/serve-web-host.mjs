#!/usr/bin/env node
import { startWebHost } from '../src/web-host.js';

const options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') options.port = Number(argv[++i]);
  else if (argv[i] === '--host') options.host = argv[++i];
  else if (argv[i] === '--root') options.root = argv[++i];
  else if (argv[i] === '--no-isolation') options.isolated = false;
}

const server = await startWebHost(options);
console.log(`thebird web host listening on ${server.url}`);
console.log(`site root: ${server.root}`);
console.log(`isolation: ${server.isolated ? 'coop-coep' : 'plain'}`);
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});
