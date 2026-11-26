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

group('terminal.html loads, draws its terminal and panes, and runs a line typed into it', async () => {
  const relay = await getRelay();
  const seen = {};
  const url = relay.url + '?' + new URLSearchParams([['run', 'true']]).toString();
  await runAt(url, {
    label: 'terminal.html',
    timeoutMs: 180000,
    interact: async ({ type, press, evaluate, waitFor }) => {
      await waitFor("document.body && document.body.dataset.engine === 'ready'", 120000);
      seen.title = await evaluate('document.title');
      seen.panes = await evaluate("['terminal', 'features', 'webserver-shell', 'splash'].every((id) => document.getElementById(id) !== null)");
      seen.drawn = await evaluate("(document.querySelector('#terminal')?.childElementCount ?? 0) > 0");
      await type('echo terminal-html-typed');
      await press('Enter');
      await waitFor("globalThis.thebird.text().split('\\n').includes('terminal-html-typed')", 120000);
      seen.echoed = true;
    },
  });
  check('terminal.html is titled thebird and mounts the terminal and its panes', seen.title === 'thebird' && seen.panes === true, JSON.stringify({ title: seen.title, panes: seen.panes }));
  check('terminal.html draws the terminal into its mount', seen.drawn === true, String(seen.drawn));
  check('terminal.html runs a line typed into it and prints its output', seen.echoed === true, JSON.stringify(seen));
});
