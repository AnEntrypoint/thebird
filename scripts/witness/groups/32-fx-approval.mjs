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

group('fx-approval', async () => {
  const stubTui = await startFxStubGateway();
  const stubInit = `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'anthropic/claude-haiku-5.5', gatewayChatUrl: stubTui.url, permissionMode: 'ask' })};`;
  const surfaces = {};
  await terminal([], {
    initScript: stubInit,
    interact: async ({ type, press, evaluate, waitFor, settle }) => {
      const linesOf = `globalThis.thebird.text().split('\\n')`;
      const hasText = (text) => `${linesOf}.some((line) => line.includes(${JSON.stringify(text)}))`;
      const grab = async (name) => { surfaces[name] = await evaluate(TUI_SCREEN); };
      const submit = async (text) => { await type(text); await press('Enter'); };
      await type('fx');
      await press('Enter');
      surfaces.welcomeShown = await settle(`globalThis.thebird.text().includes('Welcome to fx')`, 120000);
      await evaluate("import(new URL('web/fx-host-tools.js', location.href).href).then((m) => { globalThis.__pageHostToolCount = m.PAGE_HOST_TOOLS.length; })");
      await settle('globalThis.__pageHostToolCount !== undefined', 30000);
      surfaces.hostToolCount = await evaluate('globalThis.__pageHostToolCount ?? null');
      await submit('hello');
      surfaces.transcriptShown = await settle(hasText('stub gateway answer: prompt=hello'), 90000);
      await grab('transcript');
      await submit('[tool:bash] [input:{"command":"echo approval"}]');
      surfaces.approvalShown = await settle(`${hasText('Allow once')} || ${hasText('tool-result=seen')}`, 90000);
      await grab('approval');
      await press('Escape');
      await new Promise((ok) => setTimeout(ok, 2000));
      await grab('approvalDismissed');
    },
  });
  await terminal([], {
    initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: FX_STUB_KEY, model: 'anthropic/claude-haiku-5.5', gatewayChatUrl: stubTui.url })};`,
    interact: async ({ type, press, evaluate, waitFor, settle }) => {
      const hasText = (text) => `globalThis.thebird.text().split('\\n').some((line) => line.includes(${JSON.stringify(text)}))`;
      const submit = async (text) => { await type(text); await press('Enter'); };
      await type('fx');
      await press('Enter');
      await settle(`globalThis.thebird.text().includes('Welcome to fx')`, 120000);
      await submit('[tool:bash] [input:{"command":"echo auto"}]');
      surfaces.autoRan = await settle(hasText('tool-result=seen'), 90000);
      surfaces.auto = await evaluate(TUI_SCREEN);
    },
  });
  await stubTui.close();
  const surfaceHas = (name, text) => (surfaces[name] ?? '').split('\n').some((line) => line.includes(text));
  const surfaceRow = (name, text) => (surfaces[name] ?? '').split('\n').some((line) => line === text);
  check('transcript: the prompt and the stub answer appear in the TUI transcript', surfaces.transcriptShown === true && surfaceHas('transcript', 'stub gateway answer: prompt=hello'), JSON.stringify({ shown: surfaces.transcriptShown, stub: stubTui.seen.slice(0, 2) }));
  const approvalPanelRows = (name) => (surfaces[name] ?? '').split('\n').filter((line) => line.includes('echo approval') && !line.startsWith('┃'));
  check('auto mode: a bash tool call runs to its tool result with no approval prompt', surfaces.autoRan === true && surfaceHas('auto', 'tool-result=seen') && !surfaceHas('auto', 'Allow once') && !surfaceHas('auto', '3. Deny'), JSON.stringify({ ran: surfaces.autoRan, rows: (surfaces.auto ?? '').split('\n').filter((line) => /Allow once|Deny|tool-result/.test(line)).slice(0, 4) }));
  check('approval: a bash tool call opens the approval panel with its options and its command row', surfaces.approvalShown === true && surfaceHas('approval', '1. Allow once') && surfaceHas('approval', '3. Deny') && approvalPanelRows('approval').length > 0, JSON.stringify({ options: (surfaces.approval ?? '').split('\n').filter((line) => /1\. Allow once|3\. Deny/.test(line)), commandRows: approvalPanelRows('approval'), screenTail: (surfaces.approval ?? '').split('\n').filter((line) => line.trim() !== '').slice(-8), stub: stubTui.seen.map((request) => ({ roles: request.roles, tools: request.tools, prompt: String(Array.isArray(request.prompt) ? request.prompt.map((item) => item?.content?.[0]?.text ?? item?.role).join(' | ') : request.prompt).slice(0, 160) })) }));
  check('negative control: a plain prompt with no approval-requiring tool shows no approval panel', surfaceHas('transcript', 'stub gateway answer: prompt=hello') && !surfaceHas('transcript', 'Allow once') && !surfaceHas('transcript', '3. Deny'), JSON.stringify((surfaces.transcript ?? '').split('\n').filter((line) => /Allow once|3\. Deny/.test(line))));
  check(`host tools: the page exports the ${PAGE_HOST_TOOL_NAMES.length} page host tools to the TUI before it starts: ${PAGE_HOST_TOOL_NAMES.join(', ')}`, surfaces.hostToolCount === PAGE_HOST_TOOL_NAMES.length, String(surfaces.hostToolCount));
  const tuiTools = [...new Set(stubTui.seen.flatMap((request) => request.tools))].sort();
  check(`host tools: the TUI advertises exactly the page host tools and the fx shell tool to its gateway: ${FX_TUI_TOOLS.join(', ')}`, JSON.stringify(tuiTools) === JSON.stringify(FX_TUI_TOOLS), JSON.stringify(tuiTools));
});
