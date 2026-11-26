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

group('pyodide-lock', async () => {
  const PYODIDE_LOCK_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json';
  const PYODIDE_LOCK_SHA256 = '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010';
  const pyodideLockBytes = Buffer.from(await fetchWithFallback([PYODIDE_LOCK_URL, PYODIDE_LOCK_URL.replace('cdn.jsdelivr.net', 'fastly.jsdelivr.net')]).then((response) => response.arrayBuffer()).catch(() => new ArrayBuffer(0)));
  const pyodideLockDigest = createHash('sha256').update(pyodideLockBytes).digest('hex');
  const pyodideLock = pyodideLockDigest === PYODIDE_LOCK_SHA256 ? JSON.parse(pyodideLockBytes.toString('utf8')) : null;
  check('the micropip wheel the page loads is the one pinned in the Pyodide lock', pyodideLock !== null && readFileSync(join(root, 'web', 'python-worker.js'), 'utf8').includes(`'${pyodideLock.packages.micropip.file_name}'`), pyodideLock ? pyodideLock.packages.micropip.file_name : `lock sha256 ${pyodideLockDigest} from ${PYODIDE_LOCK_URL} is not the pinned ${PYODIDE_LOCK_SHA256}`);
});
