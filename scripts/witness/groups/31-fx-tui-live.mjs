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

group('fx-tui-live', async () => {
  const live = await liveRun(['the TUI on the live provider answers hi with a reply line below the typed hi']);
  if (!live) return;
  const { url: liveUrl, key: liveKey, model: liveModel } = live;
  const surfaces = {};
  const tui = await terminal([], {
    initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: liveKey, model: liveModel, gatewayChatUrl: liveUrl })};`,
    interact: async ({ type, press, evaluate, waitFor, settle }) => {
      await type('fx');
      await press('Enter');
      surfaces.inputReady = await settle(`globalThis.thebird.text().includes('┃')`, 120000);
      await type('hi');
      await press('Enter');
      surfaces.reply = await settle(`/┃ hi[\\s\\S]*\\n {2}(?!Thinking|\\d+s )\\S/.test(globalThis.thebird.text())`, 120000);
      surfaces.screen = await evaluate(TUI_SCREEN);
    },
  });
  const gatewayStatuses = tui.logs.filter((line) => line.startsWith('worker net-response ') && line.split(' ')[5] === liveUrl).map((line) => line.split(' ')[4]);
  const gatewayErrors = tui.logs.filter((line) => line.includes(liveUrl) && /HTTP [45]\d\d|status of [45]\d\d/.test(line));
  liveCheck('the TUI on the live provider answers hi with a reply line below the typed hi', surfaces.inputReady === true && surfaces.reply === true && gatewayErrors.length === 0, `input ${surfaces.inputReady}, reply ${surfaces.reply}, gateway ${JSON.stringify(gatewayStatuses)}, gateway errors ${JSON.stringify(gatewayErrors.slice(0, 2))}, screen ${String(surfaces.screen ?? '').split('\\n').filter((line) => line.trim()).slice(-6).join(' / ').slice(0, 400)}`);
});
