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
import { startFxStubMessages } from '../../fx-stub-messages.mjs';

const MESSAGES_REQUEST = (mode) => JSON.stringify({ stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: '[cut:' + mode + '] build it' }] }] });

const readThrough = async (url, mode, abortAfterMs) => {
  const controller = new AbortController();
  const timer = abortAfterMs ? setTimeout(() => controller.abort(), abortAfterMs) : null;
  let bytes = 0;
  let text = '';
  let ending = 'closed';
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: MESSAGES_REQUEST(mode), signal: controller.signal });
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      text += new TextDecoder().decode(value);
    }
  } catch (error) {
    ending = error.name === 'AbortError' ? 'client-abort' : 'error ' + error.message;
  }
  clearTimeout(timer);
  return { bytes, text, ending };
};

group('fx-messages-protocol', async () => {
  const stub = await startFxStubMessages();
  const relay = await startRelay({ port: 0 });
  const viaRelay = relay.url + '__thebird/port/' + stub.port + '/v1/messages';
  const probes = {};
  for (const [mode, abortAfterMs] of [['none', 0], ['after-tool', 0], ['mid-delta', 0], ['hold', 4000]]) {
    const probe = await readThrough(viaRelay, mode, abortAfterMs);
    await new Promise((done) => setTimeout(done, 300));
    probes[mode] = { ...probe, stub: stub.streams.at(-1) };
    check('the relay proxy delivers every byte the messages stub wrote in mode ' + mode + (mode === 'hold' ? ' without waiting for the stream to close' : ''), probe.bytes === stub.streams.at(-1).bytesWritten, JSON.stringify({ received: probe.bytes, written: stub.streams.at(-1).bytesWritten, ending: probe.ending }));
  }
  check('through the relay a full messages stream ends with message_stop', probes.none.text.includes('"type":"message_stop"'), JSON.stringify(probes.none.text.slice(-80)));
  await relay.close?.();

  const cases = {};
  const runCase = async (mode, expected, waitMs) => {
    const init = `window.THEBIRD_FX = ${JSON.stringify({ model: 'stub/model', provider: { name: 'stubm', protocol: 'anthropic-messages', models: { 'stub/model': { contextWindow: 200000, maxOutputTokens: 8192, supportsToolUse: true } } } }).replace('"models"', '"baseUrl": location.origin + "/__thebird/port/" + ' + stub.port + ' + "/v1", "models"')};`;
    const result = { welcome: false, reached: false, screen: '' };
    await terminal([], {
      initScript: init,
      interact: async ({ type, press, evaluate, settle }) => {
        const hasText = (text) => `globalThis.thebird.text().split('\\n').some((line) => line.includes(${JSON.stringify(text)}))`;
        await type('fx');
        await press('Enter');
        result.welcome = await settle(`globalThis.thebird.text().includes('Welcome to fx')`, 120000);
        await type('[cut:' + mode + '] build it');
        await press('Enter');
        result.reached = await settle(hasText(expected), waitMs);
        result.screen = await evaluate(TUI_SCREEN);
      },
    });
    result.stream = stub.streams.filter((record) => record.mode === mode || record.mode === 'answer').map((record) => ({ mode: record.mode, bytes: record.bytesWritten, ended: record.ended, clientClosed: record.clientClosed }));
    cases[mode] = result;
  };
  await runCase('none', 'tool-result=seen', 120000);
  await runCase('after-tool', 'incomplete stream', 90000);
  await runCase('mid-delta', 'incomplete stream', 90000);
  await runCase('hold', 'incomplete stream', 60000);
  await stub.close();

  const summary = (name) => JSON.stringify({ welcome: cases[name].welcome, reached: cases[name].reached, stream: cases[name].stream, screenTail: cases[name].screen.split('\n').filter(Boolean).slice(-6) });
  check('fx completes a tool call over the messages protocol through the relay: the tool result reaches the model and its answer prints', cases.none.reached === true && !cases.none.screen.includes('incomplete stream'), summary('none'));
  check('a stream cut after a tool_use block is reported by fx as incomplete stream, and the page stays usable', cases['after-tool'].reached === true, summary('after-tool'));
  check('a stream cut inside an event is reported by fx as incomplete stream', cases['mid-delta'].reached === true, summary('mid-delta'));
  check('a stream held open after a tool_use block never reports a completed turn', !cases.hold.screen.includes('tool-result=seen'), summary('hold'));
});
