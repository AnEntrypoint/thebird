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

group('pip-fallback', async () => {
  const run = await terminal([['run', 'pip --version']], { blockUrls: ['https://cdn.jsdelivr.net/pyodide/v314.0.7/full/micropip-*'] });
  const requestIds = (needle) => run.logs.filter((line) => / net-request / .test(line) && line.includes(needle)).map((line) => line.split(' ')[2]);
  const failedIds = new Set(run.logs.filter((line) => / net-failed /.test(line)).map((line) => line.split(' ')[2]));
  const blockedWheel = requestIds('cdn.jsdelivr.net/pyodide/v314.0.7/full/micropip-0.11.1').filter((id) => failedIds.has(id)).length;
  const fallbackWheel = requestIds('fastly.jsdelivr.net/pyodide/v314.0.7/full/micropip-0.11.1').length;
  check('pip falls back past a blocked jsDelivr micropip wheel: one retry on it, then fastly.jsdelivr.net', /^pip \d+\.\d+\.\d+ \(micropip, in-page\)$/m.test(run.out) && blockedWheel >= 2 && fallbackWheel >= 1, `blocked ${blockedWheel}, fastly ${fallbackWheel}, out ${run.out.split('\n').slice(-2).join(' / ').slice(0, 120)}`);
});
