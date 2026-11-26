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

group('wide-chars', async () => {
  const wideText = String.fromCodePoint(0x6c49, 0x5b57, 0x1f600) + 'x';
  const wide = {};
  await terminal([['run', "printf '" + wideText + "\\n'"]], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      await waitFor(`globalThis.thebird.text().split(String.fromCharCode(10)).includes(${JSON.stringify(wideText)})`, 40000);
      wide.cells = await evaluate(`(() => { const buffer = globalThis.thebird.term.buffer.active; const target = ${JSON.stringify(wideText)}; for (let row = 0; row < buffer.length; row++) { const line = buffer.getLine(row); if (line.translateToString(true) === target) { return [0, 2, 4, 6].map((col) => line.getCell(col).getWidth()); } } return null; })()`);
      await type(String.fromCodePoint(0x6c49, 0x5b57));
      await new Promise((resolve) => setTimeout(resolve, 300));
      wide.cursorAfterCjk = await evaluate('globalThis.thebird.term.buffer.active.cursorX');
      await type(String.fromCodePoint(0x1f600));
      await new Promise((resolve) => setTimeout(resolve, 300));
      wide.cursorAfterEmoji = await evaluate('globalThis.thebird.term.buffer.active.cursorX');
      wide.promptLength = await evaluate("[...globalThis.thebird.pty.state().prompt].length");
      await press('u', { ctrl: true });
    },
  });
  check('wide characters take two cells in the shell output, and the input cursor moves by the cell width of typed CJK and emoji', JSON.stringify(wide.cells) === '[2,2,2,1]' && wide.cursorAfterCjk === wide.promptLength + 4 && wide.cursorAfterEmoji === wide.promptLength + 6, JSON.stringify(wide));
});
