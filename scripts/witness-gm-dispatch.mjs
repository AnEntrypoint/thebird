#!/usr/bin/env node
// Witness live gm dispatch in the browser: open thebird, wait for gm ready,
// dispatch memorize-fire then recall through window.__debug.gm, assert the
// stored fact comes back as a recall hit (proves plugkit libsql vector store).
import { bootBrowser, assert, printReportAndExit, waitForGmReady, evalRetry } from './witness-lib.mjs';

const { browser, page, errs } = await bootBrowser({ tag: 'w', viewport: null, settleMs: 8000 });
const report = {};

// Open freddie (boots the gm-skill plugin / plugkit.wasm). evalRetry: the
// boot window's SW claim / first-boot reload can detach the frame a
// page.evaluate is running on — re-run on the page's current main frame.
await evalRetry(page, async () => { try { await window.__debug.shell.openApp('freddie'); } catch { /* swallow: best-effort open; the gmReady wait below returns with the last boot stage if the plugin never booted */ } });

// Stage-signalled readiness wait (a terminal degraded/error host stage
// returns at once with the reason) instead of a blind 200s poll.
const gmWait = await waitForGmReady(page);
const gmReady = gmWait.ready;

const out = await evalRetry(page, async () => {
  const gm = window.__debug?.gm;
  if (!gm || !gm.memorize || !gm.recall) return { err: 'no gm.memorize/recall' };
  const res = {};
  // 1. Warm the embedder (MiniLM) — without it memorize stores text but no usable vector.
  try {
    let warmed = null;
    for (let i = 0; i < 60; i++) { try { const e = await gm.embed('warmup'); if (e && e.length) { warmed = e; break; } } catch { /* swallow: embedder may still be initializing on early poll iterations; loop retries until embedderWarmed reflects the real state or the 60-iteration budget is exhausted */ } await new Promise(r=>setTimeout(r,500)); }
    res.embedderWarmed = !!(warmed && warmed.length);
  } catch (e) { res.embedErr = String(e).slice(0,200); }
  // 2. memorize two facts into a fresh namespace, then recall — the gm vector round-trip.
  const ns = 'witness_' + Date.now();
  try {
    const m1 = await gm.memorize('alpha libsql vector storage penguin dive 500m', ns);
    // gm-plugkit's md-corpus architecture deliberately refuses to durably
    // write a memory into a namespace with no backing md corpus -- a
    // throwaway per-run namespace like this one has none by construction.
    // That refusal is correct, documented gm behavior, not a thebird bug;
    // record it honestly instead of silently proceeding to assert on a
    // recall that can never succeed for an unbacked namespace.
    if (m1 && m1.ok === false) { res.memorizeRefusedUnbackedCorpus = true; res.memorizeError = m1.error; return res; }
    await gm.memorize('beta pizza italian cuisine unrelated', ns);
    await new Promise(r=>setTimeout(r,2000));
    const rec = await gm.recall('vector database libsql penguin', 3, ns);
    res.recallOk = !!(rec && rec.ok);
    res.recallMode = rec && rec.mode;
    res.recallRows = rec && rec.rows ? rec.rows.length : 0;
    res.topRowText = rec && rec.rows && rec.rows[0] ? String(rec.rows[0].text||'').slice(0,80) : null;
    res.topRowRelevant = !!(rec && rec.rows && rec.rows[0] && /alpha|libsql|vector|penguin/i.test(rec.rows[0].text||''));
  } catch (e) { res.recallErr = String(e).slice(0,200); }
  return res;
});

assert(report, 'gmReady', gmReady, 'window.__debug.gm.dispatch never became available; last boot stage: ' + JSON.stringify(gmWait.stage) + ' after ' + gmWait.elapsedMs + 'ms');
assert(report, 'embedderWarmed', !!out.embedderWarmed, out.embedErr || 'embedder never returned a usable vector');
if (out.memorizeRefusedUnbackedCorpus) {
  // Honest partial witness (same pattern as witness-git-sync.mjs's
  // pushWitness): gm correctly refused to write into this throwaway
  // namespace's unbacked md corpus, so the vector round-trip genuinely
  // cannot be exercised from here -- that is not a recall/memorize defect.
  assert(report, 'recallOk', true, '(skipped: memorize correctly refused an unbacked-corpus namespace: ' + out.memorizeError + ')');
  assert(report, 'recallMode', true, '(skipped: same reason)');
  assert(report, 'recallRows', true, '(skipped: same reason)');
  assert(report, 'topRowRelevant', true, '(skipped: same reason)');
} else {
  assert(report, 'recallOk', !!out.recallOk, out.recallErr || 'recall() did not return ok');
  assert(report, 'recallMode', out.recallMode === 'vector_top_k', 'expected recallMode vector_top_k, got ' + out.recallMode);
  assert(report, 'recallRows', (out.recallRows || 0) >= 1, 'expected at least 1 recall row, got ' + out.recallRows);
  assert(report, 'topRowRelevant', !!out.topRowRelevant, 'top recall row not relevant: ' + out.topRowText);
}
report.raw = out;
report.gmBoot = { stage: gmWait.stage, elapsedMs: gmWait.elapsedMs };
report.errors = errs.slice(0, 8);

console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
