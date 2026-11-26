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

group('splash-probe', async () => {
  const splashProbe = {};
  await terminal([], {
    interact: async ({ evaluate, waitFor }) => {
      await evaluate(`(async () => {
        globalThis.__progress = ['start'];
        const { createSplash } = await import(new URL('web/splash.js', location.href).href);
        globalThis.__progress.push('imported');
        const el = document.getElementById('splash');
        const live = new Set();
        const setIntervalOriginal = globalThis.setInterval;
        const clearIntervalOriginal = globalThis.clearInterval;
        globalThis.setInterval = (fn, ms) => { const id = setIntervalOriginal(fn, ms); if (fn.name === 'draw') live.add(id); return id; };
        globalThis.clearInterval = (id) => { live.delete(id); return clearIntervalOriginal(id); };
        const splash = createSplash(el);
        splash.loading('loading the shell');
        globalThis.__progress.push('loading');
        await new Promise((resolve) => setTimeout(resolve, 400));
        globalThis.__progress.push('slept');
        const pre = el.querySelector('pre');
        const first = pre.textContent;
        const timersWhileLoading = live.size;
        await new Promise((resolve) => setTimeout(resolve, 450));
        const second = pre.textContent;
        const box = el.getBoundingClientRect();
        const logo = pre.getBoundingClientRect();
        const phase = el.querySelector('.phase').getBoundingClientRect();
        const rows = first.split('\\n');
        const probe = {
          mode: el.dataset.mode,
          rows: rows.length,
          width: Math.max(...rows.map((row) => [...row].length)),
          frames: [first, second],
          distinct: first !== second,
          canvases: el.querySelectorAll('canvas').length,
          phase: el.querySelector('.phase').textContent,
          phaseBelowLogo: phase.top >= logo.bottom - 1,
          centreOffset: { x: logo.left + logo.width / 2 - (box.left + box.width / 2), y: logo.top + logo.height / 2 - (box.top + box.height / 2) },
          logoBox: { left: logo.left, top: logo.top, right: logo.right, bottom: logo.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          timersWhileLoading,
        };
        splash.done();
        probe.afterDone = { children: el.childElementCount, hidden: el.hidden, mode: el.dataset.mode ?? null, timers: live.size };
        await new Promise((resolve) => setTimeout(resolve, 300));
        probe.afterDone.timersLater = live.size;
        globalThis.setInterval = setIntervalOriginal;
        globalThis.clearInterval = clearIntervalOriginal;
        globalThis.__splashProbe = probe;
      })().catch((err) => { globalThis.__splashProbe = { error: String(err.message ?? err), stack: String(err.stack ?? '') }; })`);
      const splashFinished = await waitFor('globalThis.__splashProbe !== undefined', 60000).then(() => true, () => false);
      splashProbe.probe = splashFinished ? JSON.parse(await evaluate('JSON.stringify(globalThis.__splashProbe)')) : { error: 'the splash probe did not finish within 60 s', progress: await evaluate('JSON.stringify(globalThis.__progress ?? null)'), href: await evaluate('location.href'), ready: await evaluate('document.readyState') };
      splashProbe.boot = await evaluate("globalThis.thebird.text().includes('loading the shell')");
      splashProbe.hidden = await evaluate("document.getElementById('splash').hidden");
    },
  });
  const splashFrames = splashProbe.probe?.frames ?? [];
  const splashCentred = Boolean(splashProbe.probe?.centreOffset) && Math.abs(splashProbe.probe.centreOffset.x) <= 1 && Math.abs(splashProbe.probe.centreOffset.y) <= 1;
  check('the boot splash is an ASCII thebird in a centred pre with the phase text beneath it, and no canvas', splashProbe.probe?.mode === 'ascii' && splashProbe.probe.rows === 6 && splashProbe.probe.canvases === 0 && splashProbe.probe.phase === 'loading the shell' && splashProbe.probe.phaseBelowLogo && splashProbe.boot === false, JSON.stringify({ error: splashProbe.probe?.error, progress: splashProbe.probe?.progress, href: splashProbe.probe?.href, ready: splashProbe.probe?.ready, stack: splashProbe.probe?.stack?.slice(0, 300), mode: splashProbe.probe?.mode, rows: splashProbe.probe?.rows, canvases: splashProbe.probe?.canvases, phase: splashProbe.probe?.phase, phaseBelowLogo: splashProbe.probe?.phaseBelowLogo, boot: splashProbe.boot }));
  check('the boot splash frames animate: two samples 450 ms apart differ, and each is six rows of the same width', splashProbe.probe?.distinct === true && splashFrames.length === 2 && splashFrames.every((frame) => frame.split('\n').length === 6 && frame.split('\n').every((row) => [...row].length === splashProbe.probe.width)), JSON.stringify({ first: splashFrames[0], second: splashFrames[1] }));
  check('the splash logo is centred in the viewport and sits inside it', splashCentred && splashProbe.probe.logoBox.left >= 0 && splashProbe.probe.logoBox.top >= 0 && splashProbe.probe.logoBox.right <= splashProbe.probe.viewport.width && splashProbe.probe.logoBox.bottom <= splashProbe.probe.viewport.height, JSON.stringify({ box: splashProbe.probe?.logoBox, viewport: splashProbe.probe?.viewport, offset: splashProbe.probe?.centreOffset }));
  check('done() removes the logo, hides the splash and clears its frame timer', splashProbe.probe?.timersWhileLoading === 1 && splashProbe.probe.afterDone.children === 0 && splashProbe.probe.afterDone.hidden === true && splashProbe.probe.afterDone.mode === null && splashProbe.probe.afterDone.timersLater === 0 && splashProbe.hidden === true, JSON.stringify(splashProbe.probe?.afterDone));
});
