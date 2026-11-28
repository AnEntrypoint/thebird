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

const captureProxy = (target) => {
  const captured = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' };
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const upstream = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', authorization: req.headers.authorization }, body: raw });
    const text = await upstream.text();
    captured.push({
      model: parsed?.model,
      messages: parsed?.messages?.length,
      tools: (parsed?.tools ?? []).map((tool) => tool.function?.name ?? tool.name),
      toolChoice: parsed?.tool_choice ?? null,
      status: upstream.status,
      bytes: text.length,
      toolCalls: (text.match(/"tool_calls"/g) ?? []).length,
      finish: [...text.matchAll(/"finish_reason":\s*"([a-z_]+)"/g)].map((match) => match[1]).at(-1) ?? null,
    });
    res.writeHead(upstream.status, { ...cors, 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(text);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    url: 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions',
    captured,
    close: () => new Promise((done) => server.close(done)),
  })));
};

group('fx-live-tool', async () => {
  const names = ['the live request offers thebird_run to the provider', 'fx ask on the live provider runs a tool: the file its command wrote exists', 'the live turn does not end with incomplete stream'];
  const live = await liveRun(names);
  if (!live) return;
  const proxy = await captureProxy(live.url);
  const marker = 'live-tool-' + Date.now();
  const run = await terminal([
    ['run', "fx ask 'Call the thebird_run tool exactly once with the command: echo " + marker + " > /workspace/live-tool.txt . Then reply with the single word done.'"],
    ['run', 'od -c /workspace/live-tool.txt'],
    ['run', 'cat /workspace/live-tool.txt'],
  ], {
    initScript: `window.THEBIRD_FX = ${JSON.stringify({ apiKey: live.key, model: live.model, gatewayChatUrl: proxy.url })};`,
    timeoutMs: 600000,
  });
  await proxy.close();
  const detail = JSON.stringify({ model: live.model, requests: proxy.captured, tail: run.out.slice(-300) });
  liveCheck(names[0], proxy.captured.length > 0 && proxy.captured.every((request) => request.tools.includes('thebird_run')), detail);
  liveCheck(names[1], run.out.split('\n').filter((line) => line === marker).length === 1, detail);
  liveCheck(names[2], !run.out.includes('incomplete stream'), detail);
});
