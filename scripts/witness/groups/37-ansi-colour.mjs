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

group('ansi-colour', async () => {
  const ansiCommand = "printf '\\033[31mred-line\\033[0m\\n\\033[1;4;42mstyled-line\\033[0m\\n'";
  const styled = {};
  await terminal([['run', ansiCommand]], {
    interact: async ({ evaluate, waitFor }) => {
      await waitFor("globalThis.thebird.text().includes('styled-line')", 20000);
      const styleOf = (line) => evaluate(`(() => { const buffer = globalThis.thebird.term.buffer.active; for (let row = 0; row < buffer.length; row++) { const current = buffer.getLine(row); if (current.translateToString(true) === ${JSON.stringify(line)}) { const cell = current.getCell(0); return { fg: cell.getFgColor(), palette: cell.isFgPalette(), bg: cell.getBgColor(), bgPalette: cell.isBgPalette(), bold: Boolean(cell.isBold()), underline: Boolean(cell.isUnderline()) }; } } return null; })()`);
      styled.red = await styleOf('red-line');
      styled.styled = await styleOf('styled-line');
      styled.text = await evaluate('globalThis.thebird.text()');
    },
  });
  check('xterm renders SGR colour: red-line uses palette 1, styled-line is bold, underlined and on palette 2', styled.red?.palette === true && styled.red.fg === 1 && styled.styled?.bold === true && styled.styled.underline === true && styled.styled.bgPalette === true && styled.styled.bg === 2, JSON.stringify(styled));
  check('the terminal consumes the escape sequences, so the text carries none of them', /^red-line$/m.test(styled.text) && /^styled-line$/m.test(styled.text) && !styled.text.split('\n').filter((line) => !line.startsWith('thebird ')).some((line) => line.includes('[31m')), JSON.stringify(styled.text?.slice(0, 80)));
});
