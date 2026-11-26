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

group('retired-artifacts', async () => {
const sqliteRetired = !existsSync(join(root, 'web', 'sqlite-in-page.js')) && existsSync(join(root, 'web', 'sqlite-program.js')) && readFileSync(join(root, 'web', 'builtins.js'), 'utf8').includes("from './sqlite-in-txiki.js'");
check('sqlite3 runs a static txiki program, and web/sqlite-in-page.js is retired', sqliteRetired, existsSync(join(root, 'web', 'sqlite-in-page.js')) ? 'web/sqlite-in-page.js is still present' : sqliteRetired ? 'builtins.js imports web/sqlite-in-txiki.js, which runs web/sqlite-program.js' : 'web/sqlite-program.js is missing or builtins.js still imports the old file');
const qjsRetired = !existsSync(join(root, 'web', 'quickjs-in-page.js')) && !existsSync(join(root, 'web', 'vendor', 'quickjs')) && existsSync(join(root, 'web', 'qjs-program.js')) && readFileSync(join(root, 'web', 'builtins.js'), 'utf8').includes("from './qjs-in-txiki.js'");
check('qjs runs as a static txiki program, and the quickjs-ng wasm and its build are retired', qjsRetired, existsSync(join(root, 'web', 'quickjs-in-page.js')) ? 'web/quickjs-in-page.js is still present' : existsSync(join(root, 'web', 'vendor', 'quickjs')) ? 'web/vendor/quickjs is still present' : qjsRetired ? 'builtins.js imports web/qjs-in-txiki.js, which runs web/qjs-program.js' : 'web/qjs-program.js is missing or builtins.js still imports the old file');
});
