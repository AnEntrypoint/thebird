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

group('ctrl-c-curl', async () => {
  let heldRequests = 0;
  const holdServer = createServer(() => { heldRequests++; });
  await new Promise((resolve) => holdServer.listen(0, '127.0.0.1', resolve));
  const held = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor, note, pause }) => {
      await type(`curl -s http://127.0.0.1:${holdServer.address().port}/held`);
      await press('Enter');
      await waitFor("document.body.dataset.busy === 'true'", 20000);
      for (let poll = 0; poll < 200 && (await note('held-requests', () => heldRequests)) === 0; poll++) await pause();
      const pressed = await note('pressed-at', () => performance.now());
      await press('c', { ctrl: true });
      await waitFor("!document.body.dataset.busy", 10000);
      held.elapsed = await note('cancel-elapsed', () => performance.now() - pressed);
      held.requests = await note('held-requests-at-cancel', () => heldRequests);
      await type('echo after-held-cancel');
      await press('Enter');
      await waitFor("/^after-held-cancel$/m.test(globalThis.thebird.text())", 20000);
      held.echoed = (await evaluate("globalThis.thebird.text()")).includes('^C');
      held.out = await evaluate("globalThis.thebird.text()");
    },
  });
  holdServer.closeAllConnections();
  holdServer.close();
  check('in-page terminal Ctrl-C ends a curl waiting on a response, and the shell carries on', held.requests > 0 && held.echoed && held.elapsed < 10000 && held.out.includes('cancelled') && /^after-held-cancel$/m.test(held.out), `requests reaching the held server=${held.requests} ^C echoed=${held.echoed} cancel took ${held.elapsed} ms`);
});
