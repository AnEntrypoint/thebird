#!/usr/bin/env node
// Merged chat spec (t11-witness-merge): combines witness-chat-config.mjs,
// witness-chat-roundtrip.mjs, witness-chat-scroll.mjs,
// witness-chat-seed-large.mjs, and witness-ws-chat.mjs into one runnable
// probe with 5 independent cases, each with its own isolated browser
// lifecycle (roundtrip and ws-chat even do their own clean-boot/preflight
// steps exactly as their originals did). Results land under case-prefixed
// keys (e.g. "config.hasStrip", "wsChat.ws-endpoint-handshake") in one
// printed report so witness-all.mjs's trailing-JSON tally sees every
// original assertion undiminished.
import { bootBrowser, sleep, waitForActiveInstance, assert, printReportAndExit, waitForGmReady, evalRetry } from './witness-lib.mjs';

// --- case: config (was witness-chat-config.mjs) ---
async function caseConfig() {
  const { browser, page, errs } = await bootBrowser({ tag: 'w', viewport: { width: 1200, height: 850 }, settleMs: 8000 });
  const out = {};
  try {
    const opened = await evalRetry(page, async () => {
      const s = window.__debug?.shell;
      if (!s) return { err: 'no shell' };
      try { await s.openApp('chat'); } catch (e) { return { openErr: String(e).slice(0, 200) }; }
      return { opened: true };
    });
    for (let i = 0; i < 90; i++) {
      const ready = await page.evaluate(() => {
        const w = document.querySelector('.freddie-chat-wrap');
        return !!(w && w.querySelector('.cc-strip'));
      });
      if (ready) break;
      await sleep(2000);
    }

    const probe = await page.evaluate(async () => {
      const wrap = document.querySelector('.freddie-chat-wrap');
      if (!wrap) return { err: 'no wrap' };
      const strip = wrap.querySelector('.cc-strip');
      if (!strip) return { err: 'no strip' };
      const toggle = strip.querySelector('.cc-toggle');
      if (toggle) toggle.click();
      await new Promise(r => setTimeout(r, 400));
      const has = sel => !!strip.querySelector(sel);
      const res = {
        hasStrip: true,
        hasModel: has('.cc-model'),
        hasAgent: has('.cc-agent'),
        hasCwd: has('.cc-cwd'),
        hasAcpMode: has('.cc-acp-mode'),
        hasQueue: has('.cc-acp-queue'),
        hasBaseUrl: has('.cc-acp-url'),
        hasInternalQueue: has('.cc-internal-queue'),
        hasSkillsSection: has('.cc-skills'),
        hasPluginsSection: has('.cc-plugins'),
        hasChatEl: !!wrap.querySelector('freddie-chat'),
      };
      const modeSel = strip.querySelector('.cc-acp-mode');
      if (modeSel) {
        modeSel.value = 'internal';
        modeSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const cwd = strip.querySelector('.cc-cwd');
      if (cwd) { cwd.value = 'projects'; cwd.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise(r => setTimeout(r, 300));
      const inst = window.__debug?.shell?.active;
      const cfg = (inst && inst.fs && inst.fs.getConfig && inst.fs.getConfig()) || {};
      res.persistedMode = cfg.acptoapi && cfg.acptoapi.mode;
      res.persistedCwd = cfg.agent && cfg.agent.cwd;
      return res;
    });

    assert(out, 'chatOpened', !!opened.opened, 'chat app failed to open: ' + JSON.stringify(opened));
    assert(out, 'hasStrip', !!probe.hasStrip, 'no .cc-strip config surface found: ' + JSON.stringify(probe));
    assert(out, 'hasModel', !!probe.hasModel, 'missing .cc-model control');
    assert(out, 'hasAgent', !!probe.hasAgent, 'missing .cc-agent control');
    assert(out, 'hasCwd', !!probe.hasCwd, 'missing .cc-cwd control');
    assert(out, 'hasAcpMode', !!probe.hasAcpMode, 'missing .cc-acp-mode control');
    assert(out, 'hasQueue', !!probe.hasQueue, 'missing .cc-acp-queue control');
    assert(out, 'hasBaseUrl', !!probe.hasBaseUrl, 'missing .cc-acp-url control');
    assert(out, 'hasInternalQueue', !!probe.hasInternalQueue, 'missing .cc-internal-queue control');
    assert(out, 'hasSkillsSection', !!probe.hasSkillsSection, 'missing .cc-skills section');
    assert(out, 'hasPluginsSection', !!probe.hasPluginsSection, 'missing .cc-plugins section');
    assert(out, 'hasChatEl', !!probe.hasChatEl, 'missing <freddie-chat> element');
    assert(out, 'modePersisted', probe.persistedMode === 'internal', 'acptoapi mode did not persist to internal: got ' + probe.persistedMode);
    assert(out, 'cwdPersisted', probe.persistedCwd === 'projects', 'cwd did not persist to projects: got ' + probe.persistedCwd);
    assert(out, 'noConsoleErrors', errs.length === 0, 'console/page errors: ' + JSON.stringify(errs.slice(0, 12)));
    out.raw = { opened, probe, errors: errs.slice(0, 12) };
    console.log('[config] OPENED:', JSON.stringify(opened));
    console.log('[config] CONFIG_PROBE:', JSON.stringify(probe, null, 2));
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: roundtrip (was witness-chat-roundtrip.mjs) ---
// End-to-end: open freddie chat, send a prompt, assert a real LLM response
// comes back via the local acptoapi (:4800). Does its own clean-boot pass
// (nuke SW/caches/localStorage/IDB) before the shared bootBrowser, exactly
// as the original did.
async function caseRoundtrip() {
  const URL = process.argv[2] || 'http://localhost:3000/os.html';
  const PROMPT = process.argv[3] || 'reply only the word pong';
  const out = {};
  const browser0 = (await import('puppeteer')).default;
  const cleanBrowser = await browser0.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const cleanPage = await cleanBrowser.newPage();
  await cleanPage.goto(URL + (URL.includes('?') ? '&' : '?') + 'clean=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await cleanPage.evaluate(async () => {
    try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } catch { /* swallow: best-effort SW teardown for the clean-boot reseed; no prior registration on a fresh origin is expected */ }
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch { /* swallow: best-effort cache teardown; Cache API access may be restricted or empty */ }
    try { localStorage.clear(); } catch { /* swallow: best-effort storage teardown; localStorage may be unavailable/already empty */ }
    try { const dbs = await indexedDB.databases?.() || []; for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name); } catch { /* swallow: best-effort IDB teardown; databases() enumeration is not universally supported */ }
  });
  await cleanBrowser.close();

  const { browser, page, errs } = await bootBrowser({ url: URL, tag: 'w', viewport: null, settleMs: 8000 });
  try {
    await evalRetry(page, async () => { try { await window.__debug.shell.openApp('chat'); } catch { /* swallow: best-effort open; downstream steps poll for the chat window/composer and assert absence explicitly */ } });

    // Stage-signalled readiness wait (a terminal degraded/error host stage
    // returns at once with the reason) instead of a blind 180s poll.
    const gmWait = await waitForGmReady(page);
    const gmReady = gmWait.ready;

    for (let i = 0; i < 30; i++) {
      const chatEl = await page.evaluate(() => !!document.querySelector('freddie-chat'));
      if (chatEl) break;
      await sleep(1000);
    }
    const baseline = await page.evaluate(() => document.querySelectorAll('.chat-msg.them').length);
    const sent = await page.evaluate((prompt) => {
      const chat = document.querySelector('freddie-chat');
      if (!chat) return { err: 'no freddie-chat element' };
      chat.dispatchEvent(new CustomEvent('send', { detail: { text: prompt }, bubbles: true }));
      return { sent: true };
    }, PROMPT);

    let reply = null;
    for (let i = 0; i < 140; i++) {
      reply = await page.evaluate((base) => {
        const them = [...document.querySelectorAll('.chat-msg.them')];
        if (them.length <= base) return null;
        const last = them[them.length - 1];
        return last ? (last.textContent || '').trim() : null;
      }, baseline);
      if (reply && reply.length > 0) break;
      await sleep(2000);
    }

    const res = {
      gmReady,
      gmBootStage: gmWait.stage,
      gmBootElapsedMs: gmWait.elapsedMs,
      sent,
      reply: reply ? reply.slice(0, 200) : null,
      replyIsError: reply ? /unreachable|no LLM backend|error|loopback|failed/i.test(reply) : null,
      acptoapiServed: reply ? !/unreachable|no LLM backend/i.test(reply) : false,
    };

    assert(out, 'gmReady', gmReady, 'gm did not become ready (window.__debug.gm.dispatch missing); last boot stage: ' + JSON.stringify(gmWait.stage) + ' after ' + gmWait.elapsedMs + 'ms');
    assert(out, 'sent', !!sent.sent, 'failed to send prompt via <freddie-chat> send event: ' + JSON.stringify(sent));
    assert(out, 'replyReceived', !!reply, 'no new assistant reply observed within poll window');
    assert(out, 'acptoapiServed', res.acptoapiServed && !res.replyIsError, 'reply looked like an error/unreachable response: ' + res.reply);
    out.raw = res;
    console.log('[roundtrip]', JSON.stringify(res, null, 2));
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: scroll (was witness-chat-scroll.mjs) ---
// Layout containment: thread scrolls internally, composer pinned, nothing
// overflows the window content area.
async function caseScroll() {
  const { browser, page, errs } = await bootBrowser({ tag: 'w', viewport: { width: 1100, height: 760 }, settleMs: 8000 });
  const out = {};
  try {
    await evalRetry(page, async () => { const s = window.__debug?.shell; if (s) await s.openApp('chat'); });
    for (let i = 0; i < 60; i++) {
      const ok = await page.evaluate(() => !!document.querySelector('.freddie-chat-wrap freddie-chat'));
      if (ok) break; await sleep(2000);
    }
    const probe = await page.evaluate(async () => {
      const res = {};
      const el = document.querySelector('.freddie-chat-wrap freddie-chat');
      if (!el) return { err: 'no chat el' };
      const msgs = [];
      for (let i = 0; i < 40; i++) msgs.push({ who: i % 2 ? 'them' : 'you', text: 'message line ' + i + ' ' + 'x'.repeat(60), time: '12:00', name: i % 2 ? 'freddie' : 'you' });
      el.messages = msgs;
      await new Promise(r => setTimeout(r, 600));
      const win = el.closest('.wm-win');
      const thread = el.querySelector('.chat-thread') || el.shadowRoot?.querySelector?.('.chat-thread');
      const winRect = win && win.getBoundingClientRect();
      const wrapRect = document.querySelector('.freddie-chat-wrap').getBoundingClientRect();
      res.winRect = winRect && { h: Math.round(winRect.height), bottom: Math.round(winRect.bottom) };
      res.wrapRect = { h: Math.round(wrapRect.height), bottom: Math.round(wrapRect.bottom) };
      res.wrapWithinWin = winRect ? (wrapRect.bottom <= winRect.bottom + 2) : null;
      if (thread) {
        res.threadScrollable = thread.scrollHeight > thread.clientHeight + 4;
        res.threadOverflowY = getComputedStyle(thread).overflowY;
        // freddie-chat auto-scrolls the thread to the bottom when .messages is
        // assigned, so at this point scrollTop is typically ALREADY at max —
        // asserting scrollTop > beforeTop after a bottom-set would then be
        // vacuously false. Reset to the top first so the bottom-set is a real,
        // measurable movement.
        thread.scrollTop = 0;
        await new Promise(r => setTimeout(r, 200));
        const beforeTop = thread.scrollTop;
        thread.scrollTop = thread.scrollHeight;
        await new Promise(r => setTimeout(r, 400));
        res.threadScrolled = thread.scrollTop > beforeTop;
        const tr = thread.getBoundingClientRect();
        res.threadWithinWin = winRect ? (tr.bottom <= winRect.bottom + 4) : null;
      } else {
        res.thread = 'not-found (likely DsChat light-DOM .chat-thread selector differs)';
        res.alts = ['.chat-thread', '.ds-chat-thread', '.chat-msgs', '[class*=thread]', '[class*=scroll]'].map(s => ({ sel: s, found: !!el.querySelector(s) }));
      }
      res.bodyScroll = document.scrollingElement.scrollHeight > window.innerHeight + 4;
      return res;
    });
    assert(out, 'chatElFound', !probe.err, 'probe failed: ' + JSON.stringify(probe.err));
    assert(out, 'wrapWithinWin', probe.wrapWithinWin !== false, 'chat wrap overflows the window bounds: ' + JSON.stringify(probe.winRect) + ' vs ' + JSON.stringify(probe.wrapRect));
    if (probe.thread) {
      out.threadFound = { pass: false, detail: 'chat thread element not found via known selectors: ' + JSON.stringify(probe.alts) };
    } else {
      assert(out, 'threadScrollable', !!probe.threadScrollable, 'thread did not overflow with 40 stuffed messages');
      assert(out, 'threadScrolled', !!probe.threadScrolled, 'setting thread.scrollTop did not move the scroll position');
      assert(out, 'threadWithinWin', probe.threadWithinWin !== false, 'thread bounding rect overflows the window bounds');
    }
    assert(out, 'bodyNotScrolling', !probe.bodyScroll, 'the page body itself scrolls (should be internal-only scroll): ' + JSON.stringify(probe.bodyScroll));
    out.raw = probe;
    console.log('[scroll] SCROLL_PROBE:', JSON.stringify(probe, null, 2));
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: seedLarge (was witness-chat-seed-large.mjs) ---
// Seed ~1000 real chat messages via the real transcript-store API, then open
// the chat app and assert it renders/scrolls within budget.
async function caseSeedLarge() {
  const MSG_COUNT = 1000;
  const RENDER_BUDGET_MS = 5000;
  const { browser, page, errs } = await bootBrowser({ settleMs: 9000 });
  const out = {};
  try {
    const gotInstance = await waitForActiveInstance(page);
    assert(out, 'active-instance', gotInstance, 'no active shell instance after boot');
    if (!gotInstance) return out;

    const seedResult = await page.evaluate(async (count) => {
      const s = window.__debug?.shell;
      const inst = s && s.active;
      if (!inst) return { err: 'no active instance in page' };
      const instances = window.__debug.instances || {};
      const realInstance = instances[inst.id] && instances[inst.id].instance;
      const target = realInstance || inst;
      if (!target || !target.fs) return { err: 'no instance.fs reachable via window.__debug', keys: Object.keys(inst || {}) };

      // chat-transcript.js was merged into lib/chat.js (t17-chat-lib-merge);
      // createTranscriptStore is exported from there.
      const mod = await import(new URL('/lib/chat.js', location.href).href).catch(e => ({ __importErr: String(e) }));
      if (mod.__importErr) return { err: 'import failed: ' + mod.__importErr };
      const { createTranscriptStore } = mod;

      const t0 = performance.now();
      const store = createTranscriptStore(target);
      const conv = store.createConversation('witness-large-conversation');
      const sess = store.createSession(conv.id);
      for (let i = 0; i < count; i++) {
        store.createMessage(conv.id, sess.id, i % 2 ? 'assistant' : 'user', 'seed message ' + i + ' ' + 'x'.repeat(40));
      }
      const t1 = performance.now();
      const stored = store.getMessages(conv.id);
      return {
        ok: true,
        conversationId: conv.id,
        sessionId: sess.id,
        seedMs: Math.round(t1 - t0),
        storedCount: stored.length,
      };
    }, MSG_COUNT);

    assert(out, 'seed-no-error', seedResult && seedResult.ok, seedResult);
    if (seedResult && seedResult.ok) {
      assert(out, 'seed-count-matches', seedResult.storedCount === MSG_COUNT, seedResult);
      out['seed-timing-ms'] = { pass: true, detail: seedResult.seedMs };
    }

    const renderResult = seedResult && seedResult.ok ? await page.evaluate(async (conversationId) => {
      const t0 = performance.now();
      const s = window.__debug?.shell;
      if (s && s.openApp) await s.openApp('chat');
      let el = null;
      for (let i = 0; i < 30; i++) {
        el = document.querySelector('.freddie-chat-wrap freddie-chat');
        if (el) break;
        await new Promise(r => setTimeout(r, 200));
      }
      if (!el) return { err: 'chat element never appeared' };

      const mod = await import(new URL('/lib/chat.js', location.href).href);
      const { createTranscriptStore } = mod;
      const inst = s.active;
      const instances = window.__debug.instances || {};
      const target = (instances[inst.id] && instances[inst.id].instance) || inst;
      const store = createTranscriptStore(target);
      const rows = store.getMessages(conversationId);
      el.messages = rows.map(r => ({ who: r.role === 'user' ? 'you' : 'them', text: r.text, time: '', name: r.role }));
      await new Promise(r => setTimeout(r, 300));
      const t1 = performance.now();

      const thread = el.querySelector('.chat-thread') || (el.shadowRoot && el.shadowRoot.querySelector('.chat-thread'));
      let scrolled = null;
      if (thread) {
        // same auto-scroll-to-bottom caveat as caseScroll: reset to top first
        // so the bottom-set is a real movement, not a no-op at max.
        thread.scrollTop = 0;
        await new Promise(r => setTimeout(r, 200));
        const before = thread.scrollTop;
        thread.scrollTop = thread.scrollHeight;
        scrolled = thread.scrollTop > before || thread.scrollHeight <= thread.clientHeight;
      }
      const t2 = performance.now();

      return {
        ok: true,
        renderedRows: rows.length,
        renderMs: Math.round(t1 - t0),
        scrollMs: Math.round(t2 - t1),
        totalMs: Math.round(t2 - t0),
        threadFound: !!thread,
        scrolled,
        bodyScrollLeaked: document.scrollingElement.scrollHeight > window.innerHeight + 4,
      };
    }, seedResult.conversationId) : { err: 'skipped: seed failed' };

    assert(out, 'render-no-error', renderResult && renderResult.ok, renderResult);
    if (renderResult && renderResult.ok) {
      assert(out, 'render-within-budget', renderResult.totalMs <= RENDER_BUDGET_MS, { totalMs: renderResult.totalMs, budgetMs: RENDER_BUDGET_MS });
      assert(out, 'thread-found', renderResult.threadFound, renderResult);
      assert(out, 'no-body-scroll-leak', !renderResult.bodyScrollLeaked, renderResult);
      out['render-timing'] = { pass: true, detail: { renderMs: renderResult.renderMs, scrollMs: renderResult.scrollMs, totalMs: renderResult.totalMs } };
    }

    const meaningfulErrs = errs.filter(e => !/^CE:Failed to load resource: the server responded with a status of 404/.test(e));
    assert(out, 'no-page-errors', meaningfulErrs.length === 0, meaningfulErrs.slice(0, 10));
    if (meaningfulErrs.length !== errs.length) {
      out['benign-errors-filtered'] = { pass: true, detail: errs.filter(e => /favicon/i.test(e)) };
    }
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: wsChat (was witness-ws-chat.mjs) ---
// Exercises the real WS transport opt-in against a live acptoapi daemon.
// Honest-by-construction: does NOT force an overall pass -- if the WS
// endpoint doesn't exist, ws-endpoint-handshake fails and that is the real,
// reportable finding (a chat response arriving is not itself proof of the WS
// path, since acptoapi-browser.js's chat() can silently fall back to HTTP).
async function caseWsChat() {
  const ACPTOAPI_BASE = process.env.ACPTOAPI_BASE || 'http://localhost:4800';
  const out = {};

  let daemonUp = false;
  try {
    const r = await fetch(ACPTOAPI_BASE + '/health', { signal: AbortSignal.timeout(3000) });
    daemonUp = r.ok;
    out['daemon-reachable'] = { pass: daemonUp, detail: daemonUp ? await r.json() : r.status };
  } catch (e) {
    out['daemon-reachable'] = { pass: false, detail: String(e) };
  }

  if (!daemonUp) {
    console.log('[wsChat] BLOCKED: acptoapi daemon not reachable at ' + ACPTOAPI_BASE + ' -- start `bunx acptoapi@latest` first.');
    return out;
  }

  const wsUrl = ACPTOAPI_BASE.replace(/^http/, 'ws').replace(/\/$/, '') + '/v1/ws';
  let wsHandshakeOk = false;
  let wsHandshakeDetail = null;
  try {
    wsHandshakeDetail = await new Promise((resolve, reject) => {
      const sock = new WebSocket(wsUrl);
      const timer = setTimeout(() => { try { sock.close(); } catch { /* swallow: best-effort teardown after a handshake timeout; the socket may already be in a closing/closed state */ } reject(new Error('handshake timeout after 5000ms')); }, 5000);
      sock.addEventListener('open', () => { clearTimeout(timer); wsHandshakeOk = true; try { sock.close(); } catch { /* swallow: best-effort teardown right after a successful open; close failure doesn't change the already-recorded wsHandshakeOk result */ } resolve({ opened: true }); });
      sock.addEventListener('error', () => { clearTimeout(timer); resolve({ opened: false, event: 'error' }); });
      sock.addEventListener('close', (ev) => { clearTimeout(timer); resolve({ opened: false, event: 'close', code: ev.code, reason: ev.reason }); });
    });
  } catch (e) {
    wsHandshakeDetail = { opened: false, error: String(e) };
  }
  assert(out, 'ws-endpoint-handshake', wsHandshakeOk, { url: wsUrl, detail: wsHandshakeDetail });

  const { browser, page, errs } = await bootBrowser({ settleMs: 9000 });
  try {
    const gotInstance = await waitForActiveInstance(page);
    assert(out, 'active-instance', gotInstance, 'no active shell instance after boot');

    if (gotInstance) {
      const setup = await page.evaluate((base) => {
        const s = window.__debug?.shell;
        const inst = s && s.active;
        const instances = window.__debug.instances || {};
        const target = (instances[inst.id] && instances[inst.id].instance) || inst;
        if (!target || !target.fs) return { err: 'no instance.fs reachable' };
        const cfg = target.fs.getConfig ? target.fs.getConfig() : {};
        cfg.acptoapi = cfg.acptoapi || {};
        cfg.acptoapi.mode = 'external';
        cfg.acptoapi.baseUrl = base;
        cfg.acptoapi.transport = 'ws';
        target.fs.setConfig(cfg);
        return { ok: true, cfg: cfg.acptoapi };
      }, ACPTOAPI_BASE);
      assert(out, 'ws-config-set', setup && setup.ok, setup);

      const chatResult = await page.evaluate(async () => {
        try {
          const mod = await import(new URL('/lib/acptoapi-browser.js', location.href).href);
          const t0 = performance.now();
          const res = await Promise.race([
            mod.chat({ messages: [{ role: 'user', content: 'ws-witness ping: reply with the single word pong' }], model: 'auto' }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('witness-side 20s timeout')), 20000)),
          ]);
          const t1 = performance.now();
          return { ok: true, ms: Math.round(t1 - t0), hasChoices: !!(res && res.choices && res.choices.length), raw: res && res.choices ? res.choices[0] : res };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e), stack: e && e.stack ? String(e.stack).slice(0, 500) : null };
        }
      });
      out['ws-chat-attempt'] = { pass: !!(chatResult && chatResult.ok), detail: chatResult };
    }

    assert(out, 'no-unrelated-page-errors', errs.filter(e => !/^CE:Failed to load resource: the server responded with a status of 404/.test(e)).length === 0, errs.slice(0, 10));
  } finally {
    await browser.close();
  }

  if (!out['ws-endpoint-handshake'].pass) {
    console.log('[wsChat] FINDING: acptoapi at ' + ACPTOAPI_BASE + ' has no working WS endpoint at ' + wsUrl + ' -- ws-router.js/externalAcptoapiChatWs is wired in thebird but the transport is unreachable against this real acptoapi instance. This is a genuine environment/dependency gap, not a thebird-side bug.');
  }
  return out;
}

const cases = [
  ['config', caseConfig],
  ['roundtrip', caseRoundtrip],
  ['scroll', caseScroll],
  ['seedLarge', caseSeedLarge],
  ['wsChat', caseWsChat],
];

const report = {};
for (const [name, fn] of cases) {
  let caseReport;
  try {
    caseReport = await fn();
  } catch (e) {
    caseReport = { crashed: { pass: false, detail: String(e && e.stack || e).slice(0, 500) } };
  }
  for (const [k, v] of Object.entries(caseReport)) {
    report[`${name}.${k}`] = v;
  }
}
// witness-all.mjs's KNOWN_NON_BLOCKING set used to exclude witness-ws-chat.mjs
// by filename (acptoapi has no /v1/ws route in this environment -- a genuine,
// honestly-reported upstream gap, not a thebird bug). Now that wsChat is a
// case inside this merged file rather than its own script, that file-level
// exclusion has nothing to key off of. Reproduce the same non-blocking
// treatment here: the wsChat.* keys are printed in full (nothing hidden) but
// excluded from this script's own exit-code gate, exactly as witness-all.mjs
// excluded the whole old script from ITS gate.
console.log(JSON.stringify(report, null, 2));
const gatingEntries = Object.entries(report).filter(([k]) => !k.startsWith('wsChat.'));
const gatingPassed = gatingEntries.every(([, v]) => !v || typeof v !== 'object' || v.pass !== false);
process.exit(gatingPassed ? 0 : 1);
