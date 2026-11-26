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

group('/__thebird/progress accepts a rollout, /__thebird/craft lists its apps and routes each intent, and /sites/<id>/settings answers its form and saves a title', async () => {
  const pagesDir = await sharedPages();
  const port = await freePort();
  const id = 'cov-api-' + process.pid;
  const base = 'http://127.0.0.1:' + port;
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  const call = (path, init) => fetch(base + path, init).then(async (res) => { const text = await res.text(); return { status: res.status, text, body: parse(text) }; }, () => ({ status: 0, text: '', body: null }));
  const post = (path, payload) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  let child = null;
  try {
    webserverCli('register', id, '--title', 'API coverage');
    child = spawn(process.execPath, [join(root, 'bin', 'thebird-web-host.js'), 'serve', '--port', String(port), '--root', pagesDir], { cwd: root, stdio: 'ignore' });
    trackPid(child.pid);
    const up = (await pollAnswer(base + '/', 200)).status === 'HTTP 200';
    const settingsGet = await call('/sites/' + id + '/settings');
    const settingsSaved = await post('/sites/' + id + '/settings', { title: 'Coverage Title' });
    const progress = await post('/__thebird/progress', { id, text: 'Rolling out coverage', status: 'working' });
    const registry = await call('/__thebird/craft');
    const routes = [['review sheet.xlsx', 'gridcraft'], ['edit document.docx', 'wordcraft'], ['render report.pdf', 'pdfcraft']];
    const routed = [];
    for (const [text] of routes) routed.push(await post('/__thebird/craft/intent', { text }));
    check('/sites/<id>/settings answers its form with HTTP 200, the fields and the POST path', up && settingsGet.status === 200 && settingsGet.text.includes('"fields"') && settingsGet.text.includes('/settings'), JSON.stringify([settingsGet.status, settingsGet.text.slice(0, 120)]));
    check('POST /sites/<id>/settings saves the title and answers ok', settingsSaved.status === 200 && settingsSaved.body?.ok === true && settingsSaved.body?.settings?.title === 'Coverage Title', JSON.stringify(settingsSaved.body ?? settingsSaved.text).slice(0, 160));
    check('POST /__thebird/progress accepts a rollout status and answers ok', progress.status === 200 && progress.body?.ok === true, JSON.stringify(progress.body ?? progress.text).slice(0, 120));
    check('/__thebird/craft lists the lazy apps gridcraft, wordcraft and pdfcraft', registry.status === 200 && registry.text.includes('"lazy":true') && ['gridcraft', 'wordcraft', 'pdfcraft'].every((app) => registry.text.includes(app)), registry.text.slice(0, 120));
    routes.forEach(([text, app], index) => check('/__thebird/craft/intent routes "' + text + '" to ' + app, routed[index].body?.app === app, JSON.stringify(routed[index].body ?? routed[index].text).slice(0, 120)));
  } finally {
    if (child) await stopPid(child.pid);
    webserverCli('unregister', id, '--remove-folder');
  }
});
