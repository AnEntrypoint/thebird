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

group('fx-tui-registry', async () => {
  const reply = 'hello from the registry provider';
  const stub = await startChatStub(reply);
  const surfaces = {};
  try {
    await terminal([], {
      initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'relay-model', gatewayChatUrl: stub.url })};`,
      interact: async ({ type, press, evaluate, waitFor, settle }) => {
        await type('fx');
        await press('Enter');
        surfaces.inputReady = await settle(`globalThis.thebird.text().includes('┃')`, 120000);
        await type('hi');
        await press('Enter');
        surfaces.reply = await settle(`globalThis.thebird.text().split('\\n').some((line) => line.includes(${JSON.stringify(reply)}))`, 90000);
        surfaces.screen = await evaluate(TUI_SCREEN);
      },
    });
    const sent = stub.requests[0];
    const userTurn = sent?.body?.messages?.find((message) => message.role === 'user');
    check('the TUI types hi and the registry provider replies on the screen', surfaces.inputReady === true && surfaces.reply === true, `input ${surfaces.inputReady}, reply ${surfaces.reply}`);
    check('the TUI sends one chat-completions request for hi, with the model and the page key', stub.requests.length === 1 && sent.body.model === 'relay-model' && userTurn?.content === 'hi' && sent.authorization === `Bearer ${FX_STUB_KEY}`, JSON.stringify({ count: stub.requests.length, model: sent?.body?.model, user: userTurn?.content, auth: sent?.authorization ? 'present' : null }));
  } finally {
    await stub.close();
  }
});
