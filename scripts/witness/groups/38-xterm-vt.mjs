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

group('xterm-vt', async () => {
  const vt = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const typed = async (command) => {
        await type(command);
        await press('Enter');
        await waitFor("document.body.dataset.busy !== 'true'", 40000);
        await new Promise((resolve) => setTimeout(resolve, 300));
      };
      const lines = () => evaluate("globalThis.thebird.text().split('\\n').filter((line) => !line.startsWith('thebird '))");
      await typed("printf 'AAAA\\033[2DBB\\n'");
      vt.moved = (await lines()).includes('AABB');
      await typed("printf 'junk-row\\n\\033[2J\\033[Hclean-row\\n'");
      const cleared = await evaluate("(() => { const buffer = globalThis.thebird.term.buffer.active; return buffer.getLine(buffer.viewportY).translateToString(true); })()");
      vt.cleared = cleared === 'clean-row' && !(await lines()).includes('junk-row');
      await typed("printf '\\033[?1049halt-row\\n'");
      vt.alternate = await evaluate('globalThis.thebird.term.buffer.active.type');
      await typed("printf '\\033[?1049l'");
      vt.normal = await evaluate('globalThis.thebird.term.buffer.active.type');
      vt.altGone = !(await lines()).includes('alt-row');
      await typed("printf 'w%.0s' $(seq 1 200); echo");
      vt.wrapped = await evaluate("(() => { const buffer = globalThis.thebird.term.buffer.active; let rows = 0; for (let row = 0; row < buffer.length; row++) if (buffer.getLine(row).isWrapped) rows++; return rows; })()");
      vt.longLine = (await lines()).includes('w'.repeat(200));
      await evaluate('globalThis.thebird.term.resize(60, 20)');
      await typed('echo cols-$COLUMNS-lines-$LINES');
      vt.size = (await lines()).find((line) => line.startsWith('cols-'));
    },
  });
  check('xterm moves the cursor and clears the screen on the escape sequences', vt.moved === true && vt.cleared === true, JSON.stringify(vt));
  check('xterm enters and leaves the alternate screen, and the normal screen does not keep its text', vt.alternate === 'alternate' && vt.normal === 'normal' && vt.altGone === true, JSON.stringify(vt));
  check('a 200-character line wraps across rows and reads back as one line', vt.wrapped >= 2 && vt.longLine === true, JSON.stringify(vt));
  check('a terminal resize reaches the shell as COLUMNS and LINES', vt.size === 'cols-60-lines-20', JSON.stringify(vt.size));
});
