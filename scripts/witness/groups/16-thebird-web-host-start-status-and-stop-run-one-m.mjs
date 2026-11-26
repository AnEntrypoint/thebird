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

group('thebird-web-host start, status and stop run one managed server, and stop ends its pid', async () => {
  const pagesDir = await sharedPages();
  const port = await freePort();
  const flags = ['--host', '127.0.0.1', '--port', String(port), '--root', pagesDir];
  const cli = webhostCli;
  let pid = null;
  try {
    const started = cli('start', ...flags);
    pid = trackPid(Number(started.stdout.match(/pid: (\d+)/)?.[1] ?? 0) || null);
    const answer = await fetch(`http://127.0.0.1:${port}/`).then((res) => res.status, () => 'no answer');
    const status = cli('status', ...flags);
    const again = cli('start', ...flags);
    const stopped = cli('stop', ...flags);
    const after = cli('status', ...flags);
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    check('start prints the managed URL and pid, and the host answers 200', started.status === 0 && started.stdout.includes('listening on') && pid !== null && answer === 200, JSON.stringify({ rc: started.status, answer, out: started.stdout.slice(0, 200) }));
    check('status reports the running pid', status.status === 0 && status.stdout.includes(`pid ${pid}`), status.stdout.trim());
    check('a second start reports the running server and keeps its pid', again.status === 0 && again.stdout.includes('already running') && again.stdout.includes(`pid: ${pid}`), again.stdout.trim());
    check('stop reports the pid it stopped', stopped.status === 0 && stopped.stdout.trim() === `stopped web host pid ${pid}`, stopped.stdout.trim());
    check('status after stop reports stopped with exit 1', after.status === 1 && after.stdout.trim() === 'stopped', after.stdout.trim());
    check('stop ends the process with that pid', pid !== null && !alive(pid), `pid ${pid}`);
  } finally {
    await stopPid(pid);
  }
});
