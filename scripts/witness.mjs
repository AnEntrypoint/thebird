import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer as createNetServer } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { startNpmMirror } from './npm-mirror.mjs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRelay } from '../src/relay.js';
import { closeBrowserTree, closeBrowserTrees, runTerminal, startBrowser, withTimeout } from './browser-driver.mjs';
import { vendorBashkit } from './vendor-bashkit.mjs';
import { vendorFx } from './vendor-fx.mjs';
import { vendorFloosie } from './vendor-floosie.mjs';
import { buildPages } from './build-pages.mjs';
import { startFxStubGateway, FX_STUB_KEY } from './fx-stub-gateway.mjs';
import { PAGE_HOST_TOOL_NAMES } from '../web/fx-host-tools.js';

import { COLD_START_MS, DEFAULT_CONTEXT_GROUPS, FX_TUI_TOOLS, GRAPHEMES, GROUP_BUDGET_MS, JOBS, LIVE_UNAVAILABLE, OPENROUTER_MODELS_URL, OPENROUTER_URL, PAGE_TOOLS, SITE_TYPES, TUI_PALETTE_RESIZE_SETTLED, TUI_RESIZE_SETTLED, TUI_SCREEN, TUI_STATE, TUI_TITLE, alive, binRunner, browserFor, check, chrome, craftCli, current, disposeContext, dotenvValue, fetchWithFallback, freeModels, freePort, getMirror, getRelay, group, groups, haveChrome, heavyTail, listening, liveCheck, liveProvider, liveRun, liveVerdict, loadAverage, pollAnswer, profileDir, providerVerdict, reapBrowserTrees, registryNet, root, runAt, runGroup, runHeavy, scope, scratchDir, scratchDirs, servePages, serveThenStop, services, shared, sharedBrowserFor, sharedBrowserStart, sharedPages, sharedProfile, skip, skipLive, spawnedPids, startChatStub, startProviderStub, stopPid, terminal, trackPid, webhostCli, webserverCli, within } from './witness/shared.mjs';
import './witness/groups/01-relay.mjs';
import './witness/groups/02-playwriter-hello.mjs';
import './witness/groups/03-touch-m-and-a-change-only-the-time-they-name-as-.mjs';
import './witness/groups/04-tjs-utime-sets-the-modification-time-that-tjs-st.mjs';
import './witness/groups/05-uv-fs.mjs';
import './witness/groups/06-fx-builtin.mjs';
import './witness/groups/07-fx-tui.mjs';
import './witness/groups/08-fx-tool-bridge.mjs';
import './witness/groups/09-fx-graphemes.mjs';
import './witness/groups/10-fx-tui-registry.mjs';
import './witness/groups/11-the-txiki-shell-touch-m-and-a-set-the-times-that.mjs';
import './witness/groups/12-thebird-web-host-serve-listens-on-the-port-it-is.mjs';
import './witness/groups/13-feature-a-page-command-registers-a-feature-lists.mjs';
import './witness/groups/14-thebird-webserver-register-scaffolds-a-server-th.mjs';
import './witness/groups/15-thebird-relay-starts-on-the-port-it-is-given-ser.mjs';
import './witness/groups/16-thebird-web-host-start-status-and-stop-run-one-m.mjs';
import './witness/groups/17-scripts-serve-web-host-mjs-which-npm-run-host-se.mjs';
import './witness/groups/18-npm-run-host-check-passes-every-check-of-the-can.mjs';
import './witness/groups/19-npm-scripts-run-exactly-the-command-their-table-.mjs';
import './witness/groups/20-thebird-craft-ensure-sample-and-status-print-the.mjs';
import './witness/groups/21-thebird-progress-accepts-a-rollout-thebird-craft.mjs';
import './witness/groups/22-thebird-mcp-lists-the-registered-webservers-desc.mjs';
import './witness/groups/23-terminal-html-loads-draws-its-terminal-and-panes.mjs';
import './witness/groups/24-closebrowsertrees-kills-the-trees-it-recorded-an.mjs';
import './witness/groups/25-code-with-no-call-site-stays-out-the-stream-hub-.mjs';
import './witness/groups/26-fx-host-loads-in-the-page-node-version-capabilit.mjs';
import './witness/groups/27-two-hosts-one-plugin-fx-host-plugin-mjs-prints-o.mjs';
import './witness/groups/28-a-sibling-module-imports-fx-host-and-the-entry-r.mjs';
import './witness/groups/29-provider-verdict-a-403-key-limit-is-a-skip-and-a.mjs';
import './witness/groups/30-a-live-row-that-sees-http-429-inside-the-page-is.mjs';
import './witness/groups/31-fx-tui-live.mjs';
import './witness/groups/32-fx-approval.mjs';
import './witness/groups/33-fx-provider.mjs';
import './witness/groups/34-fx-ask.mjs';
import './witness/groups/35-site.mjs';
import './witness/groups/36-opfs-files.mjs';
import './witness/groups/37-ansi-colour.mjs';
import './witness/groups/38-xterm-vt.mjs';
import './witness/groups/39-scrollback.mjs';
import './witness/groups/40-container-resize.mjs';
import './witness/groups/41-palette-colour.mjs';
import './witness/groups/42-wide-chars.mjs';
import './witness/groups/43-paste.mjs';
import './witness/groups/44-host-tools.mjs';
import './witness/groups/45-node-txiki-npm-registry.mjs';
import './witness/groups/46-node-txiki-npm.mjs';
import './witness/groups/47-loops.mjs';
import './witness/groups/48-spin.mjs';
import './witness/groups/49-nested.mjs';
import './witness/groups/50-fetch.mjs';
import './witness/groups/51-git-repo.mjs';
import './witness/groups/52-git-background.mjs';
import './witness/groups/53-input-recall.mjs';
import './witness/groups/54-ctrl-c-line.mjs';
import './witness/groups/55-tab-complete.mjs';
import './witness/groups/56-cd-path.mjs';
import './witness/groups/57-queue.mjs';
import './witness/groups/58-queue-drop.mjs';
import './witness/groups/59-ctrl-c-curl.mjs';
import './witness/groups/60-qjs.mjs';
import './witness/groups/61-editing.mjs';
import './witness/groups/62-streaming.mjs';
import './witness/groups/63-history.mjs';
import './witness/groups/64-command-tab.mjs';
import './witness/groups/65-command-table.mjs';
import './witness/groups/66-emulations.mjs';
import './witness/groups/67-sqlite.mjs';
import './witness/groups/68-python.mjs';
import './witness/groups/69-site-manifest-retry.mjs';
import './witness/groups/70-site-package.mjs';
import './witness/groups/71-python-lazy.mjs';
import './witness/groups/72-python-splash.mjs';
import './witness/groups/73-pip-fallback.mjs';
import './witness/groups/74-pyodide-lock.mjs';
import './witness/groups/75-pip.mjs';
import './witness/groups/76-splash-probe.mjs';
import './witness/groups/77-python-warm.mjs';
import './witness/groups/78-python-files.mjs';
import './witness/groups/79-expiry.mjs';
import './witness/groups/80-fs-watch.mjs';
import './witness/groups/81-retired-artifacts.mjs';
import './witness/groups/82-lint-architecture-comments.mjs';
import './witness/groups/83-hosting-pins.mjs';
import './witness/groups/84-birdman.mjs';
import './witness/groups/85-call-timeout.mjs';
import './witness/groups/86-shell-budget.mjs';
import './witness/groups/87-background-jobs.mjs';
import './witness/groups/88-background-lifetime.mjs';
import './witness/groups/89-fx-long-stream.mjs';
import './witness/groups/90-fx-stream-bisect.mjs';
import './witness/groups/91-fx-live-tool.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
let selected = groups;
if (typeof argv.group === 'string') {
  const names = argv.group.split(',');
  const unknown = names.filter((name) => !groups.some((entry) => entry.name === name));
  if (unknown.length) {
    console.error(`unknown group: ${unknown.join(', ')} (see --list)`);
    process.exit(2);
  }
  selected = selected.filter((entry) => names.includes(entry.name));
}
if (typeof argv.check === 'string') selected = selected.filter((entry) => entry.source.includes(argv.check));
if (typeof argv.part === 'string') {
  const [index, total] = argv.part.split('/').map(Number);
  selected = selected.filter((_, position) => position % total === index - 1);
}
if (argv.list) {
  for (const entry of selected) console.log(entry.name);
  process.exit(0);
}
if (selected.length === 0) {
  console.error('no group matches the selection (see --list)');
  process.exit(2);
}

if (haveChrome && selected.some((entry) => entry.browser)) {
  if (!existsSync(join(root, 'web', 'vendor', 'bashkit', 'bashkit_wasm_bg.wasm'))) await vendorBashkit();
  if (!existsSync(join(root, 'web', 'vendor', 'fx', 'fx-core.wasm'))) await vendorFx();
  if (!existsSync(join(root, 'web', 'vendor', 'floosie', 'browser.js'))) await vendorFloosie();
} else if (selected.some((entry) => entry.browser)) {
  console.log(`SKIP browser groups — no Chromium at ${chrome} (set CHROME_BIN)`);
}

const queue = selected.filter((entry) => !entry.browser || haveChrome);
const outcomes = [];
const startedAll = performance.now();
const treeRss = { mb: 0, processes: 0 };
const sampleTreeRss = () => {
  const rows = spawnSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const children = new Map();
  for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const rssOf = new Map(rows.map(([pid, , rss]) => [pid, rss]));
  const tree = [];
  const stack = [process.pid];
  while (stack.length) {
    const pid = stack.pop();
    tree.push(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  const kb = tree.reduce((sum, pid) => sum + (rssOf.get(pid) ?? 0), 0);
  if (kb / 1024 > treeRss.mb) treeRss.mb = kb / 1024;
  treeRss.processes = Math.max(treeRss.processes, tree.length - 1);
};
const sampler = setInterval(sampleTreeRss, 500);
sampler.unref();
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const entry = queue.shift();
    outcomes.push(await (entry.heavy ? runHeavy(entry) : runGroup(entry)));
  }
}));
const leaked = [...spawnedPids].filter(alive);
for (const pid of leaked) console.log('FAIL server pid ' + pid + ' was left running');
outcomes.push({ name: 'servers started by the checks', seconds: 0, results: leaked.length ? leaked.map((pid) => ({ name: 'server pid ' + pid + ' was left running', ok: false })) : [{ name: 'every server the checks started has stopped', ok: true }] });
for (const pid of leaked) process.kill(pid, 'SIGKILL');
const failures = outcomes.flatMap((outcome) => outcome.results).filter((result) => result.ok === false).length;
const skipped = outcomes.flatMap((outcome) => outcome.results).filter((result) => result.skipped === true).length;
const passed = outcomes.flatMap((outcome) => outcome.results).filter((result) => result.ok === true).length;
console.log('\nGROUP WALL TIMES (slowest first)');
for (const outcome of [...outcomes].sort((a, b) => b.seconds - a.seconds)) console.log(`${outcome.seconds.toFixed(1).padStart(8)}s  ${outcome.name}`);
console.log(`\ntotals: PASS ${passed} FAIL ${failures} SKIP ${skipped} GROUPS ${outcomes.length} WALL ${((performance.now() - startedAll) / 1000).toFixed(1)}s`);
clearInterval(sampler);
console.log(`peak witness tree RSS ${treeRss.mb.toFixed(0)} MB across ${treeRss.processes} descendant processes`);
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
await (await sharedBrowserStart)?.close();
for (const pending of services.values()) await (await pending.catch(() => null))?.close?.();
process.exit(failures ? 1 : 0);
