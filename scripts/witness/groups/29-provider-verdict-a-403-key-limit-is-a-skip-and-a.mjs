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

group('provider verdict: a 403 key_limit is a skip, and any other failure is a failure', async () => {
  const cases = [
    ['403 key_limit', 403, { error: { code: 403, metadata: { scope: 'key_limit', limit_usd: 0 } } }, 'skip'],
    ['403 key_limit with no limit_usd', 403, { error: { code: 403, metadata: { scope: 'key_limit' } } }, 'skip'],
    ['403 with another code', 403, { error: { code: 403, metadata: { scope: 'model_access' } } }, 'fail'],
    ['429 from every model', 429, { error: { code: 429 } }, 'skip'],
    ['500', 500, { error: { code: 500, message: 'upstream' } }, 'fail'],
    ['200 with a wrong body', 200, { unexpected: true }, 'fail'],
    ['200 with a chat body', 200, { choices: [{ message: { role: 'assistant', content: 'ok' } }] }, 'ok'],
  ];
  for (const [label, status, body, expected] of cases) {
    const stub = await startProviderStub(status, body);
    try {
      const verdict = await providerVerdict({ url: stub.url, key: 'stub-key', models: ['stub-model-a', 'stub-model-b'] });
      check(label + ' gives the ' + expected + ' verdict with a defined reason', verdict.verdict === expected && !String(verdict.detail).includes('undefined'), JSON.stringify({ pid: stub.pid, ...verdict }));
    } finally {
      await stub.stop();
    }
  }
});
