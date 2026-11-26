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

group('fx:host loads in the page node: version, capabilities, modules and the node: aliases, and an absent tool refuses', async () => {
  const code = "const h = require('fx:host'); const path = require('node:path'); h.modules.fs.writeFileSync('/workspace/fxh.txt', 'ok'); h.modules['timers/promises'].setTimeout(5, 'late').then((late) => console.log('FXH ' + JSON.stringify({ version: h.version, capabilities: h.capabilities, joined: path.join('/a', 'b', '../c'), aliased: path === h.modules.path && require('fs') === h.modules.fs, read: require('fs').readFileSync('/workspace/fxh.txt', 'utf8'), late, refusal: (() => { try { return h.tools.Bash; } catch (error) { return error.code + ' ' + error.target; } })() })))";
  const out = await terminal([['run', 'node -e "' + code + '"'], ['run', 'node -e "require(\'nonesuch\')"; echo rc=$?']]);
  const line = out.out.split('\n').find((row) => row.startsWith('FXH '));
  const seen = line ? JSON.parse(line.slice(4)) : null;
  check('require fx:host in the page node returns the thebird host with its version and capability list', JSON.stringify(seen?.version) === '{"interface":1,"minor":0,"host":"thebird"}' && JSON.stringify(seen?.capabilities) === '["tools","fs","url","path","timers/promises"]', JSON.stringify(seen));
  check('the node: and bare names return the host modules, path joins and fs and timers work through them', seen?.joined === '/a/c' && seen?.aliased === true && seen?.read === 'ok' && seen?.late === 'late', JSON.stringify(seen));
  check('a tool the host lacks refuses with ERR_FX_UNSUPPORTED naming it, and an unknown module is still not found', seen?.refusal === 'ERR_FX_UNSUPPORTED tools.Bash' && /Cannot find module 'nonesuch'/.test(out.out), JSON.stringify(seen?.refusal) + ' ' + out.out.slice(-200));
});
