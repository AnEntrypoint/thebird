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

group('cd-path', async () => {
  const moved = {};
  await terminal([['run', 'mkdir -p notes && echo fetched > notes/fetched.txt']], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const value = () => evaluate("globalThis.thebird.pty.state().line");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
      await type('cd notes');
      await press('Enter');
      await waitFor("globalThis.thebird.pty.state().prompt === 'thebird /workspace/notes> '", 20000);
      moved.prompt = await evaluate("globalThis.thebird.pty.state().prompt");
      await type('pwd');
      await press('Enter');
      await settle();
      moved.out = await evaluate("globalThis.thebird.text()");
      await type('cat fetc');
      await press('Tab');
      await settle();
      moved.completed = await value();
    },
  });
  check('in-page prompt shows the working directory after cd', moved.prompt === 'thebird /workspace/notes> ', JSON.stringify(moved.prompt));
  check('in-page cd persists to the next command and Tab completes relative to it', /^\/workspace\/notes$/m.test(moved.out) && moved.completed === 'cat fetched.txt ', JSON.stringify(moved.completed));
});
