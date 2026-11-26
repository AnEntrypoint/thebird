import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer as createNetServer } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { startNpmMirror } from '../../npm-mirror.mjs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRelay } from '../../../src/relay.js';
import { closeBrowserTree, closeBrowserTrees, runTerminal, startBrowser, withTimeout } from '../../browser-driver.mjs';
import { vendorBashkit } from '../../vendor-bashkit.mjs';
import { vendorFx } from '../../vendor-fx.mjs';
import { vendorFloosie } from '../../vendor-floosie.mjs';
import { buildPages } from '../../build-pages.mjs';
import { startFxStubGateway, FX_STUB_KEY } from '../../fx-stub-gateway.mjs';
import { PAGE_HOST_TOOL_NAMES } from '../../../web/fx-host-tools.js';
import { COLD_START_MS, DEFAULT_CONTEXT_GROUPS, FX_TUI_TOOLS, GRAPHEMES, GROUP_BUDGET_MS, JOBS, LIVE_UNAVAILABLE, OPENROUTER_MODELS_URL, OPENROUTER_URL, PAGE_TOOLS, SITE_TYPES, TUI_PALETTE_RESIZE_SETTLED, TUI_RESIZE_SETTLED, TUI_SCREEN, TUI_STATE, TUI_TITLE, alive, binRunner, browserFor, check, chrome, craftCli, current, disposeContext, dotenvValue, fetchWithFallback, freeModels, freePort, getMirror, getRelay, group, groups, haveChrome, heavyTail, listening, liveCheck, liveProvider, liveRun, liveVerdict, loadAverage, pollAnswer, profileDir, providerVerdict, reapBrowserTrees, registryNet, root, runAt, runGroup, runHeavy, scope, scratchDir, scratchDirs, servePages, serveThenStop, services, shared, sharedBrowserFor, sharedBrowserStart, sharedPages, sharedProfile, skip, skipLive, spawnedPids, startChatStub, startProviderStub, stopPid, terminal, trackPid, webhostCli, webserverCli, within } from '../shared.mjs';

group('fetch', async () => {
  const corsHost = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('cors-host-hello\n'); });
  const plainHost = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('plain-host-hello\n'); });
  const plainAddress = Object.values(networkInterfaces()).flat().find((info) => info.family === 'IPv4' && !info.internal)?.address;
  if (!plainAddress) throw new Error('no non-loopback IPv4 address: loopback URLs go through the page proxy, so the CORS refusal needs a host the page reaches directly');
  await new Promise((resolve) => corsHost.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => plainHost.listen(0, plainAddress, resolve));
  const corsPort = corsHost.address().port;
  const plainPort = plainHost.address().port;
  const fetched = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', `curl -s http://127.0.0.1:${corsPort}/hello`],
    ['run', `wget -O notes/fetched.txt http://127.0.0.1:${corsPort}/hello`],
    ['run', 'cat notes/fetched.txt'],
    ['run', `wget -O /dev/null http://127.0.0.1:${corsPort}/hello && echo devnull-wget-ok`],
  ]);
  check('in-page curl and wget fetch from a host that sends CORS headers', fetched.out.split('\n').filter((line) => line === 'cors-host-hello').length >= 2, fetched.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  check('wget -O /dev/null fetches from a CORS host and discards the body without an error', /^devnull-wget-ok$/m.test(fetched.out) && !/ENOENT/.test(fetched.out), fetched.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const tjsFetch = await terminal([['run', `tjs -e "const r = await fetch('http://127.0.0.1:${corsPort}/hello'); console.log('tjs-fetch', r.status, (await r.text()).trim());"`]]);
  check('tjs -e awaits txiki fetch, and the request goes out through the page', /^tjs-fetch 200 cors-host-hello$/m.test(tjsFetch.out), tjsFetch.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const refused = await terminal([
    ['run', `curl -s http://${plainAddress}:${plainPort}/hello`],
    ['run', 'echo after-refusal'],
  ]);
  check('in-page curl refuses a non-loopback host that sends no CORS headers, and the shell goes on', refused.out.includes(`could not fetch from ${plainAddress}:${plainPort}`) && refused.out.includes('CORS') && /^after-refusal$/m.test(refused.out) && !/^plain-host-hello$/m.test(refused.out), refused.out.split('\n').find((line) => line.includes('could not fetch'))?.slice(0, 160) ?? 'no refusal line');
  for (const server of [corsHost, plainHost]) server.close();

  const status = await terminal([['run', 'false'], ['run', 'echo rc=$?'], ['run', '(exit 3)'], ['run', 'echo rc=$?'], ['run', 'true'], ['run', 'echo rc=$?']]);
  const statuses = status.out.match(/^rc=\d+$/gm) ?? [];
  check('in-page bash keeps $? across terminal lines', statuses.join(' ') === 'rc=1 rc=3 rc=0', statuses.join(' ') || status.out.slice(0, 140));
});
