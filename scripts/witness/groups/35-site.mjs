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

group('site', async () => {
const SITE_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' };
  const pagesDir = await buildPages(mkdtempSync(join(tmpdir(), 'thebird-site-own-')));
  const pagesServer = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const rest = pathname.startsWith('/thebird/') ? pathname.slice('/thebird/'.length) || 'index.html' : null;
    const file = rest === null ? null : join(pagesDir, rest);
    if (!file || !file.startsWith(pagesDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': SITE_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => pagesServer.listen(0, '127.0.0.1', resolve));
  const pagesUrl = `http://127.0.0.1:${pagesServer.address().port}/thebird/`;
  const pagesResponse = await fetch(pagesUrl);
  const siteUrl = pagesUrl + '?' + new URLSearchParams([['run', 'echo pages-ok'], ['run', 'python3 -c "print(6*7)"'], ['run', 'qjs -e "console.log(1)"'], ['run', 'fx --version'], ['run', 'fx check'], ['run', 'which fx'], ['run', 'type -t fx'], ['run', 'which gm'], ['run', 'type -t gm'], ['run', `gm stdio '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}'`], ['run', `gm stdio '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`], ['run', `gm stdio '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_code","arguments":{"body":"return 6*7;"}}}'`], ['run', `gm stdio '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"finish","arguments":{"witness":"browser hub check"}}}'`]]).toString();
  const site = await runAt(siteUrl);
  pagesServer.close();
  const quickjsArtifactGone = !existsSync(join(pagesDir, 'web', 'vendor', 'quickjs'));
  const fxArtifact = join(pagesDir, 'web', 'vendor', 'fx', 'fx-core.wasm');
  const fxArtifactShipped = existsSync(fxArtifact);
  const siteIndex = readFileSync(join(pagesDir, 'index.html'), 'utf8');
  const siteBundle = join(pagesDir, 'web', 'terminal.bundle.js');
  const bundleText = existsSync(siteBundle) ? readFileSync(siteBundle, 'utf8') : '';
  const moduleScripts = siteIndex.match(/<script type="module" src="[^"]+"/g) ?? [];
  check('the built page loads one bundled script that has no relative module imports, and runs', moduleScripts.length === 1 && moduleScripts[0].includes('web/terminal.bundle.js') && bundleText.length > 0 && !/^import\s.*from\s+['"]\.{1,2}\//m.test(bundleText), `${moduleScripts.join(' ')}; bundle ${bundleText.length} bytes`);
  rmSync(pagesDir, { recursive: true, force: true });
  check('the built site runs qjs -e through the txiki engine, and ships no quickjs artifact', quickjsArtifactGone && /^1$/m.test(site.out) && /^pages-ok$/m.test(site.out), site.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  check('in-page fx reports its bundled WASM version and passes its offline check', site.engine === 'ready' && /^fx-core\.wasm [0-9a-f]{12} libfx SDK 2$/m.test(site.out) && /^fx ready: JSPI (available|missing); core application\/wasm$/m.test(site.out) && /^fx$/m.test(site.out) && /^builtin$/m.test(site.out) && fxArtifactShipped, site.out.split('\n').slice(-8).join(' / ').slice(0, 220));
  check('the built GitHub Pages site runs bash and python3 without COOP/COEP headers', site.engine === 'ready' && /^pages-ok$/m.test(site.out) && /^42$/m.test(site.out) && pagesResponse.headers.get('cross-origin-opener-policy') === null && pagesResponse.headers.get('cross-origin-embedder-policy') === null, site.out.split('\n').slice(-3).join(' / ').slice(0, 140));
});
