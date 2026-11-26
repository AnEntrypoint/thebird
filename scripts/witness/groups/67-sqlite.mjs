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

group('sqlite', async () => {
  const sqlite = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', 'sqlite3 notes/app.db "create table t(x)"'],
    ['run', 'sqlite3 notes/app.db "insert into t values (1),(2),(3)"'],
    ['run', 'sqlite3 notes/app.db "select sum(x) from t"'],
  ]);
  check('in-page sqlite3 creates a database and answers a query through tjs:sqlite', sqlite.engine === 'ready' && /^6$/m.test(sqlite.out), sqlite.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const tjsSum = await terminal([['run', `tjs -e "import { Database } from 'tjs:sqlite'; const db = new Database('notes/app.db'); console.log(db.prepare('select sum(x) as total from t').all()[0].total); db.close();"`]]);
  check('in-page tjs -e opens a tjs:sqlite database and sums it', /^6$/m.test(tjsSum.out), tjsSum.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const reopened = await terminal([['run', 'sqlite3 notes/app.db "select count(*) from t"']], { restart: true });
  check('in-page sqlite3 database survives a browser restart', /^3$/m.test(reopened.out), reopened.out.split('\n').slice(-2).join(' / ').slice(0, 140));
  const rowStatements = "drop table if exists people; create table people(id integer primary key, name text, score real); insert into people(name, score) values ('ann', 1.5), ('bo', null), ('cy', 3); select id, name, score from people order by id; select sum(score) as total, count(*) as n from people; select name from people where name like 'b%'";
  const { DatabaseSync } = await import('node:sqlite');
  const reference = new DatabaseSync(':memory:');
  const referenceRows = rowStatements.split(';').map((sql) => sql.trim()).filter(Boolean).flatMap((sql) => reference.prepare(sql).all().map((row) => Object.values(row).map((value) => (value === null ? '' : String(value))).join('|')));
  reference.close();
  const expectedRows = referenceRows.join('\n');
  const rowsRun = await terminal([['run', `sqlite3 notes/rows.db "${rowStatements}"`]]);
  check('in-page sqlite3 returns the same rows as a reference SQLite for the same statements', expectedRows.length > 0 && rowsRun.out.includes(expectedRows), `expected ${JSON.stringify(expectedRows)} / got ${JSON.stringify(rowsRun.out.split('\n').slice(-6).join(' / ').slice(0, 220))}`);
});
