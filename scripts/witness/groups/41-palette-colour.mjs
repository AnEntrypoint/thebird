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

group('palette-colour', async () => {
  const palette = {};
  await terminal([
    ['run', "printf '\\033[38;5;196mX196\\033[0m\\n'"],
    ['run', "printf '\\033[38;2;255;0;0mRGB255\\033[0m\\n'"],
    ['run', "printf 'no-newline-yet'"],
    ['run', 'echo after-no-newline'],
  ], {
    interact: async ({ evaluate, waitFor }) => {
      await waitFor("globalThis.thebird.text().includes('after-no-newline')", 40000);
      const styleOf = (line) => evaluate(`(() => { const buffer = globalThis.thebird.term.buffer.active; for (let row = 0; row < buffer.length; row++) { const current = buffer.getLine(row); if (current.translateToString(true) === ${JSON.stringify(line)}) { const cell = current.getCell(0); return { fg: cell.getFgColor(), palette: Boolean(cell.isFgPalette()), rgb: Boolean(cell.isFgRGB()) }; } } return null; })()`);
      palette.x196 = await styleOf('X196');
      palette.rgb = await styleOf('RGB255');
      palette.lines = await evaluate("globalThis.thebird.text().split('\\n')");
    },
  });
  const noNewlineAt = palette.lines.indexOf('no-newline-yet');
  const alone = await terminal([['run', "printf 'alone-no-newline'"]]);
  const aloneLines = alone.out.split('\n');
  const aloneAt = aloneLines.indexOf('alone-no-newline');
  check('colour: a 256-colour index and a truecolour value reach the cell, and queued output starts its own row after unterminated output', palette.x196?.fg === 196 && palette.x196.palette === true && palette.rgb?.rgb === true && palette.rgb.fg === 0xff0000 && noNewlineAt !== -1 && palette.lines.slice(noNewlineAt + 1).includes('after-no-newline'), JSON.stringify({ x196: palette.x196, rgb: palette.rgb, around: palette.lines.slice(Math.max(noNewlineAt, 0), noNewlineAt + 3) }));
  check('colour: unterminated output is followed by the prompt on its own row', aloneAt !== -1 && aloneLines[aloneAt + 1]?.startsWith('thebird '), JSON.stringify(aloneLines.slice(-3)));
});
