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

group('fx-tool-bridge', async () => {
  const fxStub = await startFxStubGateway();
  const bridge = {};
  try {
    await terminal([], {
      initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'anthropic/claude-haiku-5.5', gatewayChatUrl: fxStub.url })};`,
      interact: async ({ type, press, evaluate, waitFor }) => {
        await type('fx');
        await press('Enter');
        bridge.ready = await waitFor(`globalThis.thebird.text().includes('┃')`, 120000).then(() => true, () => false);
        await type('[tool:thebird_ports]');
        await press('Enter');
        bridge.answered = await waitFor(`(${TUI_SCREEN}).includes('stub gateway answer')`, 90000).then(() => true, () => false);
        bridge.screen = await evaluate(TUI_SCREEN);
      },
    });
  } finally {
    await fxStub.close();
  }
  check('fx started in thebird has the tool bridge: a thebird tool call is answered and never reports Tools are unavailable or Unsupported tool', bridge.ready === true && bridge.answered === true && !bridge.screen.includes('Tools are unavailable') && !bridge.screen.includes('Unsupported tool'),JSON.stringify({ ready: bridge.ready, answered: bridge.answered, tail: bridge.screen.split('\n').filter((line) => line.trim()).slice(-6) }));
});
