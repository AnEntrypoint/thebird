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

group('fx-stream-bisect', async () => {
  const fxStub = await startFxStubGateway();
  const fxInit = `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'anthropic/claude-haiku-5.5', gatewayChatUrl: fxStub.url })};`;
  const cases = [["bytes-100k","5:20000:100",100000],["bytes-300k","6:50000:100",300000],["bytes-600k","12:50000:100",600000],["bytes-1200k","12:100000:100",1200000],["time-20s","20:100:1000",2000],["time-40s","40:100:1000",4000],["time-60s","60:100:1000",6000]];
  for (const [name, directive, expectedBytes] of cases) {
    const run = await terminal([['run', 'fx ask [stream:' + directive + '] ' + name]], { initScript: fxInit, timeoutMs: 300000 });
    const indexes = [...run.out.matchAll(/^(\d+):x+/gm)].map((m) => Number(m[1]));
    const lastChunk = indexes.length ? Math.max(...indexes) : 0;
    const sent = fxStub.streams.filter((s) => s.prompt.includes('[stream:' + directive + ']')).at(-1) ?? null;
    const whole = run.out.includes('END-OF-STREAM') && !run.out.includes('incomplete stream');
    check('fx stream case ' + name + ' (' + expectedBytes + ' bytes in the stream) reaches fx whole', whole, JSON.stringify({ lastChunkSeenByFx: lastChunk, markerPrinted: run.out.includes('END-OF-STREAM'), incompleteStream: run.out.includes('incomplete stream'), stub: sent === null ? null : { events: sent.events, written: sent.written, closedEarly: sent.closedEarly, ms: sent.ms } }));
  }
  await fxStub.close();
});
