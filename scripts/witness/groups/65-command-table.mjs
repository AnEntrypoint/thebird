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

group('command-table', async () => {
  const listing = await terminal([], {
    interact: async ({ press }) => {
      await press('Tab');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    },
  });
  const offeredLine = listing.out.split('\n').filter((line) => line.includes('python3') && line.includes('sqlite3') && line.includes('  ')).pop() ?? '';
  const offered = offeredLine.split('  ').map((name) => name.trim()).filter(Boolean);
  const commandTable = await terminal([['run', `for n in ${offered.map((name) => `'${name}'`).join(' ')}; do command -v "$n" >/dev/null || echo missing-$n; done; echo all-checked`]]);
  check('every name Tab offers in command position resolves in-page, and the custom builtins are among them', offered.length > 200 && ['git', 'sqlite3', 'python3', 'curl', 'wget'].every((name) => offered.includes(name)) && /^all-checked$/m.test(commandTable.out) && !/^missing-/m.test(commandTable.out), `${offered.length} names; ` + commandTable.out.split('\n').filter((line) => /^(all-checked|missing)/.test(line)).join(' / ').slice(0, 160));
  const lookup = await terminal([['run', 'if which jq; then echo if-jq-found; fi; if which nosuch; then echo bad-nosuch; else echo if-nosuch-missing; fi; type git; type -t git; command -v git; which git']]);
  check('in-page which drives an if: a found name passes and a missing one fails', /^if-jq-found$/m.test(lookup.out) && /^if-nosuch-missing$/m.test(lookup.out) && !/^bad-nosuch$/m.test(lookup.out), lookup.out.split('\n').slice(-6).join(' / ').slice(0, 160));
  check('in-page git is reported as a builtin by type, command -v and which', /^git is a shell builtin$/m.test(lookup.out) && /^builtin$/m.test(lookup.out) && lookup.out.split('\n').filter((line) => line === 'git').length === 2, lookup.out.split('\n').slice(-5).join(' / ').slice(0, 160));
  const lookupChunks = [];
  for (let i = 0; i < offered.length; i += 40) lookupChunks.push(offered.slice(i, i + 40));
  const lookupTable = await terminal(lookupChunks.map((chunk, index) => ['run', `for n in ${chunk.map((name) => `'${name}'`).join(' ')}; do a=$(command -v "$n"); w=$(which "$n"); k=$(type -t "$n"); [ "$a" = "$w" ] || echo mismatch-which-$n; case "$a" in /*) [ "$k" = file ] || echo mismatch-kind-$n ;; *) case "$k" in builtin|keyword|function) ;; *) echo mismatch-kind-$n ;; esac ;; esac; done; echo lookup-chunk-done`]));
  const chunksDone = lookupTable.out.split('\n').filter((line) => line === 'lookup-chunk-done').length;
  check('which, command -v and type agree for every name Tab offers, path or builtin', chunksDone === lookupChunks.length && !/^mismatch-/m.test(lookupTable.out), `${chunksDone}/${lookupChunks.length} chunks; ` + lookupTable.out.split('\n').filter((line) => /^mismatch-/.test(line)).slice(0, 4).join(' / ').slice(0, 160) + ' || tail: ');
});
