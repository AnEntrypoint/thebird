#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_ROOT, startWebHost } from '../src/web-host.js';
import { managedHostStatus, startManagedHost, stopManagedHost } from '../src/web-host-manager.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const action = argv[0] ?? 'start';
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const host = option('host', DEFAULT_HOST);
const port = Number(option('port', DEFAULT_PORT));
const root = option('root', DEFAULT_ROOT);
const isolated = !argv.includes('--no-isolation');
const managed = { projectRoot, host, port, root, isolated };

if (action === 'serve') {
  const server = await startWebHost({ host, port, root, isolated, projectRoot });
  console.log(`thebird web host listening on ${server.url}`);
  console.log(`site root: ${server.root}`);
  console.log(`isolation: ${server.isolated ? 'coop-coep' : 'plain'}`);
  console.log(`pid: ${process.pid}`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else if (action === 'start') {
  let result;
  try {
    result = await startManagedHost(managed);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!result.started) {
    console.log(`thebird web host already running on ${result.url}`);
    console.log(`pid: ${result.pid}`);
    process.exit(0);
  }
  console.log(`thebird web host listening on ${result.url}`);
  console.log(`site root: ${result.root}`);
  console.log(`isolation: ${isolated ? 'coop-coep' : 'plain'}`);
  console.log(`pid: ${result.pid}`);
  console.log(`log: ${result.log}`);
} else if (action === 'stop') {
  const pid = await stopManagedHost(managed);
  console.log(pid === null ? 'no managed web host is running' : `stopped web host pid ${pid}`);
} else if (action === 'status') {
  const entry = await managedHostStatus(managed);
  if (entry) {
    console.log(`running ${entry.url} pid ${entry.pid} root ${entry.root}`);
    process.exit(0);
  }
  console.log('stopped');
  process.exit(1);
} else {
  console.error('usage: thebird-web-host.js start|stop|status|serve [--host H] [--port P] [--root R] [--no-isolation]');
  process.exit(2);
}
