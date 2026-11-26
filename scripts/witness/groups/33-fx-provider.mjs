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

group('fx-provider', async () => {
  const live = await liveRun(['fx ask on the live provider prints ok with rc 0', 'the live chat request returns 200 and the page logs no HTTP error']);
  if (!live) return;
  const { url: liveUrl, key: liveKey, model: liveModel } = live;
  const ask = await terminal([['run', 'fx ask reply with only the word ok'], ['run', 'echo rc=$?']], {
    initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: liveKey, model: liveModel, gatewayChatUrl: liveUrl })};`,
  });
  const statuses = ask.logs.filter((line) => line.startsWith('worker net-response ') && line.split(' ')[5] === liveUrl).map((line) => line.split(' ')[4]);
  const errors = ask.logs.filter((line) => /HTTP [45]\d\d|status of [45]\d\d|400 \(|500 \(/.test(line));
  liveCheck('fx ask on the live provider prints ok with rc 0', /^ok$/m.test(ask.out) && /^rc=0$/m.test(ask.out), JSON.stringify({ screen: ask.out.slice(-200), statuses }));
  liveCheck('the live chat request returns 200 and the page logs no HTTP error', statuses.length > 0 && statuses.every((status) => status === '200') && errors.length === 0, JSON.stringify({ statuses, errors: errors.slice(0, 3) }));
});
