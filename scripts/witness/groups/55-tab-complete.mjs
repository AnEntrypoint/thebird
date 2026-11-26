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

group('tab-complete', async () => {
  const completed = {};
  const listed = await terminal([
    ['run', 'mkdir -p notes/tab && echo fetched > notes/fetched.txt'],
    ['run', 'echo alpha > notes/tab/alpha.txt'],
    ['run', 'echo beta > notes/tab/beta.txt'],
  ], {
    interact: async ({ type, press, evaluate }) => {
      const value = () => evaluate("globalThis.thebird.pty.state().line");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 800));
      await type('cat notes/fetc');
      await press('Tab');
      await settle();
      completed.unique = await value();
      await press('u', { ctrl: true });
      await type('ls note');
      await press('Tab');
      await settle();
      completed.directory = await value();
      await press('u', { ctrl: true });
      await type('cat notes/tab/');
      await press('Tab');
      await settle();
      completed.listed = await value();
    },
  });
  check('in-page terminal completes a unique file name with Tab and adds a space', completed.unique === 'cat notes/fetched.txt ', JSON.stringify(completed.unique));
  check('in-page terminal completes a directory with a trailing slash', completed.directory === 'ls notes/', JSON.stringify(completed.directory));
  check('in-page terminal lists several matches when Tab cannot finish a name', /notes\/tab\/alpha\.txt {2}notes\/tab\/beta\.txt/.test(listed.out) && completed.listed === 'cat notes/tab/', JSON.stringify(completed.listed));
});
