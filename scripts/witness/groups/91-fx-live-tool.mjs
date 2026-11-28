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

group('fx-live-tool', async () => {
  const names = ['fx ask on the live provider runs a tool: the file its command wrote exists', 'the live turn does not end with incomplete stream'];
  const live = await liveRun(names);
  if (!live) return;
  const marker = 'live-tool-' + Date.now();
  const run = await terminal([
    ['run', "fx ask Use the thebird_run tool to run this shell command, then reply done: echo " + marker + " > /workspace/live-tool.txt"],
    ['run', 'cat /workspace/live-tool.txt'],
  ], {
    initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: live.key, model: live.model, gatewayChatUrl: live.url })};`,
    timeoutMs: 600000,
  });
  const ids = run.logs.filter((line) => line.includes(' net-request ') && line.includes(live.url)).map((line) => line.split(' ')[3]);
  const responses = run.logs.filter((line) => ids.some((id) => line.includes(' net-response ' + id + ' ') || line.includes(' net-finished ' + id + ' ') || line.includes(' net-failed ' + id + ' '))).map((line) => line.split(' ').slice(2, 7).join(' '));
  const detail = JSON.stringify({ tail: run.out.slice(-400), responses });
  const wrote = run.out.split('\n').filter((line) => line === marker).length;
  liveCheck(names[0], wrote === 1, detail);
  liveCheck(names[1], !run.out.includes('incomplete stream'), detail);
});
