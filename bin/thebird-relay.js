#!/usr/bin/env node
import { startRelay } from '../src/relay.js';

const options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') options.port = Number(argv[++i]);
  else if (argv[i] === '--host') options.host = argv[++i];
  else if (argv[i] === '--workspace') options.workspace = argv[++i];
  else if (argv[i] === '--gm-home') options.gmHome = argv[++i];
}

const relay = await startRelay(options);
console.log(`thebird relay listening on ${relay.url} (open it in a browser for the terminal)`);
process.on('SIGINT', async () => {
  await relay.close();
  process.exit(0);
});
