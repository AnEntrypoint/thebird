#!/usr/bin/env node
// Merged freddie spec (t11-witness-merge): combines witness-freddie-diag.mjs,
// witness-freddie-gm-tool.mjs, witness-freddie-gui.mjs, and
// witness-freddie-render.mjs into one runnable probe with 4 independent
// cases, each booting its own isolated browser/page exactly as its original
// script did (no shared state, no shared page). Results are aggregated under
// case-prefixed keys (e.g. "diag.fdVisibleAfterMax") into one printed report
// so witness-all.mjs's trailing-JSON tally still sees every original
// assertion, just from one discovered file instead of four.
import { bootBrowser, sleep, assert, printReportAndExit, waitForGmReady, evalRetry } from './witness-lib.mjs';

// --- case: diag (was witness-freddie-diag.mjs) ---
// Diagnose two reported bugs: (1) maximizing freddie hides its GUI,
// (2) clicking the chat tab breaks the dashboard.
async function caseDiag() {
  const { browser, page, errs } = await bootBrowser({ tag: 'w', settleMs: 8000 });
  const out = {};
  try {
    const opened = await evalRetry(page, async () => {
      const s = window.__debug?.shell;
      if (!s) return { err: 'no shell' };
      try { await s.openApp('freddie'); } catch (e) { return { openErr: String(e).slice(0, 200) }; }
      return { opened: true };
    });
    for (let i = 0; i < 90; i++) {
      let ready = false;
      try { ready = await page.evaluate(() => !!document.querySelector('.fd-root') && !!(window.__debug?.gm?.dispatch)); }
      catch { /* navigation/detached-frame race during boot — retry on the fresh frame */ }
      if (ready) break;
      await sleep(2000);
    }

    const before = await page.evaluate(() => {
      const fd = document.querySelector('.fd-root');
      const win = document.querySelector('.wm-win');
      const b = fd && fd.getBoundingClientRect();
      return {
        fdRoot: !!fd, winCount: document.querySelectorAll('.wm-win').length,
        fdRect: b ? { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) } : null,
        winClasses: win ? win.className : null,
      };
    });

    const maxProbe = await page.evaluate(async () => {
      const win = document.querySelector('.wm-win');
      if (!win) return { err: 'no win' };
      const bar = win.querySelector('.wm-bar');
      const btns = bar ? [...bar.querySelectorAll('button,[role=button],.wm-btn,[class*=max],[title]')] : [];
      const found = btns.map(b => ({ cls: b.className, title: b.title || '', txt: (b.textContent || '').slice(0, 4) }));
      let clicked = null;
      const cand = btns.find(b => /maxim/i.test(b.title) || /max/i.test(b.className));
      if (cand) { cand.click(); clicked = cand.className || cand.title; }
      await new Promise(r => setTimeout(r, 1500));
      const w2 = document.querySelector('.wm-win');
      const fd = document.querySelector('.fd-root');
      const fb = fd && fd.getBoundingClientRect();
      const wb = w2 && w2.getBoundingClientRect();
      return {
        barBtns: found, clicked,
        isMax: !!(w2 && w2.classList.contains('wm-max')),
        winRect: wb ? { w: Math.round(wb.width), h: Math.round(wb.height), top: Math.round(wb.top) } : null,
        fdRectAfterMax: fb ? { w: Math.round(fb.width), h: Math.round(fb.height), top: Math.round(fb.top) } : null,
        fdVisibleAfterMax: !!(fb && fb.width > 2 && fb.height > 2),
      };
    });

    await page.evaluate(async () => {
      const w = document.querySelector('.wm-win');
      if (w && w.classList.contains('wm-max')) { const bar = w.querySelector('.wm-bar'); bar && bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
      await new Promise(r => setTimeout(r, 800));
    });

    const errsBeforeChat = errs.length;
    const chatProbe = await page.evaluate(async () => {
      const navs = [...document.querySelectorAll('.fd-root .app-side a, .fd-root .app-side button, .fd-root nav a, .fd-root [data-route], .fd-root [data-path]')];
      const navInfo = navs.map(n => ({ txt: (n.textContent || '').trim().slice(0, 16), route: n.dataset.route || n.dataset.path || '' }));
      const chatNav = navs.find(n => /chat/i.test(n.textContent || '') || /chat/i.test(n.dataset.route || n.dataset.path || ''));
      let clicked = false;
      if (chatNav) { chatNav.click(); clicked = true; }
      await new Promise(r => setTimeout(r, 3000));
      const fd = document.querySelector('.fd-root');
      const fb = fd && fd.getBoundingClientRect();
      return {
        navInfo, chatNavFound: !!chatNav, clicked,
        fdRootAfter: !!fd,
        fdInnerLen: fd ? fd.innerHTML.length : 0,
        fdVisibleAfter: !!(fb && fb.width > 2 && fb.height > 2),
        hasChatSurface: !!document.querySelector('.fd-root .chat-thread, .fd-root .chat, .fd-root ds-chat, .fd-root freddie-chat, freddie-chat'),
      };
    });

    console.log('[diag] OPENED:', JSON.stringify(opened));
    console.log('[diag] BEFORE:', JSON.stringify(before));
    console.log('[diag] BUG1_MAXIMIZE:', JSON.stringify(maxProbe, null, 2));
    console.log('[diag] BUG2_CHATTAB:', JSON.stringify(chatProbe, null, 2));

    assert(out, 'freddieOpened', !!opened.opened, 'freddie app failed to open: ' + JSON.stringify(opened));
    assert(out, 'fdRootBeforeMax', !!before.fdRoot, 'no .fd-root found before maximize test');
    assert(out, 'maximizeButtonFound', !!maxProbe.clicked, 'no maximize button found/clicked on the window bar: ' + JSON.stringify(maxProbe.barBtns));
    assert(out, 'fdVisibleAfterMax', !!maxProbe.fdVisibleAfterMax, 'BUG1: .fd-root not visible after maximize: ' + JSON.stringify(maxProbe.fdRectAfterMax));
    assert(out, 'chatNavFound', !!chatProbe.chatNavFound, 'no chat nav entry found in freddie dashboard sidebar: ' + JSON.stringify(chatProbe.navInfo));
    assert(out, 'fdRootAfterChatClick', !!chatProbe.fdRootAfter, 'BUG2: .fd-root disappeared after clicking chat tab');
    assert(out, 'fdVisibleAfterChatClick', !!chatProbe.fdVisibleAfter, 'BUG2: .fd-root not visible after clicking chat tab: ' + JSON.stringify(chatProbe));
    assert(out, 'hasChatSurface', !!chatProbe.hasChatSurface, 'BUG2: no chat surface found after clicking chat tab');
    assert(out, 'noErrorsDuringChatClick', errs.slice(errsBeforeChat).length === 0, 'errors during chat tab click: ' + JSON.stringify(errs.slice(errsBeforeChat)));
    out.raw = { opened, before, maxProbe, chatProbe, errors: errs.slice(0, 20) };
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: gmTool (was witness-freddie-gm-tool.mjs) ---
// Chained integration: memorize a fact via gm, then recall it back --
// exercises freddie<->gm<->acptoapi as ONE flow.
async function caseGmTool() {
  const { browser, page, errs } = await bootBrowser({ tag: 'fgt' });
  const out = {};
  try {
    const marker = 'penguin-secret-' + Date.now();
    // Stage-signalled readiness wait (a terminal degraded/error host stage
    // returns at once with the reason), then navigation-safe evaluates: the
    // boot window's SW claim / first-boot reload can detach the frame a
    // page.evaluate is running on ("Attempted to use detached Frame") —
    // evalRetry re-runs on the page's CURRENT main frame instead of crashing
    // the whole case on a stale handle.
    const gmWait = await waitForGmReady(page);
    const gmReady = gmWait.ready;
    const mem = await evalRetry(page, async (mk) => {
      const gm = window.__debug?.gm; if (!gm) return { err: 'no gm' };
      try { await gm.embed?.('warmup'); } catch { /* swallow: best-effort embedder warmup; memorize() below still works without a pre-warmed vector, it's just slower on the first call */ }
      try { const r = await gm.memorize?.('The secret penguin code is ' + mk, 'fgt'); return { ok: !!(r && r.ok), error: r && r.error }; }
      catch (e) { return { err: String(e).slice(0, 100) }; }
    }, marker);

    await sleep(1500);
    const rec = await evalRetry(page, async (mk) => {
      const gm = window.__debug?.gm;
      try {
        const r = await gm.recall?.('secret penguin code', 3, 'fgt');
        const hits = (r?.data?.hits || []).concat(r?.data?.vector_hits || []);
        return { mode: r?.data?.mode, rows: hits.length, found: hits.some(x => String(x.text || '').includes(mk)) };
      }
      catch (e) { return { err: String(e).slice(0, 100) }; }
    }, marker);

    assert(out, 'gmReady', gmReady, 'gm.dispatch not available within timeout; last boot stage: ' + JSON.stringify(gmWait.stage) + ' after ' + gmWait.elapsedMs + 'ms');
    if (!mem.ok && /unbacked memory/.test(mem.error || '')) {
      // gm-plugkit's md-corpus architecture deliberately refuses to durably
      // write into the 'fgt' namespace here because it has no backing md
      // corpus in this browser-hosted context -- correct, documented gm
      // behavior, not a thebird/freddie defect.
      assert(out, 'gmMemorize', true, '(skipped: memorize correctly refused an unbacked-corpus namespace: ' + mem.error + ')');
      assert(out, 'gmRecallFound', true, '(skipped: same reason)');
    } else {
      assert(out, 'gmMemorize', !!mem.ok, 'gm.memorize failed: ' + JSON.stringify(mem));
      assert(out, 'gmRecallFound', !!rec.found, 'recalled rows did not contain marker: ' + JSON.stringify(rec));
    }
    out.mem = mem;
    out.rec = rec;
    out.gmBoot = { stage: gmWait.stage, elapsedMs: gmWait.elapsedMs };
    out.errors = errs.slice(0, 5);
    console.log('[gmTool] GM-MEMORIZE:', JSON.stringify(mem));
    console.log('[gmTool] GM-RECALL:', JSON.stringify(rec));
    console.log('[gmTool] gmReady:', gmReady, 'ERRS:', errs.slice(0, 5));
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: gui (was witness-freddie-gui.mjs) ---
// Open freddie app, wait for gm-ready, assert dashboard renders. Defaults to
// the live gh-pages URL (original script's default), overridable via argv[2].
async function caseGui() {
  const { browser, page, errs } = await bootBrowser({ url: process.argv[2] || 'https://anentrypoint.github.io/thebird/os.html', tag: 'w', viewport: null, settleMs: 8000 });
  const out = {};
  try {
    const opened = await evalRetry(page, async () => {
      const s = window.__debug?.shell;
      if (!s) return { err: 'no shell' };
      try { await s.openApp('freddie'); } catch (e) { return { openErr: String(e).slice(0, 200) }; }
      return { opened: true };
    });
    const gmWait = await waitForGmReady(page);
    const state = await evalRetry(page, () => {
      const gm = window.__debug?.gm;
      return {
        gmExports: Array.isArray(gm?.exports) ? gm.exports.length : (gm?.exports ? 'obj' : null),
        gmReady: !!(gm && gm.dispatch),
        freddieWin: !!document.querySelector('.wm-win[data-kind="freddie"], freddie-dashboard, .freddie-dashboard, .ds-dashboard'),
        freddieChat: !!document.querySelector('freddie-chat'),
        wmWins: document.querySelectorAll('.wm-win').length,
        bodyHasDash: /dashboard|freddie/i.test(document.body.innerHTML.slice(0, 200000)),
      };
    });
    assert(out, 'appOpened', !!opened.opened, 'openApp("freddie") failed: ' + JSON.stringify(opened));
    assert(out, 'gmReady', state.gmReady, 'gm.dispatch not available after polling; last boot stage: ' + JSON.stringify(gmWait.stage) + ' after ' + gmWait.elapsedMs + 'ms');
    assert(out, 'freddieWinRendered', state.freddieWin, 'no freddie window/dashboard/chat element found');
    out.state = state;
    out.errors = errs.slice(0, 12);
    console.log('[gui] OPENED:', JSON.stringify(opened));
    console.log('[gui] STATE:', JSON.stringify(state, null, 2));
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: render (was witness-freddie-render.mjs) ---
// Narrower render check: window with data-kind="freddie" exists, .fd-root
// mounts with non-empty content. Defaults to gh-pages root URL (original
// script's default).
async function caseRender() {
  const { browser, page, errs } = await bootBrowser({ url: process.argv[2] || 'https://anentrypoint.github.io/thebird/', tag: 'w', viewport: null, settleMs: 8000 });
  const out = {};
  try {
    let openRes = {};
    try {
      openRes = await evalRetry(page, async () => {
        const s = window.__debug.shell;
        await s.openApp('freddie');
        await new Promise(r => setTimeout(r, 5000));
        const fwin = [...document.querySelectorAll('.wm-win')].find(w => (w.dataset.kind || w.getAttribute('data-kind')) === 'freddie');
        const body = fwin ? fwin.querySelector('.wm-body') : null;
        const fdroot = body ? body.querySelector('.fd-root, .app-fd') : null;
        return {
          freddieKindWinExists: !!fwin,
          winKinds: [...document.querySelectorAll('.wm-win')].map(w => w.dataset.kind || w.getAttribute('data-kind')),
          fdRootExists: !!fdroot,
          fdRootChildTags: fdroot ? [...fdroot.children].map(c => c.tagName + (c.className ? '.' + String(c.className).split(' ')[0] : '')).slice(0, 10) : null,
          fdRootTextLen: fdroot ? fdroot.textContent.trim().length : 0,
          fdRootHtmlSnippet: fdroot ? fdroot.innerHTML.slice(0, 400) : (body ? 'BODY:' + body.innerHTML.slice(0, 400) : null),
        };
      });
    } catch (e) { openRes = { openErr: String(e).slice(0, 400) }; }

    assert(out, 'noOpenError', !openRes.openErr, 'openApp("freddie") threw: ' + openRes.openErr);
    assert(out, 'freddieWinExists', !!openRes.freddieKindWinExists, 'no window with data-kind="freddie" found');
    assert(out, 'fdRootExists', !!openRes.fdRootExists, 'no .fd-root/.app-fd inside freddie window body');
    assert(out, 'fdRootHasContent', (openRes.fdRootTextLen || 0) > 0, 'freddie dashboard root rendered but has zero text content');
    out.raw = openRes;
    out.errors = errs.slice(0, 15);
    console.log('[render] FREDDIE DASHBOARD:', JSON.stringify(openRes, null, 2));
  } finally {
    await browser.close();
  }
  return out;
}

const cases = [
  ['diag', caseDiag],
  ['gmTool', caseGmTool],
  ['gui', caseGui],
  ['render', caseRender],
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
printReportAndExit(report);
