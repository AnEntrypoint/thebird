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

group('loops', async () => {
  const loops = {};
  await terminal([], {
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const txiki = await import(new URL('web/txiki-in-page.js', location.href).href);
        const qjs = await import(new URL('web/qjs-in-txiki.js', location.href).href);
        const timed = async (run) => {
          const started = performance.now();
          try {
            return { ...(await run()), error: null, elapsed: performance.now() - started };
          } catch (err) {
            return { error: String(err.message ?? err), elapsed: performance.now() - started };
          }
        };
        const aborted = () => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 500);
          return txiki.runTjs('setTimeout(() => {}, 60000);', '/workspace', { signal: controller.signal });
        };
        globalThis.__loopRuns = {
          spinning: await timed(() => txiki.runTjs('while (true) {}', '/workspace', { timeoutMs: 1000 })),
          waiting: await timed(() => txiki.runTjs('setTimeout(() => {}, 60000);', '/workspace', { timeoutMs: 1000 })),
          aborted: await timed(aborted),
          tjs: await timed(() => txiki.tjsBuiltin(['-e', 'while (true) {}'], '/workspace', { timeoutMs: 1000 })),
          qjs: await timed(() => qjs.qjsBuiltin(['-e', 'while (true) {}'], { timeoutMs: 1000 })),
        };
      })().catch((err) => { globalThis.__loopRuns = { failed: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__loopRuns !== undefined', 120000);
      loops.runs = JSON.parse(await evaluate('JSON.stringify(globalThis.__loopRuns)'));
    },
  });
  check('a synchronous loop in tjs -e is cut at the timeout with status 124 and no uncaught line', loops.runs?.spinning?.status === 124 && !/Uncaught/.test(loops.runs.spinning.output ?? '') && loops.runs.spinning.elapsed < 5000, JSON.stringify(loops.runs?.spinning));
  check('a pending timer does not hold the engine past the timeout: status 124 well before the 60 s timer', loops.runs?.waiting?.status === 124 && loops.runs.waiting.elapsed < 5000, JSON.stringify(loops.runs?.waiting));
  check('an abort cancels a waiting engine run at the next tick and reports status 130', loops.runs?.aborted?.status === 130 && loops.runs.aborted.elapsed < 5000, JSON.stringify(loops.runs?.aborted));
  check('tjs and qjs report the timeout as a timeout error', loops.runs?.tjs?.error === 'timeout: command timed out' && loops.runs?.qjs?.error === 'timeout: command timed out', JSON.stringify({ tjs: loops.runs?.tjs?.error, qjs: loops.runs?.qjs?.error }));
  const stepped = {};
  await terminal([], {
    initScript: "(() => { const real = Date.now.bind(Date); let offset = 0; Date.now = () => real() + offset; setTimeout(() => { offset = 3600000; }, 1500); })();",
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const txiki = await import(new URL('web/txiki-in-page.js', location.href).href);
        globalThis.__steppedRun = await txiki.runTjs("await new Promise((done) => setTimeout(done, 3000)); console.log('after-step');", '/workspace', { timeoutMs: 900000 });
      })().catch((err) => { globalThis.__steppedRun = { error: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__steppedRun !== undefined', 120000);
      stepped.run = JSON.parse(await evaluate('JSON.stringify(globalThis.__steppedRun)'));
    },
  });
  check('a wall-clock step during a tjs -e run does not cut it at the timeout: the run finishes with status 0', stepped.run?.status === 0 && /after-step/.test(stepped.run?.output ?? ''), JSON.stringify(stepped.run));
  const timers = {};
  await terminal([], {
    initScript: "(() => { const real = Date.now.bind(Date); let offset = 0; Date.now = () => real() + offset; setTimeout(() => { offset = 3600000; }, 1500); })();",
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        const txiki = await import(new URL('web/txiki-in-page.js', location.href).href);
        const started = performance.now();
        const run = await txiki.runTjs("await new Promise((done) => setTimeout(done, 4000)); console.log('timer-done');", '/workspace', { timeoutMs: 900000 });
        globalThis.__timerRun = { ...run, elapsed: performance.now() - started };
      })().catch((err) => { globalThis.__timerRun = { error: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__timerRun !== undefined', 120000);
      timers.run = JSON.parse(await evaluate('JSON.stringify(globalThis.__timerRun)'));
    },
  });
  check('a pending timer keeps its 4 s due time across a forward wall-clock step: it does not fire before 3.5 s of monotonic time', timers.run?.status === 0 && /timer-done/.test(timers.run?.output ?? '') && timers.run?.elapsed >= 3500, JSON.stringify(timers.run));
});
