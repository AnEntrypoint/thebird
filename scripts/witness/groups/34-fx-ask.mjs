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

group('fx-ask', async () => {
  const stubTui = await startFxStubGateway();
  const stubInit = `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'anthropic/claude-haiku-5.5', gatewayChatUrl: stubTui.url, permissionMode: 'ask' })};`;
  const surfaces = {};
  await terminal([], {
    initScript: stubInit,
    interact: async ({ type, press, evaluate, waitFor, settle }) => {
      const hasText = (text) => `globalThis.thebird.text().split('\\n').some((line) => line.includes(${JSON.stringify(text)}))`;
      const grab = async (name) => { surfaces[name] = await evaluate(TUI_SCREEN); };
      const submit = async (text) => { await type(text); await press('Enter'); };
      await type('fx');
      await press('Enter');
      surfaces.welcomeShown = await settle(`globalThis.thebird.text().includes('Welcome to fx')`, 120000);
      await submit('[tool:ask] [input:{"question":"pick"}]');
      surfaces.approvalPrompted = await settle(hasText('Allow once'), 90000);
      await press('Enter');
      surfaces.askShown = await settle(hasText('pick'), 90000);
      await grab('ask');
      await submit('blue');
      surfaces.askAnswered = await settle(hasText('tool-result=seen'), 90000);
      await grab('askReply');
      surfaces.focusAfterAsk = await evaluate("document.activeElement?.classList?.contains('xterm-helper-textarea') === true");
      await submit('[lines:60] long');
      surfaces.linesShown = await settle(hasText('line 60'), 90000);
      await press('o', { ctrl: true });
      surfaces.fullShown = await settle(hasText('esc close'), 60000);
      await grab('full');
      await press('Escape');
      surfaces.fullClosed = await settle(`!${hasText('esc close')}`, 30000);
      await grab('closedScreen');
    },
  });
  await stubTui.close();
  const surfaceHas = (name, text) => (surfaces[name] ?? '').split('\n').some((line) => line.includes(text));
  check('ask: fx shows its approval panel before the page ask tool runs in ask mode', surfaces.approvalPrompted === true, String(surfaces.approvalPrompted));
  check('ask: the question is shown, and the answer reaches the stub as a tool result', surfaces.askShown === true && surfaceHas('ask', 'pick') && surfaces.askAnswered === true && surfaceHas('askReply', 'tool-result=seen'), JSON.stringify((surfaces.askReply ?? '').split('\n').slice(-6)));
  check('ask: the terminal input regains focus after the answer', surfaces.focusAfterAsk === true, String(surfaces.focusAfterAsk));
  check('Ctrl-O opens the full transcript (its footer reads "esc close") and Escape closes it', surfaces.fullShown === true && surfaceHas('full', 'esc close') && surfaces.fullClosed === true && !surfaceHas('closedScreen', 'esc close'), JSON.stringify({ lines: surfaces.linesShown, opened: surfaces.fullShown, closed: surfaces.fullClosed, footer: (surfaces.full ?? '').split('\n').filter((line) => line.includes('esc close')), screenTail: (surfaces.full ?? '').split('\n').filter((line) => line.trim() !== '').slice(-10) }));
});
