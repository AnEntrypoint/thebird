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

group('pip', async () => {
  const pipInstall = await terminal([
    ['run', 'pip install tabulate && python3 -c "import tabulate; print(tabulate.__version__)"'],
    ['run', 'pip install tabulate==0.9.0'],
    ['run', 'pip install six'],
    ['run', 'pip install definitely-not-a-real-package-xyz'],
  ]);
  const pipInstalled = /^installed tabulate \S+$/m.test(pipInstall.out) && /^\d+\.\d+\.\d+$/m.test(pipInstall.out);
  check('in-page pip installs a pure package from PyPI, and python3 imports it in the same page', pipInstalled, pipInstalled ? 'tabulate installed and imported' : 'full pip output: ' + pipInstall.out.split('\n').filter((line) => line.trim()).join(' | ').slice(0, 900));
  const pipFiles = await terminal([['run', 'find /workspace -iname "*tabulate*" | wc -l']]);
  check('pip installs stay in Pyodide memory: no tabulate file reaches OPFS', /^0$/m.test(pipFiles.out), pipFiles.out.split('\n').slice(-2).join(' / ').slice(0, 120));
  check('in-page pip refuses version specifiers, Pyodide-bundled packages and unknown names with a message and no URL', pipInstall.out.includes('version specifiers and URLs are not supported') && pipInstall.out.includes('part of the Pyodide package set') && pipInstall.out.includes("Can't fetch metadata for 'definitely-not-a-real-package-xyz'") && !/https?:\/\//.test(pipInstall.out.split('\n').filter((line) => line.startsWith('pip')).join('\n')), pipInstall.out.split('\n').filter((line) => line.startsWith('pip')).join(' / ').slice(0, 200));
  const pipCli = await terminal([
    ['run', 'pip --version'],
    ['run', 'pip -V'],
    ['run', 'pip --help; echo help-rc=$?'],
    ['run', 'pip; echo bare-rc=$?'],
    ['run', 'pip frobnicate; echo unknown-rc=$?'],
    ['run', 'pip install; echo install-rc=$?'],
  ]);
  const pipVersions = pipCli.out.split('\n').filter((line) => /^pip \d+\.\d+\.\d+ \(micropip, in-page\)$/.test(line));
  check('pip --version and pip -V print the micropip version the page loads', pipVersions.length === 2, pipVersions.join(' / ') || pipCli.out.split('\n').slice(-4).join(' / ').slice(0, 160));
  check('pip --help prints usage and exits 0', /^usage: pip install <package>\.\.\.$/m.test(pipCli.out) && /^help-rc=0$/m.test(pipCli.out), pipCli.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  check('bare pip, an unknown pip command and pip install with no names exit 2 with a message', /^bare-rc=2$/m.test(pipCli.out) && /^unknown-rc=2$/m.test(pipCli.out) && /^install-rc=2$/m.test(pipCli.out) && pipCli.out.includes("pip: unknown command 'frobnicate'") && pipCli.out.includes('pip: install needs at least one package name'), pipCli.out.split('\n').filter((line) => /^(pip|bare|unknown|install)/.test(line)).join(' / ').slice(0, 220));
  const pipQuiet = await terminal([['run', 'pip 2>/dev/null; echo quiet-rc=$?']]);
  const pipHelpStdout = await terminal([['run', 'pip --help 2>/dev/null; echo help-stdout-rc=$?']]);
  check('a bare pip prints its usage to stderr only, and exits 2', /^quiet-rc=2$/m.test(pipQuiet.out) && !pipQuiet.out.includes('usage:'), pipQuiet.out.split('\n').slice(-3).join(' / ').slice(0, 160));
  check('pip --help prints its usage to stdout, so it survives 2>/dev/null', /^help-stdout-rc=0$/m.test(pipHelpStdout.out) && pipHelpStdout.out.includes('usage: pip install'), pipHelpStdout.out.split('\n').slice(-3).join(' / ').slice(0, 160));
});
