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

group('paste', async () => {
  const pasted = {};
  await terminal([], {
    interact: async ({ evaluate, press }) => {
      await evaluate(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify('one\ntwo\nthree')}); document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      pasted.state = await evaluate('globalThis.thebird.pty.state()');
      pasted.output = await evaluate("globalThis.thebird.text().split('\\n').filter((line) => line.trim() !== '' && !line.startsWith('thebird '))");
      await press('u', { ctrl: true });
    },
  });
  check('a multi-line paste goes into the input line with each newline as a space, queues nothing and runs nothing', pasted.state?.line === 'one two three' && pasted.state.queued === 0 && pasted.output?.length === 0, JSON.stringify({ line: pasted.state?.line, queued: pasted.state?.queued, output: pasted.output }));
  const kept = {};
  await terminal([], {
    interact: async ({ evaluate, press, waitFor }) => {
      await evaluate(`(() => { const data = new DataTransfer(); data.setData('text/plain', 'echo paste-kept'); document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`);
      kept.before = await evaluate('globalThis.thebird.pty.state().line');
      await press('Enter');
      await waitFor("globalThis.thebird.text().split('\\n').some((line) => line === 'paste-kept')", 30000).catch(() => {});
      kept.after = await evaluate('globalThis.thebird.pty.state().line');
      kept.ran = await evaluate("globalThis.thebird.text().split('\\n').some((line) => line === 'paste-kept')");
    },
  });
  check('Enter after a paste runs the pasted line and empties the input; a paste cleared by Enter without running fails', kept.before === 'echo paste-kept' && kept.after === '' && kept.ran === true, JSON.stringify(kept));
});
