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

group('thebird-webserver register scaffolds a server that list names, and unregister --remove-folder takes it out again', async () => {
  const id = 'cov-web-' + process.pid;
  const run = webserverCli;
  const idsIn = (result) => JSON.parse(result.stdout).map((server) => server.id);
  let registered, listed, scaffold, removed, listedAfter, scaffoldAfter, statusIds;
  try {
    registered = run('register', id, '--title', 'Coverage webserver');
    listed = idsIn(run('list'));
    scaffold = JSON.parse(run('scaffold-check', id).stdout);
    statusIds = idsIn(run('status'));
  } finally {
    removed = run('unregister', id, '--remove-folder');
  }
  listedAfter = idsIn(run('list'));
  scaffoldAfter = JSON.parse(run('scaffold-check', id).stdout);
  check('thebird-webserver register exits 0, and list names the id it registered', registered.status === 0 && listed.includes(id), JSON.stringify({ status: registered.status, listed, stderr: registered.stderr.slice(0, 200) }));
  check('thebird-webserver scaffold-check finds the files that register wrote', scaffold.ok === true, JSON.stringify(scaffold));
  check('thebird-webserver status names the server that register wrote', statusIds.includes(id), JSON.stringify(statusIds));
  check('thebird-webserver unregister --remove-folder drops the id from list and removes its scaffold', removed.status === 0 && !listedAfter.includes(id) && scaffoldAfter.ok === false, JSON.stringify({ listedAfter, scaffoldAfter }));
});
