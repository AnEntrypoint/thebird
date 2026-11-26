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

group('lint-architecture-comments', async () => {
const architecture = spawnSync(process.execPath, [join(root, 'scripts', 'lint-architecture.mjs'), '--static'], { cwd: root, encoding: 'utf8', timeout: 120000 });
const architectureFailures = architecture.stdout.split('\n').filter((line) => line.startsWith('FAIL')).length;
check('ARCHITECTURE.md and AGENTS.md claims have no contradictions with the code', architecture.status === 0 && architectureFailures === 0, architectureFailures ? `${architectureFailures} claim(s) fail; run node scripts/lint-architecture.mjs` : architecture.stdout.split('\n').at(-2) ?? '');
const comments = spawnSync(process.execPath, [join(root, 'scripts', 'lint-comments.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000 });
check('repo-owned code has no comments (scripts/lint-comments.mjs)', comments.status === 0 && /repo-owned files checked: 0 comments;/.test(comments.stdout), comments.stdout.split('\n').filter((line) => line.startsWith('FAIL')).slice(0, 3).join('; ') || comments.stdout.trim().split('\n').at(-1));
const vendoredLines = comments.stdout.split('\n').filter((line) => line.startsWith('VENDORED'));
check('every vendored bundle with comments has a provenance witness (upstream name)', comments.status === 0 && vendoredLines.length > 0 && vendoredLines.every((line) => line.includes('named (third-party, not edited)') || /listed in web\/vendor\/(fx|floosie)\/manifest\.json \(third-party, not edited\)/.test(line)) && !comments.stdout.includes('FAIL'), vendoredLines.map((line) => line.split(':')[0].replace('VENDORED ', '')).join(', ') || 'no vendored bundle reported');
});
