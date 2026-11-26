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

group('two hosts, one plugin: fx-host-plugin.mjs prints on the page node the line fx prints', async () => {
  const plugin = readFileSync(join(root, 'test', 'fixtures', 'fx-host-plugin.mjs'), 'utf8');
  const fxLine = readFileSync(join(root, 'test', 'fixtures', 'fx-host-plugin.expected.txt'), 'utf8').trim();
  const out = await terminal([['run', 'mkdir -p /workspace/two && cd /workspace/two'], ['run', "cat > plugin.mjs <<'PLUGIN_END'\n" + plugin + "PLUGIN_END"], ['run', 'node plugin.mjs'], ['run', 'echo @@END']]);
  const lines = out.out.split('\n').map((row) => row.trim());
  const printed = lines.find((row) => row.startsWith('{"interface"'));
  const thebirdLine = fxLine.replace('"host":"fx"', '"host":"thebird"');
  check('the plugin prints on the page node fx\'s exact line, the host field naming thebird and every other byte equal', printed === thebirdLine, JSON.stringify(printed) + ' vs ' + JSON.stringify(fxLine));
});
