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

group('playwriter-hello', async () => {
  const hello = await terminal([['run', 'echo hello-ok'], ['run', 'sleep 40; echo slept-40'], ['run', 'playwriter --version'], ['run', 'which playwriter; command -v playwriter; type playwriter'], ['run', "playwriter frobnicate; echo after-frobnicate"]]);
  check('browser terminal runs a bash line in headless Chromium', hello.engine === 'ready' && hello.out.includes('hello-ok'));
  check('in-page bash runs a 40-second sleep without a timeout', /^slept-40$/m.test(hello.out), hello.out.split('\n').slice(-3).join(' / ').slice(0, 140));
  const helloLines = hello.out.split('\n');
  check('playwriter answers --version, and which, command -v and type agree that it is a shell builtin', helloLines.includes('birdman playwriter 0.1.0') && helloLines.filter((line) => line === 'playwriter').length >= 2 && helloLines.includes('playwriter is a shell builtin'), helloLines.filter((line) => /playwriter/.test(line)).join(' / ').slice(0, 140));
  check('playwriter names an unknown command and the shell goes on', hello.out.includes("playwriter: unknown command 'frobnicate'") && helloLines.includes('after-frobnicate'), helloLines.slice(-3).join(' / ').slice(0, 140));
});
