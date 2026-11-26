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

group('touch -m and -a change only the time they name, as tjs.stat reports them in the page', async () => {
  const touched = await terminal([
    ['run', "printf x > /workspace/touchrow-f && sleep 2 && touch -m /workspace/touchrow-f && echo touched"],
    ['run', "tjs -e \"tjs.stat('/workspace/touchrow-f').then((s) => console.log('touchrow-age', Date.now() - s.mtim.getTime() < 1000))\""],
    ['run', "printf x > /workspace/touchrow-a && sleep 2 && touch -a /workspace/touchrow-a && echo touched-a"],
    ['run', "tjs -e \"tjs.stat('/workspace/touchrow-a').then((s) => console.log('touchrow-a-kept', Date.now() - s.mtim.getTime() >= 1000))\""]
  ]);
  const touchLines = touched.out.split('\n');
  check('touch -m moves the mtime that tjs.stat reports to now, after the file was written two seconds earlier', touchLines.includes('touchrow-age true'), JSON.stringify(touchLines.slice(-12)));
  check('touch -a leaves the mtime that tjs.stat reports where the write left it', touchLines.includes('touchrow-a-kept true'), JSON.stringify(touchLines.slice(-12)));
});
