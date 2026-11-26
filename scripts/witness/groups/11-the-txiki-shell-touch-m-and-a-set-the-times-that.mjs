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

group('the txiki shell touch -m and -a set the times that tjs.stat reports, from inside the engine', async () => {
  let touchTimes = null;
  await terminal([], {
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const shell = await import(new URL('web/shell-in-txiki.js', location.href).href);
        const engine = await import(new URL('web/txiki-in-page.js', location.href).href);
        const stamp = async (path) => {
          const out = await engine.runTjs("tjs.stat('" + path + "').then((s) => console.log('times', s.atim.getTime(), s.mtim.getTime()))", '/workspace');
          const [, atime, mtime] = out.output.trim().split(' ');
          return { atime: Number(atime), mtime: Number(mtime) };
        };
        const old = 1600000000000;
        const result = { nowMs: Date.now() };
        for (const flag of ['m', 'a']) {
          const path = '/workspace/txtouch-' + flag;
          await shell.runShellInTxiki('printf x > ' + path, { cwd: '/workspace' });
          await engine.runTjs("tjs.utime('" + path + "', " + old + ', ' + old + ')', '/workspace');
          const ran = await shell.runShellInTxiki('touch -' + flag + ' ' + path + '; echo rc=$?', { cwd: '/workspace' });
          result[flag] = { rc: ran.stdout.trim(), ...(await stamp(path)) };
        }
        globalThis.__txTouch = JSON.stringify(result);
      })()`);
      await waitFor('globalThis.__txTouch !== undefined', 120000);
      touchTimes = JSON.parse(await evaluate('globalThis.__txTouch'));
    },
  });
  check('touch -m in the txiki shell moves the mtime to now and keeps the atime', touchTimes.m.rc === 'rc=0' && touchTimes.m.mtime >= touchTimes.nowMs - 60000 && touchTimes.m.atime === 1600000000000, JSON.stringify(touchTimes.m));
  check('touch -a in the txiki shell moves the atime to now and keeps the mtime', touchTimes.a.rc === 'rc=0' && touchTimes.a.atime >= touchTimes.nowMs - 60000 && touchTimes.a.mtime === 1600000000000, JSON.stringify(touchTimes.a));
});
