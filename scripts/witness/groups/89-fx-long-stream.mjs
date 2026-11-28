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

group('fx-long-stream', async () => {
  const fxStub = await startFxStubGateway();
  const fxInit = `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'anthropic/claude-haiku-5.5', gatewayChatUrl: fxStub.url })};`;
  const steady = await terminal([['run', 'fx ask [stream:60:20000:1000] steady']], { initScript: fxInit, timeoutMs: 240000 });
  const idle = await terminal([['run', 'fx ask [stream:2:100:35000] idle']], { initScript: fxInit, timeoutMs: 240000 });
  await fxStub.close();
  check('a 60 s, 1.2 MB stream reaches fx whole: its last marker prints and the request does not fail', steady.out.includes('END-OF-STREAM') && !steady.out.includes('incomplete stream'), steady.out.slice(-300).replace(/\n/g, ' / '));
  check('a stream with a 35 s idle gap between events reaches fx whole', idle.out.includes('END-OF-STREAM') && !idle.out.includes('incomplete stream'), idle.out.slice(-300).replace(/\n/g, ' / '));
});
