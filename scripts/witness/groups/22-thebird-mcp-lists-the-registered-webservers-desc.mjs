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

group('/__thebird/mcp lists the registered webservers, describes one, answers its ping over POST, and refuses an unregistered id', async () => {
  const pagesDir = await sharedPages();
  const port = await freePort();
  const id = 'cov-mcp-' + process.pid;
  const base = `http://127.0.0.1:${port}`;
  const webserver = webserverCli;
  const call = (path, init) => fetch(base + path, init).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }), () => ({ status: 0, body: null }));
  const post = (path, method) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method }) });
  let child = null;
  try {
    webserver('register', id, '--title', 'MCP coverage');
    child = spawn(process.execPath, [join(root, 'bin', 'thebird-web-host.js'), 'serve', '--port', String(port), '--root', pagesDir], { cwd: root, stdio: 'ignore' });
    trackPid(child.pid);
    const up = (await pollAnswer(base + '/', 200)).status === 'HTTP 200';
    const list = await call('/__thebird/mcp');
    const descriptor = await call('/__thebird/mcp/' + id);
    const ping = await post('/__thebird/mcp/' + id, 'ping');
    const unknown = await post('/__thebird/mcp/' + id + '-missing', 'ping');
    check('/__thebird/mcp lists the endpoint of the registered webserver', up && list.status === 200 && list.body?.endpoints?.includes('/__thebird/mcp/' + id), JSON.stringify(list));
    check('/__thebird/mcp/<id> describes a ping tool at its own endpoint', descriptor.status === 200 && descriptor.body?.endpoint === '/__thebird/mcp/' + id && descriptor.body?.tools?.some((tool) => tool.name === 'ping') === true, JSON.stringify(descriptor.body).slice(0, 160));
    check('POST /__thebird/mcp/<id> with method ping answers ok with pong', ping.status === 200 && ping.body?.ok === true && ping.body?.result === 'pong', JSON.stringify(ping));
    check('POST /__thebird/mcp/<id> for an unregistered id answers 404', unknown.status === 404, String(unknown.status));
  } finally {
    if (child) await stopPid(child.pid);
    webserver('unregister', id, '--remove-folder');
  }
});
