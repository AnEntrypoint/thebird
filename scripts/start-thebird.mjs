import { startRelay } from '../src/relay.js';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const relay = await startRelay({
  host: option('host', '127.0.0.1'),
  port: Number(option('port', 0)),
  ensureHost: true,
});
console.log(`thebird terminal listening on ${relay.url}`);
const shutdown = async () => {
  await relay.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
